-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase U
--  (1) Vorhandene Schüler:innen per Benutzername zu einer Klasse hinzufügen
--  (2) SQL-Sandbox: private Projekte speichern (wie beim Hamster-Simulator)
--  -> Im Supabase-SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

-- (1) Lehrer/Co-Lehrkraft/Admin schreibt eine:n VORHANDENE:N Schüler:in per
--     Benutzername in die Klasse ein (security definer, prüft is_class_teacher).
create or replace function public.teacher_enroll_student_by_username(p_class uuid, p_username text)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text;
begin
  if not public.is_class_teacher(p_class) then
    raise exception 'Keine Berechtigung für diese Klasse';
  end if;
  select id, coalesce(display_name, username)
    into v_id, v_name
    from public.profiles
   where lower(username) = lower(trim(p_username)) and role = 'student';
  if v_id is null then
    raise exception 'Kein:e Schüler:in mit diesem Benutzernamen gefunden';
  end if;
  insert into public.memberships(class_id, student_id)
  values (p_class, v_id)
  on conflict (class_id, student_id) do nothing;
  return v_name;
end $$;
grant execute on function public.teacher_enroll_student_by_username(uuid, text) to authenticated;

-- (2) SQL-Sandbox-Projekte (privat, nur Eigentümer:in). db_text = eingefrorene
--     Datenbank (sql.js db.run-tauglich), query = zuletzt gespeicherte Abfrage.
create table if not exists public.sql_sandbox_projects (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  title      text not null,
  db_text    text not null default '',
  query      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sql_sandbox_projects enable row level security;
drop policy if exists sqlsbx_owner_all on public.sql_sandbox_projects;
create policy sqlsbx_owner_all on public.sql_sandbox_projects for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Fertig ✅  (Phase U – vorhandene Schüler hinzufügen + SQL-Sandbox-Projekte)
