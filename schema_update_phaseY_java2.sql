-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase Y
--  ☕ JAVA-Tool, Ausbaustufe 2 (Lehrer-Feedback):
--    1) MEHRERE Abgaben je Aufgabe+Schüler:in (Historie, wie beim Hamster):
--       unique-Constraint weg, is_current-Flag + Trigger (genau EINE aktuell)
--    2) MEHRERE Musterlösungen je Aufgabe (java_sample_solutions, freigebbar,
--       wie sample_solutions beim Hamster)
--    3) Entwurf-Zwischenspeicher (java_drafts): Bearbeitungsstand wird beim
--       Verlassen der Aufgabe gesichert
--  -> Im Supabase-SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Abgabe-Historie: mehrere Abgaben, genau eine ist "aktuell"
-- ---------------------------------------------------------------------------
alter table public.java_submissions
  drop constraint if exists java_submissions_assignment_id_student_id_key;

alter table public.java_submissions
  add column if not exists is_current boolean not null default true;

create index if not exists java_submissions_aid_sid_idx
  on public.java_submissions (assignment_id, student_id);

create or replace function public.java_submissions_set_current()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.is_current then
    update public.java_submissions
       set is_current = false
     where assignment_id = NEW.assignment_id
       and student_id    = NEW.student_id
       and id <> NEW.id
       and is_current;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_java_submissions_set_current on public.java_submissions;
create trigger trg_java_submissions_set_current
  before insert or update of is_current on public.java_submissions
  for each row execute function public.java_submissions_set_current();

-- ---------------------------------------------------------------------------
-- 2) Musterlösungen (mehrere je Aufgabe, freigebbar, löschbar)
--    files = [{name,content}] · Lehrkraft voll, Schüler:innen NUR released
-- ---------------------------------------------------------------------------
create table if not exists public.java_sample_solutions (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.java_assignments(id) on delete cascade,
  author_id     uuid not null references public.profiles(id) on delete cascade,
  title         text,
  files         jsonb not null default '[]'::jsonb,
  released      boolean not null default false,
  created_at    timestamptz not null default now()
);
alter table public.java_sample_solutions enable row level security;

-- Lehrkraft (inkl. Co-Lehrkraft) voll — OHNE author_id im with check, sonst kann
-- eine Co-Lehrkraft fremde Musterlösungen nicht freigeben (wie beim Hamster).
drop policy if exists javasamp_teacher_all on public.java_sample_solutions;
create policy javasamp_teacher_all on public.java_sample_solutions for all
  using (public.is_java_assignment_teacher(assignment_id))
  with check (public.is_java_assignment_teacher(assignment_id));

-- Schüler:innen lesen NUR freigegebene UND nur bei VERÖFFENTLICHTER Aufgabe
-- (kein Lösungs-Zugriff mehr, wenn die Aufgabe in den Entwurf zurückgezogen wurde).
create or replace function public.is_java_assignment_member_pub(p_assignment uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.java_assignments a
                 join public.memberships m on m.class_id = a.class_id
                 where a.id = p_assignment and a.published and m.student_id = auth.uid());
$$;
grant execute on function public.is_java_assignment_member_pub(uuid) to authenticated;

drop policy if exists javasamp_student_read on public.java_sample_solutions;
create policy javasamp_student_read on public.java_sample_solutions for select
  using (released and public.is_java_assignment_member_pub(assignment_id));

-- ---------------------------------------------------------------------------
-- 3) Entwürfe (Bearbeitungsstand je Aufgabe+Schüler:in, privat)
-- ---------------------------------------------------------------------------
create table if not exists public.java_drafts (
  assignment_id uuid not null references public.java_assignments(id) on delete cascade,
  student_id    uuid not null references public.profiles(id) on delete cascade,
  files         jsonb not null default '[]'::jsonb,
  updated_at    timestamptz not null default now(),
  primary key (assignment_id, student_id)
);
alter table public.java_drafts enable row level security;

drop policy if exists javadraft_owner_all on public.java_drafts;
create policy javadraft_owner_all on public.java_drafts for all
  using (student_id = auth.uid())
  with check (student_id = auth.uid() and public.is_java_assignment_member(assignment_id));

-- Fertig ✅  (Phase Y – Java: Abgabe-Historie, mehrere Musterlösungen, Entwürfe)
