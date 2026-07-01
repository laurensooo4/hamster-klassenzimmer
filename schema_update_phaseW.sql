-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase W
--  FIX: classes.tool-CHECK-Constraint kannte 'filius' noch nicht.
--  (Die Constraint stammt aus phaseM: check (tool in ('hamster','sql')).)
--  -> Neue Filius-Klassen scheiterten mit "classes_tool_check".
--  Erlaubt jetzt zusätzlich 'filius' (und 'java' für später).
--  -> Im Supabase-SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

alter table public.classes drop constraint if exists classes_tool_check;
alter table public.classes
  add constraint classes_tool_check check (tool in ('hamster','sql','filius','java'));

-- Fertig ✅  (Phase W – Filius als erlaubtes Tool für Klassen)
