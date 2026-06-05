-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase H
--  Befehls-Übersicht (Spickzettel) je Aufgabe/Vorlage ein-/ausblendbar
--  -> Im Supabase-SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

-- Schüler:innen dürfen die Befehls-Übersicht standardmäßig einblenden;
-- die Lehrkraft kann das je Aufgabe abschalten (z. B. für eine Klausur).
alter table public.assignments add column if not exists show_commands boolean not null default true;

-- Vorlagen führen die Einstellung mit (nullable -> wird beim Anlegen einer
-- Aufgabe als "an" interpretiert, wenn nicht gesetzt).
alter table public.templates   add column if not exists show_commands boolean;

-- Fertig ✅  (Phase H – Befehls-Übersicht je Aufgabe)
