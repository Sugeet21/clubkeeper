-- ⚠ RUN MANUALLY in Supabase SQL editor. Not auto-applied.
-- Pricing visibility (Phase 0, issue #84): expose per-table public-safe pricing
-- on the clubs row so /c/<slug> can show a "View pricing" card without a second
-- round-trip and without granting anon any direct table access.
--
-- Paste into Supabase Dashboard → SQL Editor → New query → Run.

alter table public.clubs
  add column if not exists tables_json jsonb default '[]'::jsonb,
  add column if not exists accepts_pricing_display boolean default true;

-- Extend the public RPC so PlayerScan reads pricing in the same single call.
-- All existing returned fields are preserved.
create or replace function public.get_club_public_info(p_slug text)
returns table (
  club_name text,
  upi_id text,
  accepts_topups boolean,
  coins_enabled boolean,
  coin_tiers_json jsonb,
  tables_json jsonb,
  accepts_pricing_display boolean
)
language sql
security definer
set search_path = public
as $$
  select
    club_name,
    upi_id,
    accepts_topups,
    coins_enabled,
    coin_tiers_json,
    tables_json,
    accepts_pricing_display
  from public.clubs
  where slug = p_slug;
$$;
