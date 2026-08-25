-- ============================================================================
--  Hamster-Klassenzimmer · Schema-Update 2
--  Registrierung absichern (Lehrer-Code / Klassencode), Passwort zurücksetzen,
--  Demo-Daten aufräumen.
--  -> Im Supabase SQL-Editor einfügen und "Run". (Funktionen sind re-runnable.)
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- 1) Lehrer-Code serverseitig prüfen (anonym aufrufbar, hält den Code geheim) ----
create or replace function public.check_teacher_code(p_code text)
returns boolean language sql security definer set search_path = public stable as $$
  select p_code = '1969';
$$;
grant execute on function public.check_teacher_code(text) to anon, authenticated;

-- 2) Klassencode prüfen -> Klassenname (oder null) ------------------------------
create or replace function public.class_exists(p_code text)
returns text language sql security definer set search_path = public stable as $$
  select name from public.classes where code = upper(trim(p_code));
$$;
grant execute on function public.class_exists(text) to anon, authenticated;

-- 3) Lehrer registrieren – nur mit korrektem Code ------------------------------
create or replace function public.register_teacher(p_username text, p_display text, p_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_code <> '1969' then raise exception 'Falscher Lehrer-Code'; end if;
  insert into public.profiles(id, username, role, display_name)
  values (auth.uid(), lower(trim(p_username)), 'teacher', p_display);
end $$;
grant execute on function public.register_teacher(text,text,text) to authenticated;

-- 4) Direkte Profil-Erstellung nur noch als Schüler (Lehrer ausschließlich via RPC)
drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert on public.profiles for insert
  with check (id = auth.uid() and role = 'student');

-- 5) Schüler-Passwort zurücksetzen (nur Lehrkraft der Klasse) -> 6-stelliger Code
create or replace function public.reset_student_password(p_student uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare new_pw text;
begin
  if not exists (
    select 1 from public.memberships m join public.classes c on c.id = m.class_id
    where m.student_id = p_student and c.teacher_id = auth.uid()
  ) then raise exception 'Keine Berechtigung'; end if;
  new_pw := lpad((floor(random() * 1000000))::int::text, 6, '0');
  update auth.users
    set encrypted_password = extensions.crypt(new_pw, extensions.gen_salt('bf')),
        updated_at = now()
    where id = p_student;
  return new_pw;
end $$;
grant execute on function public.reset_student_password(uuid) to authenticated;

-- 6) Rollen-Eskalation verhindern: Nutzer dürfen nur display_name ändern --------
--    (sonst könnte ein Schüler per Update sein Feld role auf 'teacher' setzen)
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- 7) Demo-/Testdaten entfernen -------------------------------------------------
--    NUR, solange an dem Konto nichts hängt. Grund: Diese Datei läuft bei jedem
--    Einspielen des Schemas erneut, und 'max.muster' ist ein Name, den es an
--    einer Schule tatsächlich geben kann. Ohne diese Bedingung verschwände so
--    ein echtes Konto samt Abgaben stillschweigend beim nächsten Update.
delete from auth.users u
 where u.email in ('max.muster@hamster.local',
                   'qa.lehrer@hamster.local',
                   'qa.schueler@hamster.local')
   and not exists (select 1 from public.submissions s where s.student_id  = u.id)
   and not exists (select 1 from public.memberships m where m.student_id  = u.id)
   and not exists (select 1 from public.classes     c where c.teacher_id  = u.id);

-- Fertig ✅
