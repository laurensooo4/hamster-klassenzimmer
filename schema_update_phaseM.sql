-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase M
--  Mehr-Tool-Plattform: Klassen gehören genau einem Lern-Tool.
--  (Fundament für SQL-Playground neben dem Hamster-Simulator.)
--  -> Im Supabase-SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

-- Tool je Klasse. Bestehende Klassen bleiben 'hamster' (Default) -> keine Regression.
-- Nur 'hamster' und 'sql' erlaubt (Filius/Java werden in der UI nur deaktiviert gelistet,
-- es können also keine Klassen dafür angelegt werden, bis sie gebaut sind).
alter table public.classes
  add column if not exists tool text not null default 'hamster'
  check (tool in ('hamster','sql'));

-- Hilft beim tool-gefilterten Laden der Klassen einer Lehrkraft.
create index if not exists classes_teacher_tool_idx on public.classes(teacher_id, tool);

-- Fertig ✅  (Phase M – tool-Spalte auf classes)
