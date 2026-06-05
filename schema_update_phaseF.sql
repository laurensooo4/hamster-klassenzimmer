-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase F
--  Admin-Suche/-Löschen + MEHRERE LEHRKRÄFTE pro Klasse (Admin weist zu)
--  -> Im Supabase SQL-Editor einfügen und "Run". (re-runnable / idempotent)
--  Alle Änderungen sind ADDITIV (bestehende Rechte bleiben unverändert).
-- ============================================================================

-- 1) Co-Lehrkräfte je Klasse --------------------------------------------------
create table if not exists public.class_teachers (
  class_id   uuid not null references public.classes(id)  on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (class_id, teacher_id)
);
alter table public.class_teachers enable row level security;

-- Hilfsfunktionen
create or replace function public.is_class_owner(p_class uuid)
returns boolean language sql security definer set search_path=public stable as $$
  select public.is_admin() or exists (select 1 from public.classes c
                 where c.id=p_class and c.teacher_id=auth.uid());
$$;
create or replace function public.is_teacher_or_admin(p_user uuid)
returns boolean language sql security definer set search_path=public stable as $$
  select exists (select 1 from public.profiles where id=p_user and role in ('teacher','admin'));
$$;
grant execute on function public.is_class_owner(uuid)      to authenticated;
grant execute on function public.is_teacher_or_admin(uuid) to authenticated;

-- 2) Bestehende Lehrer-Helfer additiv um Co-Lehrkräfte erweitern --------------
create or replace function public.is_class_teacher(p_class uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.is_admin()
      or exists (select 1 from public.classes c
                 where c.id=p_class and c.teacher_id=auth.uid())
      or exists (select 1 from public.class_teachers ct
                 where ct.class_id=p_class and ct.teacher_id=auth.uid());
$$;
create or replace function public.is_assignment_teacher(p_assignment uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.is_admin()
      or exists (select 1 from public.assignments a join public.classes c on c.id=a.class_id
                 where a.id=p_assignment and c.teacher_id=auth.uid())
      or exists (select 1 from public.assignments a join public.class_teachers ct on ct.class_id=a.class_id
                 where a.id=p_assignment and ct.teacher_id=auth.uid());
$$;
create or replace function public.shares_class_as_teacher(p_student uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.is_admin()
      or exists (select 1 from public.memberships m join public.classes c on c.id=m.class_id
                 where m.student_id=p_student and c.teacher_id=auth.uid())
      or exists (select 1 from public.memberships m join public.class_teachers ct on ct.class_id=m.class_id
                 where m.student_id=p_student and ct.teacher_id=auth.uid());
$$;
create or replace function public.is_submission_teacher(p_sub uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.is_admin()
      or exists (select 1 from public.submissions s join public.assignments a on a.id=s.assignment_id
                 join public.classes c on c.id=a.class_id where s.id=p_sub and c.teacher_id=auth.uid())
      or exists (select 1 from public.submissions s join public.assignments a on a.id=s.assignment_id
                 join public.class_teachers ct on ct.class_id=a.class_id where s.id=p_sub and ct.teacher_id=auth.uid());
$$;

-- 3) Policies für class_teachers + Klasse für Co-Lehrkräfte sichtbar ----------
drop policy if exists class_teachers_read on public.class_teachers;
create policy class_teachers_read on public.class_teachers for select
  using (public.is_class_teacher(class_id));
drop policy if exists class_teachers_write on public.class_teachers;
create policy class_teachers_write on public.class_teachers for all
  using (public.is_class_owner(class_id))
  with check (public.is_class_owner(class_id) and public.is_teacher_or_admin(teacher_id));

drop policy if exists classes_coteacher_read on public.classes;
create policy classes_coteacher_read on public.classes for select
  using (exists (select 1 from public.class_teachers ct
                 where ct.class_id = id and ct.teacher_id = auth.uid()));

-- 4) Schüler aus Klasse entfernen: Lehrkraft/Admin darf Mitgliedschaft löschen-
drop policy if exists memberships_teacher_manage on public.memberships;
create policy memberships_teacher_manage on public.memberships for delete
  using (public.is_class_teacher(class_id));

-- 5) Admin: Schüler-Account komplett löschen (cascade über auth.users) --------
create or replace function public.admin_delete_student(p_user uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'Nur Admin'; end if;
  if not exists (select 1 from public.profiles where id=p_user and role='student') then
     raise exception 'Nur Schueler-Accounts koennen so geloescht werden';
  end if;
  delete from auth.users where id = p_user;   -- cascade -> profiles, memberships, submissions, ...
end $$;
grant execute on function public.admin_delete_student(uuid) to authenticated;

-- Fertig ✅  (Phase F – Admin-Suche/-Löschen + Co-Lehrkräfte)
