-- Add server-side authoritative coin total for topup confirmations.
-- Player-side browser cannot compute this correctly because welcome bonus
-- (and any future engagement bonus) is gated on owner-side Customer state.
-- Owner writes the actual credited total here on confirm; player reads it
-- back via get_topup_intent_status. See issue #87 and Pattern P1.
--
-- Applied to production via mcp__supabase__apply_migration on 15 Jun 2026.

alter table public.topup_intents
  add column if not exists coins_credited int;

-- Drop + recreate the status RPC to extend its return type. CREATE OR
-- REPLACE cannot change OUT parameters in Postgres.
drop function if exists public.get_topup_intent_status(uuid);

create function public.get_topup_intent_status(p_intent_id uuid)
returns table (status text, reject_reason text, coins_credited int)
language sql
security definer
set search_path = public
as $$
  select status, reject_reason, coins_credited
  from public.topup_intents
  where id = p_intent_id;
$$;

grant execute on function public.get_topup_intent_status(uuid) to anon, authenticated;
