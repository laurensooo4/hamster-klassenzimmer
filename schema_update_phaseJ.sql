-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase J
--  (1) Lehrer-Notizen je Schüler:in & Klasse (privat)
--  (2) Schüler-Kommentar zur eigenen Abgabe (Lehrkraft kann lesen)
--  (3) Schüler-Überblick für die Lehrkraft: letzter Login + letzte Aktivität
--  -> Im Supabase-SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

-- 1) Lehrer-Notizen je Schüler:in & Klasse -----------------------------------
--    Privat: NUR Lehrkräfte der Klasse (is_class_teacher). Schüler:innen haben
--    keinerlei Zugriff (auch nicht lesend auf Notizen über sich selbst).
create table if not exists public.student_notes (
  class_id   uuid not null references public.classes(id)  on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  body       text not null default '',
  updated_at timestamptz not null default now(),
  primary key (class_id, student_id)
);
alter table public.student_notes enable row level security;
drop policy if exists student_notes_teacher_all on public.student_notes;
create policy student_notes_teacher_all on public.student_notes for all
  using (public.is_class_teacher(class_id))
  with check (public.is_class_teacher(class_id));

-- 2) Schüler-Kommentar zur eigenen Abgabe ------------------------------------
--    Schreiben nur der/die Abgeber:in (owns_submission); Lesen zusätzlich die
--    zuständige Lehrkraft (is_submission_teacher). Beide Helfer aus Phase C/F.
create table if not exists public.submission_student_notes (
  submission_id uuid primary key references public.submissions(id) on delete cascade,
  body          text not null default '',
  updated_at    timestamptz not null default now()
);
alter table public.submission_student_notes enable row level security;
drop policy if exists ssn_read on public.submission_student_notes;
create policy ssn_read on public.submission_student_notes for select
  using (public.owns_submission(submission_id) or public.is_submission_teacher(submission_id));
drop policy if exists ssn_owner_write on public.submission_student_notes;
create policy ssn_owner_write on public.submission_student_notes for all
  using (public.owns_submission(submission_id))
  with check (public.owns_submission(submission_id));

-- 3) Schüler-Überblick (letzter Login + letzte Aktivität) --------------------
--    SECURITY DEFINER (liest auth.users + Sandbox owner-only); freigegeben nur
--    für eine Lehrkraft, die eine Klasse mit dem/der Schüler:in teilt (oder Admin).
--    Gibt 0 Zeilen zurück, wenn nicht berechtigt.
create or replace function public.student_overview(p_student uuid)
returns table(last_login timestamptz, last_submission timestamptz, last_sandbox timestamptz)
language sql security definer set search_path = public as $$
  select
    (select u.last_sign_in_at from auth.users u            where u.id = p_student),
    (select max(s.submitted_at) from public.submissions s  where s.student_id = p_student),
    (select max(sp.updated_at) from public.sandbox_projects sp where sp.owner_id = p_student)
  where public.is_admin() or public.shares_class_as_teacher(p_student);
$$;
grant execute on function public.student_overview(uuid) to authenticated;

-- Fertig ✅  (Phase J – Matrix-Suche [UI], Schülerprofil, Schüler-Abgabe-Kommentar)
