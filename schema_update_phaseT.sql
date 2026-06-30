-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase T
--  SICHERHEIT: Selbst-Einschreibung in fremde Klassen schließen.
--
--  Problem: Die bisherige RLS-Insert-Policy auf memberships prüfte nur
--  (student_id = auth.uid()) und NICHT die class_id. Ein:e Schüler:in konnte
--  sich daher per direktem Insert OHNE Klassencode in JEDE Klasse eintragen und
--  so deren veröffentlichte Aufgaben (inkl. freigegebener Lösungen) sowie
--  Sandbox-/Aufgaben-Datenbanken einsehen.
--
--  Fix: direkter Schüler-Insert wird gesperrt. Mitgliedschaften entstehen nur
--  noch über (a) join_class (security definer, prüft Code + join_open),
--  (b) teacher_enroll_student (neu, security definer, prüft is_class_teacher)
--  für den Lehrer-Import, (c) Admin.
--  -> Im Supabase-SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

-- Lehrer/Co-Lehrkraft/Admin schreibt eine:n vorhandene:n Schüler:in in die Klasse ein.
create or replace function public.teacher_enroll_student(p_class uuid, p_student uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_class_teacher(p_class) then
    raise exception 'Keine Berechtigung für diese Klasse';
  end if;
  insert into public.memberships(class_id, student_id)
  values (p_class, p_student)
  on conflict (class_id, student_id) do nothing;
end $$;
grant execute on function public.teacher_enroll_student(uuid, uuid) to authenticated;

-- Direkten Schüler-Insert sperren: Beitritt nur noch via join_class / teacher_enroll_student
-- (beide security definer -> umgehen diese Policy) bzw. Admin (memberships_admin_all).
drop policy if exists memberships_student_insert on public.memberships;
create policy memberships_student_insert on public.memberships
  for insert with check (false);

-- Fertig ✅  (Phase T – Selbst-Einschreibung geschlossen)
