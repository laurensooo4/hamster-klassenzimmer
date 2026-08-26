-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase C
--  Mehrere Abgaben + Historie, Lehrer-Kommentare (freigebbar), Musterlösungen
--  -> Im Supabase SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

-- 1) submissions: mehrere Abgaben je Schüler:in erlauben ----------------------
--    Bisher: unique(assignment_id, student_id) -> nur EINE Abgabe.
--    Neu: beliebig viele Abgaben (Historie); genau eine ist die "aktuelle".
alter table public.submissions drop constraint if exists submissions_assignment_id_student_id_key;
alter table public.submissions add column if not exists is_current boolean not null default true;

-- bestehende (je 1) Abgaben sind die aktuelle Version.
-- Wichtig: nur, wenn es fuer dieses Paar (Aufgabe, Schueler:in) noch KEINE
-- aktuelle gibt. Sonst haetten nach einem erneuten Einspielen alle Versionen
-- gleichzeitig die Markierung - und der eindeutige Index weiter unten liesse
-- dieses Update scheitern, sobald jemand mehr als einmal abgegeben hat.
update public.submissions s set is_current = true
 where s.is_current is distinct from true
   and not exists (select 1 from public.submissions n
                    where n.assignment_id = s.assignment_id
                      and n.student_id    = s.student_id
                      and n.is_current);

-- höchstens EINE aktuelle Abgabe je (Aufgabe, Schüler:in)
create unique index if not exists submissions_one_current
  on public.submissions (assignment_id, student_id) where is_current;

-- beim Einfügen/Setzen einer neuen "aktuellen" Abgabe alle anderen entaktualisieren
create or replace function public.submissions_set_current()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.is_current then
    update public.submissions
       set is_current = false
     where assignment_id = NEW.assignment_id
       and student_id    = NEW.student_id
       and id <> NEW.id
       and is_current;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_submissions_set_current on public.submissions;
create trigger trg_submissions_set_current
  before insert or update of is_current on public.submissions
  for each row execute function public.submissions_set_current();

-- 2) Lehrer-Kommentare zu einer Abgabe (für Schüler:in freigebbar) ------------
--    Eigene Tabelle: NICHT freigegebene Kommentare bleiben für Schüler:innen
--    durch RLS technisch unsichtbar (kein Auslesen über die Browser-Konsole).
create table if not exists public.submission_comments (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions(id) on delete cascade,
  author_id     uuid not null references public.profiles(id) on delete cascade,
  body          text not null,
  released      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.submission_comments enable row level security;

create or replace function public.owns_submission(p_sub uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.submissions s
                 where s.id = p_sub and s.student_id = auth.uid());
$$;
create or replace function public.is_submission_teacher(p_sub uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.submissions s
                 join public.assignments a on a.id = s.assignment_id
                 join public.classes c     on c.id = a.class_id
                 where s.id = p_sub and c.teacher_id = auth.uid());
$$;
grant execute on function public.owns_submission(uuid)       to authenticated;
grant execute on function public.is_submission_teacher(uuid) to authenticated;

drop policy if exists comments_teacher_all  on public.submission_comments;
drop policy if exists comments_student_read on public.submission_comments;
create policy comments_teacher_all on public.submission_comments for all
  using (public.is_submission_teacher(submission_id))
  with check (public.is_submission_teacher(submission_id));
create policy comments_student_read on public.submission_comments for select
  using (released and public.owns_submission(submission_id));

-- 3) Musterlösungen (mehrere je Aufgabe, freigebbar, löschbar) ----------------
create table if not exists public.sample_solutions (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  author_id     uuid not null references public.profiles(id) on delete cascade,
  title         text,
  code          text not null,
  released      boolean not null default false,
  created_at    timestamptz not null default now()
);
alter table public.sample_solutions enable row level security;

create or replace function public.is_assignment_member(p_assignment uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.assignments a
                 join public.memberships m on m.class_id = a.class_id
                 where a.id = p_assignment and m.student_id = auth.uid());
$$;
grant execute on function public.is_assignment_member(uuid) to authenticated;

drop policy if exists samples_teacher_all  on public.sample_solutions;
drop policy if exists samples_student_read on public.sample_solutions;
create policy samples_teacher_all on public.sample_solutions for all
  using (public.is_assignment_teacher(assignment_id))
  with check (public.is_assignment_teacher(assignment_id));
create policy samples_student_read on public.sample_solutions for select
  using (released and public.is_assignment_member(assignment_id));

-- Fertig ✅  (Phase C)
