-- Enable Supabase realtime broadcast for Player Hub tables.
-- Without these, postgres_changes events never fire on INSERT/UPDATE and the
-- owner-side TopupRealtimeBridge cannot deliver live notifications.
-- See issue #85.
--
-- Applied to production via mcp__supabase__apply_migration on 15 Jun 2026.
-- This file is kept under source control so the schema can be reproduced
-- on a fresh project.

alter publication supabase_realtime add table public.topup_intents;
alter publication supabase_realtime add table public.clubs;

-- REPLICA IDENTITY FULL is required for the bridge's UPDATE handler to
-- read payload.old.status when detecting pending → confirmed/rejected
-- transitions for the badge decrement guard. Default ('d') only carries
-- the primary key in old-row payloads.
alter table public.topup_intents replica identity full;
alter table public.clubs replica identity full;
