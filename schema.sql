-- ============================================================================
--  Hamster-Klassenzimmer · Supabase / PostgreSQL Schema
--  ----------------------------------------------------------------------------
--  Anwendung: Im Supabase-Dashboard -> "SQL Editor" -> "New query"
--  diesen kompletten Inhalt einfügen und auf "Run" klicken.
--  Das Skript ist mehrfach ausführbar (idempotent).
-- ============================================================================

-- ---------- Tabellen --------------------------------------------------------

-- Profil je Login (1:1 zu auth.users) mit Rolle und Username
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text unique not null,
  role         text not null default 'student' check (role in ('teacher','student')),
  display_name text,
  created_at   timestamptz not null default now()
);

-- Klassen (gehören einem Lehrer, haben einen Einlade-Code)
create table if not exists public.classes (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  code       text unique not null,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Mitgliedschaften (welcher Schüler ist in welcher Klasse)
create table if not exists public.memberships (
  id         uuid primary key default gen_random_uuid(),
  class_id   uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  unique (class_id, student_id)
);

-- Aufgaben (Territorium + Beschreibung, optional Auto-Check-Ziel)
create table if not exists public.assignments (
  id           uuid primary key default gen_random_uuid(),
  class_id     uuid not null references public.classes(id) on delete cascade,
  title        text not null,
  description  text,
  territory    jsonb,
  starter_code text,
  goal         jsonb,
  created_at   timestamptz not null default now()
);

-- Abgaben (ein Schüler-Code je Aufgabe, Wiederabgabe überschreibt)
create table if not exists public.submissions (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id    uuid not null references public.profiles(id) on delete cascade,
  code          text not null,
  status        text not null default 'submitted',
  passed        boolean,
  submitted_at  timestamptz not null default now(),
  unique (assignment_id, student_id)
);

-- ---------- Hilfsfunktionen (SECURITY DEFINER -> verhindern RLS-Rekursion) ---

create or replace function public.is_class_teacher(p_class uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.classes c
                 where c.id = p_class and c.teacher_id = auth.uid());
$$;

create or replace function public.is_class_member(p_class uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.memberships m
                 where m.class_id = p_class and m.student_id = auth.uid());
$$;

create or replace function public.is_assignment_teacher(p_assignment uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.assignments a
                 join public.classes c on c.id = a.class_id
                 where a.id = p_assignment and c.teacher_id = auth.uid());
$$;

create or replace function public.shares_class_as_teacher(p_student uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.memberships m
                 join public.classes c on c.id = m.class_id
                 where m.student_id = p_student and c.teacher_id = auth.uid());
$$;

grant execute on function public.is_class_teacher(uuid)        to authenticated;
grant execute on function public.is_class_member(uuid)         to authenticated;
grant execute on function public.is_assignment_teacher(uuid)   to authenticated;
grant execute on function public.shares_class_as_teacher(uuid) to authenticated;

-- ---------- Row Level Security aktivieren -----------------------------------

alter table public.profiles    enable row level security;
alter table public.classes     enable row level security;
alter table public.memberships enable row level security;
alter table public.assignments enable row level security;
alter table public.submissions enable row level security;

-- ---------- Policies --------------------------------------------------------
-- profiles
drop policy if exists profiles_self_select          on public.profiles;
drop policy if exists profiles_self_insert          on public.profiles;
drop policy if exists profiles_self_update          on public.profiles;
drop policy if exists profiles_teacher_read_students on public.profiles;
create policy profiles_self_select on public.profiles for select using (id = auth.uid());
create policy profiles_self_insert on public.profiles for insert with check (id = auth.uid());
create policy profiles_self_update on public.profiles for update using (id = auth.uid());
create policy profiles_teacher_read_students on public.profiles for select
  using (public.shares_class_as_teacher(id));

-- classes
drop policy if exists classes_teacher_all   on public.classes;
drop policy if exists classes_student_read  on public.classes;
create policy classes_teacher_all on public.classes for all
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());
create policy classes_student_read on public.classes for select
  using (public.is_class_member(id));

-- memberships
drop policy if exists memberships_student_self   on public.memberships;
drop policy if exists memberships_student_insert on public.memberships;
drop policy if exists memberships_teacher_read   on public.memberships;
create policy memberships_student_self on public.memberships for select using (student_id = auth.uid());
create policy memberships_student_insert on public.memberships for insert with check (student_id = auth.uid());
create policy memberships_teacher_read on public.memberships for select
  using (public.is_class_teacher(class_id));

-- assignments
drop policy if exists assignments_teacher_all  on public.assignments;
drop policy if exists assignments_student_read on public.assignments;
create policy assignments_teacher_all on public.assignments for all
  using (public.is_class_teacher(class_id)) with check (public.is_class_teacher(class_id));
create policy assignments_student_read on public.assignments for select
  using (public.is_class_member(class_id));

-- submissions
drop policy if exists submissions_student_all  on public.submissions;
drop policy if exists submissions_teacher_read on public.submissions;
create policy submissions_student_all on public.submissions for all
  using (student_id = auth.uid()) with check (student_id = auth.uid());
create policy submissions_teacher_read on public.submissions for select
  using (public.is_assignment_teacher(assignment_id));

-- ---------- RPC: Klasse per Code beitreten ----------------------------------
create or replace function public.join_class(p_code text)
returns public.classes
language plpgsql security definer set search_path = public as $$
declare cls public.classes;
begin
  select * into cls from public.classes where code = upper(trim(p_code));
  if cls.id is null then
    raise exception 'Klassencode nicht gefunden';
  end if;
  insert into public.memberships (class_id, student_id)
  values (cls.id, auth.uid())
  on conflict (class_id, student_id) do nothing;
  return cls;
end $$;
grant execute on function public.join_class(text) to authenticated;

-- Fertig. ✅
