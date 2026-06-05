-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase G
--  Rollenmodell: Admin ist ein FLAG auf einer Lehrkraft (kein eigener Rollenwert).
--  + Admin: Passwörter (alle außer Admins) & Lehrer/Schüler löschen; Lehrer zu Admin;
--    Eigentümer-Lehrkräfte verwalten Co-Lehrkräfte; Lehrkräfte je Klasse sichtbar.
--  -> Im Supabase-SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

-- 1) is_admin als Flag; 'admin'-Rolle zurück zu 'teacher' migrieren -----------
alter table public.profiles add column if not exists is_admin boolean not null default false;
update public.profiles set is_admin = true  where role = 'admin';
update public.profiles set role = 'teacher' where role = 'admin';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add  constraint profiles_role_check check (role in ('teacher','student'));
-- Admin nur für Lehrkräfte
alter table public.profiles drop constraint if exists profiles_admin_only_teacher;
alter table public.profiles add  constraint profiles_admin_only_teacher check (is_admin = false or role = 'teacher');

-- 2) is_admin() prüft jetzt das Flag ------------------------------------------
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_admin = true);
$$;

-- alte Rollen-Umschalt-RPC entfernen (Student<->Lehrer ist unerwünscht) --------
drop function if exists public.set_user_role(uuid, text);

-- 3) Admin macht eine Lehrkraft zum Admin / zurück ----------------------------
create or replace function public.set_admin(p_user uuid, p_make boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Nur Admin'; end if;
  if p_user = auth.uid() and not p_make then
    raise exception 'Du kannst dir den Admin-Rang nicht selbst entziehen';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and role = 'teacher') then
    raise exception 'Nur Lehrkraefte koennen Admin sein';
  end if;
  update public.profiles set is_admin = p_make where id = p_user;
end $$;
grant execute on function public.set_admin(uuid, boolean) to authenticated;

-- 4) Passwort zurücksetzen: Admin (alle außer Admins) ODER Lehrkraft (eigene) --
create or replace function public.reset_student_password(p_student uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare new_pw text;
begin
  if exists (select 1 from public.profiles where id = p_student and is_admin = true) then
    raise exception 'Admin-Passwoerter koennen hier nicht zurueckgesetzt werden';
  end if;
  if not public.is_admin() and not public.shares_class_as_teacher(p_student) then
    raise exception 'Keine Berechtigung';
  end if;
  new_pw := lpad((floor(random() * 1000000))::int::text, 6, '0');
  update auth.users
     set encrypted_password = extensions.crypt(new_pw, extensions.gen_salt('bf')), updated_at = now()
   where id = p_student;
  return new_pw;
end $$;
grant execute on function public.reset_student_password(uuid) to authenticated;

-- 5) Admin löscht Schüler ODER Lehrkraft (nie einen Admin) --------------------
create or replace function public.admin_delete_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Nur Admin'; end if;
  if exists (select 1 from public.profiles where id = p_user and is_admin = true) then
    raise exception 'Admins koennen nicht geloescht werden';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Nutzer nicht gefunden';
  end if;
  delete from auth.users where id = p_user;   -- cascade: Profil, Klassen(als Eigentümer), Abgaben, …
end $$;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- 6) Lehrkräfte einer Klasse mit Namen (für Anzeige) – nur Lehrkraft/Admin -----
create or replace function public.class_teachers_named(p_class uuid)
returns table(id uuid, display_name text, username text, is_owner boolean)
language sql security definer set search_path = public stable as $$
  select x.id, x.display_name, x.username, x.is_owner from (
    select p.id, p.display_name, p.username, true  as is_owner
      from public.classes c join public.profiles p on p.id = c.teacher_id
      where c.id = p_class
    union
    select p.id, p.display_name, p.username, false as is_owner
      from public.class_teachers ct join public.profiles p on p.id = ct.teacher_id
      where ct.class_id = p_class
  ) x
  where public.is_class_teacher(p_class)
  order by x.is_owner desc, x.display_name;
$$;
grant execute on function public.class_teachers_named(uuid) to authenticated;

-- 7) Zuweisbare Lehrkräfte (für das Dropdown) – nur Lehrkraft/Admin -----------
create or replace function public.assignable_teachers()
returns table(id uuid, display_name text, username text)
language sql security definer set search_path = public stable as $$
  select p.id, p.display_name, p.username
    from public.profiles p
   where p.role = 'teacher' and public.is_teacher_or_admin(auth.uid())
   order by p.display_name;
$$;
grant execute on function public.assignable_teachers() to authenticated;

-- Fertig ✅  (Phase G – Admin = Flag auf Lehrkraft + erweiterte Rechte)
