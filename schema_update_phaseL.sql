-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase L
--  (1) Klassencode deaktivieren/aktivieren  (neue Spalte classes.join_open)
--  (2) join_class / class_exists respektieren join_open
--  (3) Admin: Rolle setzen (für Lehrer-/Schüler-Import ohne Klasse)
--  (4) Admin: Vor-/Nachnamen (display_name) ändern
--  (5) RPC class_activity() für die Sortierung "letzte Änderung" der Übersicht
--  -> Im Supabase-SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

-- 1) Klassencode an/aus: join_open steuert, ob mit dem Code beigetreten werden darf
--    Bestehende Klassen bleiben offen (default true -> keine Regression).
alter table public.classes add column if not exists join_open boolean not null default true;

-- 2) Beitritt per Code nur wenn join_open = true ----------------------------
--    (deaktivierter ODER unbekannter Code -> dieselbe neutrale Fehlermeldung)
create or replace function public.join_class(p_code text)
returns public.classes
language plpgsql security definer set search_path = public as $$
declare cls public.classes;
begin
  select * into cls from public.classes
   where code = upper(trim(p_code)) and join_open = true;
  if cls.id is null then
    raise exception 'Klassencode nicht gefunden';
  end if;
  insert into public.memberships (class_id, student_id)
  values (cls.id, auth.uid())
  on conflict (class_id, student_id) do nothing;
  return cls;
end $$;
grant execute on function public.join_class(text) to authenticated;

-- class_exists (Registrierungs-Vorabprüfung) ebenfalls an join_open koppeln,
-- damit ein deaktivierter Code schon bei der Anmeldung als "nicht gefunden" gilt.
create or replace function public.class_exists(p_code text)
returns text language sql security definer set search_path = public stable as $$
  select name from public.classes
   where code = upper(trim(p_code)) and join_open = true;
$$;
grant execute on function public.class_exists(text) to anon, authenticated;

-- 3) Admin: Rolle einer Person setzen (student <-> teacher) ------------------
--    Nur Admin; niemals Admins selbst ändern (würde profiles_admin_only_teacher
--    verletzen). Gebraucht für den Admin-Import von Lehrkräften ohne Klasse.
create or replace function public.admin_set_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Nur Admin'; end if;
  if p_role not in ('student','teacher') then raise exception 'Ungueltige Rolle'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Nutzer:in nicht gefunden';
  end if;
  if exists (select 1 from public.profiles where id = p_user and is_admin) then
    raise exception 'Die Rolle von Admins kann nicht geaendert werden';
  end if;
  update public.profiles set role = p_role where id = p_user;
end $$;
grant execute on function public.admin_set_role(uuid, text) to authenticated;

-- 4) Admin: Anzeigenamen (Vor-/Nachname) einer Person ändern -----------------
--    Nur Admin. (Normale Nutzer dürfen weiterhin nur den EIGENEN display_name
--    ändern – das regelt die Spalten-Grant aus schema_update.sql.)
create or replace function public.admin_set_display_name(p_user uuid, p_display text)
returns void language plpgsql security definer set search_path = public as $$
declare d text;
begin
  if not public.is_admin() then raise exception 'Nur Admin'; end if;
  d := nullif(btrim(p_display), '');
  if d is null then raise exception 'Der Name darf nicht leer sein'; end if;
  if char_length(d) > 80 then raise exception 'Der Name ist zu lang (max. 80 Zeichen)'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Nutzer:in nicht gefunden';
  end if;
  update public.profiles set display_name = d where id = p_user;
end $$;
grant execute on function public.admin_set_display_name(uuid, text) to authenticated;

-- 5) class_activity(): letzte Aktivität je Klasse (für Übersicht-Sortierung) --
--    Liefert pro Klasse, mit der die aufrufende Person verbunden ist
--    (Eigentümer-Lehrkraft, Co-Lehrkraft ODER Mitglied), den jüngsten Zeitpunkt
--    aus allen Abgaben der Klasse (Fallback: Erstelldatum der Klasse).
--    SECURITY DEFINER, damit auch Schüler:innen die Klassen-weite "letzte
--    Abgabe" als reinen Zeitstempel bekommen (keine fremden Daten sichtbar).
create or replace function public.class_activity()
returns table(class_id uuid, last_at timestamptz)
language sql security definer set search_path = public stable as $$
  select c.id,
         greatest(c.created_at, coalesce(max(s.submitted_at), c.created_at)) as last_at
    from public.classes c
    left join public.assignments a on a.class_id = c.id
    left join public.submissions  s on s.assignment_id = a.id
   where c.teacher_id = auth.uid()
      or exists (select 1 from public.class_teachers ct
                  where ct.class_id = c.id and ct.teacher_id = auth.uid())
      or exists (select 1 from public.memberships m
                  where m.class_id = c.id and m.student_id = auth.uid())
   group by c.id, c.created_at;
$$;
grant execute on function public.class_activity() to authenticated;

-- Fertig ✅  (Phase L – Klassencode an/aus & neu, Admin-Import-Rolle, Admin-Name, Aktivitäts-Sortierung)
