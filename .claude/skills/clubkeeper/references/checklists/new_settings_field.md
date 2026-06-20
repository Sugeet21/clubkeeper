# New settings field — pre-write checklist

Fill this in BEFORE writing any code. Paste your filled answers into the
PR description. If you cannot answer a question, stop and ask Sugeet.

Field name (camelCase): ___
Type: boolean | number | string | enum | array | object
Default value: ___
Is this field also mirrored to Supabase? yes | no
  If yes, which RPC / column? ___
  Is it Dexie-first (mirror after) or Supabase-first (read back)? ___
UI shape: toggle | select | numeric input | text input | multi-field block
  If "multi-field block" (atomic save of several fields together), STOP —
  useDexieSetting is per-field. You need the coins-style pattern; see
  handleSaveRates in PlayerHubSettings.tsx. Reference Pattern R4 §Exceptions.
Will the input have a typing buffer (numeric/text)? yes | no
  If yes, use the typing-buffer variant (see architecture.md).

Before writing the component:
[ ] Added field to ClubSettings type in src/types/index.ts
[ ] Bumped Dexie version with additive change (no .upgrade needed if
    optional) — see ripple_effects.md "If you add a ClubSettings field"
[ ] Confirmed updateSettings() in queries.ts already handles this field
    (it should — it's a generic patch). If not, fix it.
[ ] If mirroring to Supabase: added the mirror call at the SAME call site
    that invokes setValue from the hook. Mirror is fire-and-forget; never
    read back into local state.

Component code:
[ ] Read via useDexieSetting('fieldName', defaultValue) — NEVER useState
[ ] No useEffect that syncs from settings → local state for this field
[ ] No getOwnerClub() / Supabase read in mount effect for this field
[ ] No "loaded" flag for this field
[ ] If typing buffer: useEffect(() => setDraft(String(source)), [source])
    with blur-handler that validates + calls setValue OR reverts draft

Verify (manual):
[ ] Toggle/edit → navigate away → return → value persists
[ ] Hard refresh → value persists
[ ] DevTools → Application → IndexedDB → settings row matches UI
[ ] If mirrored: Supabase row matches Dexie
