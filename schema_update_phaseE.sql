-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase E (2/2)
--  Admin-Rolle: eine Admin-Person verwaltet alle Klassen & Nutzer:innen
--  -> Im Supabase SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

-- 1) Rolle 'admin' erlauben ---------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('teacher','student','admin'));

-- 2) Helfer: ist der/die Angemeldete Admin? (SECURITY DEFINER -> keine Rekursion)
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'admin');
$$;
grant execute on function public.is_admin() to authenticated;

-- 3) Bestehende Lehrer-Helfer um Admin erweitern ------------------------------
--    Admin besteht JEDEN Lehrer-Check -> Vollzugriff auf Aufgaben/Abgaben/
--    Kommentare/Musterlösungen/Lösungscode in ALLEN Klassen (über genau diese
--    vier Funktionen, die alle entsprechenden Policies nutzen).
create or replace function public.is_class_teacher(p_class uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.is_admin() or exists (select 1 from public.classes c
                 where c.id = p_class and c.teacher_id = auth.uid());
$$;
create or replace function public.is_assignment_teacher(p_assignment uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.is_admin() or exists (select 1 from public.assignments a
                 join public.classes c on c.id = a.class_id
                 where a.id = p_assignment and c.teacher_id = auth.uid());
$$;
create or replace function public.shares_class_as_teacher(p_student uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.is_admin() or exists (select 1 from public.memberships m
                 join public.classes c on c.id = m.class_id
                 where m.student_id = p_student and c.teacher_id = auth.uid());
$$;
create or replace function public.is_submission_teacher(p_sub uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.is_admin() or exists (select 1 from public.submissions s
                 join public.assignments a on a.id = s.assignment_id
                 join public.classes c     on c.id = a.class_id
                 where s.id = p_sub and c.teacher_id = auth.uid());
$$;

-- 4) Admin-Policies für die Tabellen ohne Helfer (Klassen/Profile/Mitglieder) -
drop policy if exists classes_admin_all on public.classes;
create policy classes_admin_all on public.classes for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists profiles_admin_read on public.profiles;
create policy profiles_admin_read on public.profiles for select
  using (public.is_admin());

drop policy if exists memberships_admin_all on public.memberships;
create policy memberships_admin_all on public.memberships for all
  using (public.is_admin()) with check (public.is_admin());

-- 5) RPC: Rolle einer Person setzen (nur Admin; nur student<->teacher) --------
create or replace function public.set_user_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Nur Admin darf Rollen ändern'; end if;
  if p_role not in ('student','teacher') then raise exception 'Ungültige Rolle'; end if;
  update public.profiles set role = p_role where id = p_user;
end $$;
grant execute on function public.set_user_role(uuid, text) to authenticated;

-- 6) DICH SELBST zum Admin machen: EINMAL ausführen, Benutzernamen anpassen ----
--    update public.profiles set role = 'admin' where username = 'DEIN_BENUTZERNAME';

-- Fertig ✅  (Phase E 2/2 – Admin)
