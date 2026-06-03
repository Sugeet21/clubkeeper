-- Migration: cardless_trial
-- Replaces card-up-front onboarding with a 7-day free trial.
-- New signups get status='trialing' + trial_ends_at = now+7d via Postgres trigger.
-- Razorpay only enters when owner taps Subscribe or trial expires.
--
-- ⚠️  Run this manually in the Supabase SQL Editor — do NOT apply via MCP.
-- ⚠️  This only replaces the handle_new_user() FUNCTION body.
--     The trigger (on_auth_user_created) is left untouched — CREATE OR REPLACE
--     keeps the trigger binding intact automatically.

-- 1. Update existing handle_new_user to create trialing subscription
-- This function ALREADY runs on auth.users insert via on_auth_user_created trigger.
-- Changing the subscriptions insert: status 'none' → 'trialing', + trial_ends_at = now()+7d.
-- The profiles insert is unchanged.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  );
  insert into public.subscriptions (user_id, status, plan, trial_ends_at)
  values (new.id, 'trialing', 'standard', now() + interval '7 days');
  return new;
end;
$$;

-- 2. Backfill: existing status='none' users get a trial (covers any stragglers)
update public.subscriptions
set status = 'trialing',
    trial_ends_at = now() + interval '7 days',
    updated_at = now()
where status = 'none' and trial_ends_at is null;

-- 3. Verification queries — paste output back to confirm
select status, count(*) from public.subscriptions group by status;
select u.email, s.status, s.trial_ends_at, s.created_at
from auth.users u join public.subscriptions s on s.user_id = u.id
order by s.created_at desc;
