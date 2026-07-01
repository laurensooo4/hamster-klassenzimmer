-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase V
--  FILIUS-Netzwerksimulator: drittes Lern-Tool (tool = 'filius').
--  Spiegelt konsequent den SQL-Playground (Phasen N–U):
--    - filius_networks            (Netzwerk-Bibliothek, wie sql_databases)
--    - filius_assignments         (Aufgaben, wie sql_assignments; Prüfungen inline als jsonb)
--    - filius_assignment_solutions(Muster-Netzwerk je Aufgabe, NUR Lehrkraft; via RPC freigebbar)
--    - filius_submissions         (Abgaben, wie sql_submissions)
--    - filius_submission_comments (Rückmeldungen, wie sql_submission_comments)
--    - filius_assignment_templates(Vorlagen, wie sql_assignment_templates)
--    - filius_sandbox_projects    (private Sandbox-Projekte, wie sql_sandbox_projects)
--  Hinweis Bewertung: Netzwerk-Prüfungen (Ping erreichbar, IP im Netz, …) sind
--  TRANSPARENTE Abnahmekriterien und werden – wie in Filius selbst – im Browser
--  gegen das gebaute Netz ausgewertet. Die Abgabe speichert das komplette Netz
--  (data), sodass die Lehrkraft in der Einsicht die Prüfungen jederzeit
--  verlässlich nachvollziehen/neu ausführen kann (Quelle der Wahrheit).
--  -> Im Supabase-SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Netzwerk-Bibliothek (Start-/Beispiel-Netzwerke, optional teilbar)
-- ---------------------------------------------------------------------------
create table if not exists public.filius_networks (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  name       text not null,
  data       jsonb not null default '{}'::jsonb,   -- {nodes:[...], links:[...]}
  shared     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.filius_networks enable row level security;

drop policy if exists filnet_owner_all on public.filius_networks;
create policy filnet_owner_all on public.filius_networks for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists filnet_admin_all on public.filius_networks;
create policy filnet_admin_all on public.filius_networks for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists filnet_shared_read on public.filius_networks;
create policy filnet_shared_read on public.filius_networks for select
  using (shared and public.is_teacher_or_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 2) Aufgaben (1 Start-Netzwerk eingefroren + Prüfungen als jsonb-Liste)
-- ---------------------------------------------------------------------------
create table if not exists public.filius_assignments (
  id           uuid primary key default gen_random_uuid(),
  class_id     uuid not null references public.classes(id) on delete cascade,
  title        text not null,
  description  text,
  network_id   uuid references public.filius_networks(id) on delete set null,  -- Herkunft
  net_snapshot jsonb not null default '{}'::jsonb,   -- Start-Netz beim Stellen eingefroren
  checks       jsonb not null default '[]'::jsonb,   -- [{id,type,label,params}] (transparent)
  published    boolean not null default false,
  released     boolean not null default false,       -- Muster-Netzwerk für Schüler:innen sichtbar
  position     int not null default 0,
  created_at   timestamptz not null default now()
);
alter table public.filius_assignments enable row level security;

create or replace function public.is_filius_assignment_teacher(p_assignment uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.filius_assignments a
                 where a.id = p_assignment and public.is_class_teacher(a.class_id));
$$;
grant execute on function public.is_filius_assignment_teacher(uuid) to authenticated;

create or replace function public.is_filius_assignment_member(p_assignment uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.filius_assignments a
                 join public.memberships m on m.class_id = a.class_id
                 where a.id = p_assignment and m.student_id = auth.uid());
$$;
grant execute on function public.is_filius_assignment_member(uuid) to authenticated;

-- Lehrkraft (Eigentümer/Co/Admin) voll; Schüler:innen lesen nur VERÖFFENTLICHTE der eigenen Klasse.
-- (net_snapshot + checks sind KEINE Geheimnisse – das Muster-Netzwerk liegt in einer eigenen Tabelle.)
drop policy if exists fila_teacher_all  on public.filius_assignments;
create policy fila_teacher_all on public.filius_assignments for all
  using (public.is_class_teacher(class_id)) with check (public.is_class_teacher(class_id));
drop policy if exists fila_student_read on public.filius_assignments;
create policy fila_student_read on public.filius_assignments for select
  using (published and public.is_class_member(class_id));

-- ---------------------------------------------------------------------------
-- 3) Muster-Netzwerk je Aufgabe (NUR Lehrkraft; für Schüler:innen erst bei Freigabe via RPC)
-- ---------------------------------------------------------------------------
create table if not exists public.filius_assignment_solutions (
  assignment_id uuid primary key references public.filius_assignments(id) on delete cascade,
  author_id     uuid not null references public.profiles(id) on delete cascade,
  data          jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now()
);
alter table public.filius_assignment_solutions enable row level security;
drop policy if exists filsol_teacher_all on public.filius_assignment_solutions;
create policy filsol_teacher_all on public.filius_assignment_solutions for all
  using (public.is_filius_assignment_teacher(assignment_id))
  with check (public.is_filius_assignment_teacher(assignment_id) and author_id = auth.uid());

-- Schüler:in bekommt das Muster-Netzwerk NUR, wenn die Aufgabe freigegeben (released) ist.
create or replace function public.filius_solution_for_student(p_assignment uuid)
returns jsonb language sql security definer set search_path = public stable as $$
  select s.data
    from public.filius_assignment_solutions s
    join public.filius_assignments a on a.id = s.assignment_id
   where s.assignment_id = p_assignment
     and a.published and a.released
     and public.is_filius_assignment_member(p_assignment);
$$;
grant execute on function public.filius_solution_for_student(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Abgaben (genau eine je Aufgabe+Schüler:in): komplettes Netz + Prüf-Ergebnisse
-- ---------------------------------------------------------------------------
create table if not exists public.filius_submissions (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.filius_assignments(id) on delete cascade,
  student_id    uuid not null references public.profiles(id) on delete cascade,
  data          jsonb not null default '{}'::jsonb,   -- gebautes Netz {nodes,links}
  results       jsonb not null default '{}'::jsonb,   -- { "<check_id>": "correct"|"wrong" }
  passed        boolean,
  updated_at    timestamptz not null default now(),
  unique (assignment_id, student_id)
);
alter table public.filius_submissions enable row level security;
drop policy if exists filsubm_student_all  on public.filius_submissions;
create policy filsubm_student_all on public.filius_submissions for all
  using (student_id = auth.uid())
  with check (student_id = auth.uid() and public.is_filius_assignment_member(assignment_id));
drop policy if exists filsubm_teacher_read on public.filius_submissions;
create policy filsubm_teacher_read on public.filius_submissions for select
  using (public.is_filius_assignment_teacher(assignment_id));

-- ---------------------------------------------------------------------------
-- 5) Lehrer-Rückmeldungen zu Abgaben (für Schüler:in freigebbar)
-- ---------------------------------------------------------------------------
create or replace function public.owns_filius_submission(p_sub uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.filius_submissions s
                 where s.id = p_sub and s.student_id = auth.uid());
$$;
grant execute on function public.owns_filius_submission(uuid) to authenticated;

create or replace function public.is_filius_submission_teacher(p_sub uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.filius_submissions s
                 where s.id = p_sub and public.is_filius_assignment_teacher(s.assignment_id));
$$;
grant execute on function public.is_filius_submission_teacher(uuid) to authenticated;

create table if not exists public.filius_submission_comments (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.filius_submissions(id) on delete cascade,
  author_id     uuid not null references public.profiles(id) on delete cascade,
  body          text not null,
  released      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.filius_submission_comments enable row level security;
drop policy if exists filcomm_teacher_all  on public.filius_submission_comments;
drop policy if exists filcomm_student_read on public.filius_submission_comments;
create policy filcomm_teacher_all on public.filius_submission_comments for all
  using (public.is_filius_submission_teacher(submission_id))
  with check (public.is_filius_submission_teacher(submission_id) and author_id = auth.uid());
create policy filcomm_student_read on public.filius_submission_comments for select
  using (released and public.owns_filius_submission(submission_id));

-- ---------------------------------------------------------------------------
-- 6) Aufgaben-Vorlagen (wiederverwendbar, optional teilbar)
-- ---------------------------------------------------------------------------
create table if not exists public.filius_assignment_templates (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  title        text not null,
  description  text,
  net_snapshot jsonb not null default '{}'::jsonb,
  checks       jsonb not null default '[]'::jsonb,
  solution_net jsonb not null default '{}'::jsonb,
  shared       boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.filius_assignment_templates enable row level security;
drop policy if exists filtpl_owner_all on public.filius_assignment_templates;
create policy filtpl_owner_all on public.filius_assignment_templates for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and public.is_teacher_or_admin(auth.uid()));
drop policy if exists filtpl_admin_all on public.filius_assignment_templates;
create policy filtpl_admin_all on public.filius_assignment_templates for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists filtpl_shared_read on public.filius_assignment_templates;
create policy filtpl_shared_read on public.filius_assignment_templates for select
  using (shared and public.is_teacher_or_admin(auth.uid()));

create or replace function public.shared_filius_templates()
returns table(id uuid, title text, description text, shared boolean, owner_id uuid, owner_name text,
              check_count int, created_at timestamptz, updated_at timestamptz, mine boolean)
language sql security definer set search_path = public stable as $$
  select t.id, t.title, t.description, t.shared, t.owner_id,
         coalesce(p.display_name, p.username) as owner_name,
         coalesce(jsonb_array_length(t.checks), 0) as check_count,
         t.created_at, t.updated_at, (t.owner_id = auth.uid()) as mine
    from public.filius_assignment_templates t
    join public.profiles p on p.id = t.owner_id
   where public.is_teacher_or_admin(auth.uid())
     and (t.owner_id = auth.uid() or t.shared or public.is_admin())
   order by lower(t.title);
$$;
grant execute on function public.shared_filius_templates() to authenticated;

-- ---------------------------------------------------------------------------
-- 7) Sandbox-Projekte (privat, nur Eigentümer:in)
-- ---------------------------------------------------------------------------
create table if not exists public.filius_sandbox_projects (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  title      text not null,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.filius_sandbox_projects enable row level security;
drop policy if exists filsbx_owner_all on public.filius_sandbox_projects;
create policy filsbx_owner_all on public.filius_sandbox_projects for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 8) Bibliotheks-Übersichten (mit Ersteller-Name; profiles via SECURITY DEFINER)
-- ---------------------------------------------------------------------------
create or replace function public.shared_filius_networks()
returns table(id uuid, name text, shared boolean, owner_id uuid, owner_name text,
              created_at timestamptz, updated_at timestamptz, mine boolean)
language sql security definer set search_path = public stable as $$
  select d.id, d.name, d.shared, d.owner_id,
         coalesce(p.display_name, p.username) as owner_name,
         d.created_at, d.updated_at, (d.owner_id = auth.uid()) as mine
    from public.filius_networks d
    join public.profiles p on p.id = d.owner_id
   where public.is_teacher_or_admin(auth.uid())
     and (d.owner_id = auth.uid() or d.shared or public.is_admin())
   order by lower(d.name);
$$;
grant execute on function public.shared_filius_networks() to authenticated;

-- Sandbox: geteilte + eigene (Lehrkraft) + Aufgaben-Netze (Schüler:in) + Admin
create or replace function public.sandbox_filius_networks()
returns table(id uuid, name text, data jsonb, shared boolean,
              owner_id uuid, owner_name text, mine boolean)
language sql security definer set search_path = public stable as $$
  select d.id, d.name, d.data, d.shared, d.owner_id,
         coalesce(p.display_name, p.username) as owner_name,
         (d.owner_id = auth.uid()) as mine
    from public.filius_networks d
    join public.profiles p on p.id = d.owner_id
   where d.shared
      or d.owner_id = auth.uid()
      or public.is_admin()
      or exists (
           select 1
             from public.filius_assignments a
             join public.memberships m on m.class_id = a.class_id
            where a.network_id = d.id
              and a.published
              and m.student_id = auth.uid()
         )
   order by lower(d.name);
$$;
grant execute on function public.sandbox_filius_networks() to authenticated;

-- Fertig ✅  (Phase V – Filius-Netzwerksimulator: Bibliothek, Aufgaben, Abgaben,
--             Rückmeldungen, Vorlagen, Sandbox)
