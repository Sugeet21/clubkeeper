-- #162 — session reversal (owner deletes a completed session with full undo).
-- Adds the audit columns so "who reversed this + why" travels to peer devices.
--
-- deleted_at already exists (Phase C soft-delete). updated_by already exists and
-- is stamped with auth.uid() by the #133 actor trigger, so "who" is partly
-- covered — but we add an explicit deleted_by for clarity (the reversal is an
-- UPDATE that sets deleted_at, and updated_by would also move on any later
-- edit), plus delete_reason for the owner's typed note. Both nullable/additive
-- — no backfill, rides the existing sessions RLS (owner UPDATE already allowed).
--
-- Rule M: probe information_schema.columns after apply.

alter table public.sessions add column if not exists deleted_by   uuid references auth.users(id);
alter table public.sessions add column if not exists delete_reason text;
