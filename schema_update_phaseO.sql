-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase O
--  SQL-Playground: Aufgaben (1 DB + geordnete Teilaufgaben mit Musterlösung)
--  -> Im Supabase-SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

create table if not exists public.sql_assignments (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes(id) on delete cascade,
  title       text not null,
  description text,
  database_id uuid references public.sql_databases(id) on delete set null,  -- Herkunft (Referenz)
  db_snapshot text not null default '',   -- DB-Text beim Stellen eingefroren (stabil gegen Bibliotheks-Änderungen)
  published   boolean not null default false,
  released    boolean not null default false,   -- Musterlösungen freigegeben (Phase 7)
  position    int not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.sql_assignments enable row level security;

create table if not exists public.sql_subtasks (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.sql_assignments(id) on delete cascade,
  position      int not null default 0,
  prompt        text not null default '',
  solution_sql  text not null default '',   -- GEHEIM (keine Schüler-Policy)
  compare       boolean not null default true,   -- Ergebnis mit Muster vergleichen?
  ordered       boolean not null default false,  -- ORDER BY relevant?
  expected      jsonb,                            -- Ergebnis-Snapshot (GEHEIM), Benotung in Phase 5
  created_at    timestamptz not null default now()
);
alter table public.sql_subtasks enable row level security;

create or replace function public.is_sql_assignment_teacher(p_assignment uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.sql_assignments a
                 where a.id = p_assignment and public.is_class_teacher(a.class_id));
$$;
grant execute on function public.is_sql_assignment_teacher(uuid) to authenticated;

-- sql_assignments: Lehrkraft (Eigentümer/Co/Admin) voll; Schüler:innen lesen nur VERÖFFENTLICHTE der eigenen Klasse
drop policy if exists sqla_teacher_all  on public.sql_assignments;
create policy sqla_teacher_all on public.sql_assignments for all
  using (public.is_class_teacher(class_id)) with check (public.is_class_teacher(class_id));
drop policy if exists sqla_student_read on public.sql_assignments;
create policy sqla_student_read on public.sql_assignments for select
  using (published and public.is_class_member(class_id));

-- sql_subtasks: nur Lehrkraft. KEINE Schüler-Policy (solution_sql/expected geheim ->
-- Schüler:innen lesen Teilaufgaben in Phase 5 über einen RPC ohne Geheimnisse).
drop policy if exists sqlsub_teacher_all on public.sql_subtasks;
create policy sqlsub_teacher_all on public.sql_subtasks for all
  using (public.is_sql_assignment_teacher(assignment_id)) with check (public.is_sql_assignment_teacher(assignment_id));

-- Fertig ✅  (Phase O – SQL-Aufgaben + Teilaufgaben)
