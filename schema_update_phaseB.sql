-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase B
--  Veröffentlichen/Entwurf, Reihenfolge, Spickzettel, Aufgaben-Vorlagen
--  -> Im Supabase SQL-Editor einfügen und "Run". (re-runnable)
-- ============================================================================

-- 1) assignments: neue Spalten ------------------------------------------------
alter table public.assignments add column if not exists published boolean not null default true;
alter table public.assignments add column if not exists hint      text;

-- 1b) Spalte 'position' anlegen und bestehende Aufgaben EINMALIG durchnummerieren
--     Die Nummerierung laeuft ausschliesslich in dem Moment, in dem die Spalte
--     ueberhaupt erst entsteht. Wird diese Datei spaeter noch einmal
--     eingespielt - was seit dem automatischen Update regelmaessig passiert -,
--     existiert die Spalte bereits und es geschieht hier NICHTS mehr.
--
--     Warum so streng: Die Zeile stand frueher ungeschuetzt hier und setzte bei
--     jedem Lauf die Reihenfolge auf "aelteste zuerst" zurueck. Eine Bedingung
--     ueber die Datenwerte reicht nicht, weil die erste Aufgabe einer Klasse
--     regulaer die Position 0 traegt und damit wie ein unbenutzter Wert aussieht.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public'
                    and table_name   = 'assignments'
                    and column_name  = 'position') then
    execute 'alter table public.assignments add column position int not null default 0';
    execute $q$
      update public.assignments a set position = sub.rn
        from (select id, row_number() over (partition by class_id order by created_at) as rn
              from public.assignments) sub
       where a.id = sub.id
    $q$;
    raise notice 'Spalte position angelegt und bestehende Aufgaben durchnummeriert.';
  end if;
end $$;

-- 2) Schüler sehen nur VERÖFFENTLICHTE Aufgaben (serverseitig) ----------------
drop policy if exists assignments_student_read on public.assignments;
create policy assignments_student_read on public.assignments for select
  using (public.is_class_member(class_id) and published);

-- 3) Aufgaben-Vorlagen (pro Lehrkraft) ----------------------------------------
create table if not exists public.templates (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  title        text not null,
  description  text,
  territory    jsonb,
  starter_code text,
  goal         jsonb,
  hint         text,
  created_at   timestamptz not null default now()
);
alter table public.templates enable row level security;
drop policy if exists templates_owner_all on public.templates;
create policy templates_owner_all on public.templates for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Fertig ✅
