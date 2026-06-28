-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase Q
--  SQL-Playground: Lehrer-Rückmeldungen/Kommentare zu Abgaben (für Schüler:in freigebbar)
--  Spiegelt das Hamster-Vorbild `submission_comments` (Phase C) für `sql_submissions`.
--  -> Im Supabase-SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

-- Helfer: Besitzt die/der eingeloggte Schüler:in diese Abgabe?
create or replace function public.owns_sql_submission(p_sub uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.sql_submissions s
                 where s.id = p_sub and s.student_id = auth.uid());
$$;
grant execute on function public.owns_sql_submission(uuid) to authenticated;

-- Helfer: Ist die/der eingeloggte Nutzer:in Lehrkraft der Aufgabe zu dieser Abgabe?
-- (nutzt is_sql_assignment_teacher -> is_class_teacher = Eigentümer/Co-Lehrkraft/Admin)
create or replace function public.is_sql_submission_teacher(p_sub uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.sql_submissions s
                 where s.id = p_sub and public.is_sql_assignment_teacher(s.assignment_id));
$$;
grant execute on function public.is_sql_submission_teacher(uuid) to authenticated;

-- Lehrer-Kommentare zu einer Abgabe (genau einer je Abgabe; für Schüler:in freigebbar).
-- Eigene Tabelle: NICHT freigegebene Kommentare bleiben für Schüler:innen durch RLS
-- technisch unsichtbar (kein Auslesen über die Browser-Konsole).
create table if not exists public.sql_submission_comments (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.sql_submissions(id) on delete cascade,
  author_id     uuid not null references public.profiles(id) on delete cascade,
  body          text not null,
  released      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.sql_submission_comments enable row level security;

drop policy if exists sqlcomm_teacher_all  on public.sql_submission_comments;
drop policy if exists sqlcomm_student_read on public.sql_submission_comments;
create policy sqlcomm_teacher_all on public.sql_submission_comments for all
  using (public.is_sql_submission_teacher(submission_id))
  with check (public.is_sql_submission_teacher(submission_id) and author_id = auth.uid());
create policy sqlcomm_student_read on public.sql_submission_comments for select
  using (released and public.owns_sql_submission(submission_id));

-- Fertig ✅  (Phase Q – SQL-Rückmeldungen/Kommentare zu Abgaben)
