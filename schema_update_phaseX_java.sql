-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase X
--  ☕ JAVA-IDE: viertes Lern-Tool (tool = 'java'), angelehnt an Codeboard.
--  Spiegelt konsequent Filius (Phase V):
--    - java_assignments          (Aufgaben; Start-Dateien + sichtbare Tests inline)
--    - java_assignment_solutions (Musterlösung + VERSTECKTE Tests, NUR Lehrkraft)
--    - java_submissions          (Abgaben: Dateien + Ergebnisse)
--    - java_submission_comments  (Rückmeldungen, freigebbar)
--    - java_assignment_templates (Vorlagen, teilbar)
--    - java_sandbox_projects     (private Sandbox-Projekte)
--  Sicherheits-Design Auto-Check:
--    checks (in java_assignments, für Schüler:innen lesbar) enthält NUR
--    Transparentes: {mode:"tests"|"solution"|"none", tests:[SICHTBARE Testfälle]}.
--    Musterlösung + versteckte Testfälle liegen in java_assignment_solutions
--    (RLS: nur Lehrkraft). Schüler:innen werten sichtbare Tests im Browser aus;
--    die Lehrkraft-Matrix wertet IMMER alles authoritativ neu aus (wie Filius).
--  -> Im Supabase-SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Aufgaben (Start-Dateien eingefroren + sichtbare Prüfungen als jsonb)
-- ---------------------------------------------------------------------------
create table if not exists public.java_assignments (
  id             uuid primary key default gen_random_uuid(),
  class_id       uuid not null references public.classes(id) on delete cascade,
  title          text not null,
  description    text,
  files_snapshot jsonb not null default '[]'::jsonb,  -- [{name,content,readonly,hidden}]
  checks         jsonb not null default '{"mode":"none","tests":[]}'::jsonb,
  published      boolean not null default false,
  released       boolean not null default false,      -- Musterlösung für Schüler:innen sichtbar
  position       int not null default 0,
  created_at     timestamptz not null default now()
);
alter table public.java_assignments enable row level security;

create or replace function public.is_java_assignment_teacher(p_assignment uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.java_assignments a
                 where a.id = p_assignment and public.is_class_teacher(a.class_id));
$$;
grant execute on function public.is_java_assignment_teacher(uuid) to authenticated;

create or replace function public.is_java_assignment_member(p_assignment uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.java_assignments a
                 join public.memberships m on m.class_id = a.class_id
                 where a.id = p_assignment and m.student_id = auth.uid());
$$;
grant execute on function public.is_java_assignment_member(uuid) to authenticated;

drop policy if exists java_teacher_all  on public.java_assignments;
create policy java_teacher_all on public.java_assignments for all
  using (public.is_class_teacher(class_id)) with check (public.is_class_teacher(class_id));
drop policy if exists java_student_read on public.java_assignments;
create policy java_student_read on public.java_assignments for select
  using (published and public.is_class_member(class_id));

-- ---------------------------------------------------------------------------
-- 2) Musterlösung + versteckte Tests (NUR Lehrkraft; Freigabe via RPC)
--    data = { files:[{name,content}], hidden_tests:[{id,name,stdin,expected,match}] }
-- ---------------------------------------------------------------------------
create table if not exists public.java_assignment_solutions (
  assignment_id uuid primary key references public.java_assignments(id) on delete cascade,
  author_id     uuid not null references public.profiles(id) on delete cascade,
  data          jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now()
);
alter table public.java_assignment_solutions enable row level security;
drop policy if exists javasol_teacher_all on public.java_assignment_solutions;
create policy javasol_teacher_all on public.java_assignment_solutions for all
  using (public.is_java_assignment_teacher(assignment_id))
  with check (public.is_java_assignment_teacher(assignment_id) and author_id = auth.uid());

-- Schüler:in bekommt NUR die Musterlösungs-Dateien (nie hidden_tests),
-- und nur wenn die Aufgabe veröffentlicht UND freigegeben (released) ist.
create or replace function public.java_solution_for_student(p_assignment uuid)
returns jsonb language sql security definer set search_path = public stable as $$
  select s.data->'files'
    from public.java_assignment_solutions s
    join public.java_assignments a on a.id = s.assignment_id
   where s.assignment_id = p_assignment
     and a.published and a.released
     and public.is_java_assignment_member(p_assignment);
$$;
grant execute on function public.java_solution_for_student(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Abgaben (genau eine je Aufgabe+Schüler:in): Dateien + Test-Ergebnisse
-- ---------------------------------------------------------------------------
create table if not exists public.java_submissions (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.java_assignments(id) on delete cascade,
  student_id    uuid not null references public.profiles(id) on delete cascade,
  files         jsonb not null default '[]'::jsonb,   -- [{name,content}]
  results       jsonb not null default '{}'::jsonb,   -- { "<test_id>": "correct"|"wrong" } (sichtbare Tests)
  passed        boolean,
  updated_at    timestamptz not null default now(),
  unique (assignment_id, student_id)
);
alter table public.java_submissions enable row level security;
drop policy if exists javasubm_student_all  on public.java_submissions;
create policy javasubm_student_all on public.java_submissions for all
  using (student_id = auth.uid())
  with check (student_id = auth.uid() and public.is_java_assignment_member(assignment_id));
drop policy if exists javasubm_teacher_read on public.java_submissions;
create policy javasubm_teacher_read on public.java_submissions for select
  using (public.is_java_assignment_teacher(assignment_id));

-- ---------------------------------------------------------------------------
-- 4) Lehrer-Rückmeldungen zu Abgaben (für Schüler:in freigebbar)
-- ---------------------------------------------------------------------------
create or replace function public.owns_java_submission(p_sub uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.java_submissions s
                 where s.id = p_sub and s.student_id = auth.uid());
$$;
grant execute on function public.owns_java_submission(uuid) to authenticated;

create or replace function public.is_java_submission_teacher(p_sub uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.java_submissions s
                 where s.id = p_sub and public.is_java_assignment_teacher(s.assignment_id));
$$;
grant execute on function public.is_java_submission_teacher(uuid) to authenticated;

create table if not exists public.java_submission_comments (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.java_submissions(id) on delete cascade,
  author_id     uuid not null references public.profiles(id) on delete cascade,
  body          text not null,
  released      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.java_submission_comments enable row level security;
drop policy if exists javacomm_teacher_all  on public.java_submission_comments;
drop policy if exists javacomm_student_read on public.java_submission_comments;
create policy javacomm_teacher_all on public.java_submission_comments for all
  using (public.is_java_submission_teacher(submission_id))
  with check (public.is_java_submission_teacher(submission_id) and author_id = auth.uid());
create policy javacomm_student_read on public.java_submission_comments for select
  using (released and public.owns_java_submission(submission_id));

-- ---------------------------------------------------------------------------
-- 5) Aufgaben-Vorlagen (wiederverwendbar, optional teilbar)
--    solution_data = { files:[...], hidden_tests:[...] } — nur Lehrkräfte
--    haben überhaupt Zugriff auf diese Tabelle (RLS unten), daher hier ok.
-- ---------------------------------------------------------------------------
create table if not exists public.java_assignment_templates (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.profiles(id) on delete cascade,
  title          text not null,
  description    text,
  files_snapshot jsonb not null default '[]'::jsonb,
  checks         jsonb not null default '{"mode":"none","tests":[]}'::jsonb,
  solution_data  jsonb not null default '{}'::jsonb,
  shared         boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.java_assignment_templates enable row level security;
drop policy if exists javatpl_owner_all on public.java_assignment_templates;
create policy javatpl_owner_all on public.java_assignment_templates for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and public.is_teacher_or_admin(auth.uid()));
drop policy if exists javatpl_admin_all on public.java_assignment_templates;
create policy javatpl_admin_all on public.java_assignment_templates for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists javatpl_shared_read on public.java_assignment_templates;
create policy javatpl_shared_read on public.java_assignment_templates for select
  using (shared and public.is_teacher_or_admin(auth.uid()));

create or replace function public.shared_java_templates()
returns table(id uuid, title text, description text, shared boolean, owner_id uuid, owner_name text,
              test_count int, created_at timestamptz, updated_at timestamptz, mine boolean)
language sql security definer set search_path = public stable as $$
  select t.id, t.title, t.description, t.shared, t.owner_id,
         coalesce(p.display_name, p.username) as owner_name,
         coalesce(jsonb_array_length(t.checks->'tests'), 0) as test_count,
         t.created_at, t.updated_at, (t.owner_id = auth.uid()) as mine
    from public.java_assignment_templates t
    join public.profiles p on p.id = t.owner_id
   where public.is_teacher_or_admin(auth.uid())
     and (t.owner_id = auth.uid() or t.shared or public.is_admin())
   order by lower(t.title);
$$;
grant execute on function public.shared_java_templates() to authenticated;

-- ---------------------------------------------------------------------------
-- 6) Sandbox-Projekte (privat, nur Eigentümer:in)
-- ---------------------------------------------------------------------------
create table if not exists public.java_sandbox_projects (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  title      text not null,
  files      jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.java_sandbox_projects enable row level security;
drop policy if exists javasbx_owner_all on public.java_sandbox_projects;
create policy javasbx_owner_all on public.java_sandbox_projects for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Fertig ✅  (Phase X – ☕ Java-IDE: Aufgaben, Musterlösungen + versteckte Tests,
--             Abgaben, Rückmeldungen, Vorlagen, Sandbox)
