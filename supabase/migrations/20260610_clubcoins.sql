-- ClubCoins: add coin config columns to clubs table
-- so the public scan page can show "Earn N coins" preview.
-- Paste into Supabase SQL Editor (Dashboard → SQL Editor → New query).

alter table public.clubs
  add column if not exists coins_enabled boolean default false,
  add column if not exists coin_tiers_json jsonb default '[]'::jsonb;

-- Update the public RPC to return coin config for the player scan page.
create or replace function public.get_club_public_info(p_slug text)
returns table (
  club_name text,
  upi_id text,
  accepts_topups boolean,
  coins_enabled boolean,
  coin_tiers_json jsonb
)
language sql
security definer
set search_path = public
as $$
  select club_name, upi_id, accepts_topups, coins_enabled, coin_tiers_json
  from public.clubs
  where slug = p_slug;
$$;
