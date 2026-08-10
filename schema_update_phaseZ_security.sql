-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase Z  🔒 SICHERHEIT
--
--  Behebt die Funde des Sicherheits-Audits vom 10.08.2026:
--   1) KRITISCH: Lehrer-Registrierung hing an einem festen 4-stelligen Code
--      ('1969'), der zusätzlich anonym abfragbar war -> jede:r konnte sich zur
--      Lehrkraft machen.  NEU: einmalige, ablaufende Einladungscodes, die nur
--      Admins erzeugen (Tabelle teacher_invites).
--   2) KRITISCH: Konto-Übernahme-Kette. Eine Lehrkraft konnte per
--      teacher_enroll_student_by_username JEDE:N Schüler:in der Plattform in
--      die eigene Klasse zwingen und dadurch reset_student_password
--      freischalten (gibt das neue Passwort im Klartext zurück).
--      NEU: memberships.enrolled_by protokolliert, WER eingeschrieben hat;
--      eine selbst erzeugte Mitgliedschaft schaltet den Passwort-Reset NICHT
--      mehr frei.
--   3) HOCH: reset_student_password / teacher_enroll_student prüften die
--      Zielrolle nicht.  NEU: nur role='student'.
--   4) NIEDRIG: Hamster-Abgaben konnten in fremde Klassen geschrieben werden
--      (with check ohne Mitgliedschaftsprüfung) -> angeglichen an SQL/Java/Filius.
--   5) Sicherheitshalber nochmals enthalten: die beiden Java-Policy-Fixes aus
--      Phase Y v2 (Co-Lehrkraft-Freigabe + published-Gate) – idempotent, schadet
--      also nicht, falls schon eingespielt.
--
--  -> Im Supabase-SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 0) Hilfsfunktion: Einladungscode normalisieren (Groß/Klein + Trennzeichen egal)
-- ---------------------------------------------------------------------------
create or replace function public.norm_invite(p text)
returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- ---------------------------------------------------------------------------
-- 1) Lehrer-Einladungen: einmalig, ablaufend, nur von Admins erzeugbar
--    Gespeichert wird NUR der SHA-256-Hash – der Klartext-Code existiert
--    ausschließlich im Moment der Erzeugung (wie ein Passwort).
-- ---------------------------------------------------------------------------
create table if not exists public.teacher_invites (
  token_hash text primary key,
  note       text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_by    uuid references public.profiles(id) on delete set null,
  used_at    timestamptz
);
alter table public.teacher_invites enable row level security;

-- Nur Admins sehen/verwalten Einladungen. Die Prüfung bei der Registrierung
-- läuft über SECURITY-DEFINER-Funktionen und braucht daher keine Lese-Policy.
drop policy if exists tinv_admin_all on public.teacher_invites;
create policy tinv_admin_all on public.teacher_invites for all
  using (public.is_admin()) with check (public.is_admin());

-- Erzeugt einen neuen Einladungscode und gibt ihn EINMALIG im Klartext zurück.
create or replace function public.admin_create_teacher_invite(p_note text default null, p_days int default 14)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_bytes bytea; v_raw text := ''; v_code text; i int; v_days int;
begin
  if not public.is_admin() then
    raise exception 'Nur Admins können Lehrer-Einladungen erstellen';
  end if;
  v_days := greatest(1, least(coalesce(p_days, 14), 365));
  -- 20 Zeichen aus einem 32er-Alphabet ohne verwechselbare Zeichen (0/O, 1/I/L)
  -- = 100 Bit Entropie. 256 ist durch 32 teilbar -> keine Modulo-Verzerrung.
  v_bytes := extensions.gen_random_bytes(20);
  for i in 0..19 loop
    -- Alphabet: A-Z ohne I und O (24) + Ziffern 2-9 (8) = exakt 32 Zeichen
    v_raw := v_raw || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(v_bytes, i) % 32), 1);
  end loop;
  v_code := substr(v_raw,1,5) || '-' || substr(v_raw,6,5) || '-' || substr(v_raw,11,5) || '-' || substr(v_raw,16,5);
  insert into public.teacher_invites(token_hash, note, created_by, expires_at)
  values (encode(extensions.digest(public.norm_invite(v_code), 'sha256'), 'hex'),
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), now() + (v_days || ' days')::interval);
  return v_code;
end $$;
grant execute on function public.admin_create_teacher_invite(text, int) to authenticated;

-- Prüft einen Einladungscode (vor der Konto-Anlage, daher auch anonym nutzbar).
-- Anders als früher ist das KEIN Brute-Force-Orakel mehr: 100 Bit Zufall.
create or replace function public.check_teacher_code(p_code text)
returns boolean language sql security definer set search_path = public, extensions stable as $$
  select exists (
    select 1 from public.teacher_invites
     where token_hash = encode(extensions.digest(public.norm_invite(p_code), 'sha256'), 'hex')
       and used_by is null
       and expires_at > now());
$$;
grant execute on function public.check_teacher_code(text) to anon, authenticated;

-- Registrierung als Lehrkraft: verbraucht den Einladungscode ATOMAR.
-- Schlägt das Anlegen des Profils fehl, wird die ganze Transaktion (inkl.
-- Verbrauch) zurückgerollt – der Code bleibt dann gültig.
create or replace function public.register_teacher(p_username text, p_display text, p_code text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text;
begin
  v_hash := encode(extensions.digest(public.norm_invite(p_code), 'sha256'), 'hex');
  -- Zeile sperren (FOR UPDATE): eine parallele zweite Registrierung wartet und
  -- sieht danach used_by gesetzt -> der Code ist wirklich nur EINMAL nutzbar.
  perform 1 from public.teacher_invites
   where token_hash = v_hash and used_by is null and expires_at > now()
   for update;
  if not found then
    raise exception 'Einladungscode ist ungültig, bereits benutzt oder abgelaufen';
  end if;
  -- Profil zuerst anlegen: used_by hat einen Fremdschlüssel auf profiles,
  -- das Lehrer-Profil muss also vorher existieren.
  insert into public.profiles(id, username, role, display_name)
  values (auth.uid(), lower(trim(p_username)), 'teacher', p_display);
  update public.teacher_invites
     set used_by = auth.uid(), used_at = now()
   where token_hash = v_hash;
end $$;
grant execute on function public.register_teacher(text,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Konto-Übernahme-Kette schließen
--    memberships.enrolled_by hält fest, WER eingeschrieben hat:
--      NULL            = selbst per Klassencode beigetreten (join_class)
--      <uuid>          = von dieser Lehrkraft/Admin eingeschrieben
--    Der Passwort-Reset zählt eine Mitgliedschaft NICHT, wenn der/die
--    Aufrufer:in sie selbst angelegt hat -> die Berechtigung lässt sich nicht
--    mehr selbst herstellen.
-- ---------------------------------------------------------------------------
alter table public.memberships
  add column if not exists enrolled_by uuid references public.profiles(id) on delete set null;

create or replace function public.teacher_enroll_student(p_class uuid, p_student uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_class_teacher(p_class) then
    raise exception 'Keine Berechtigung für diese Klasse';
  end if;
  if not exists (select 1 from public.profiles where id = p_student and role = 'student') then
    raise exception 'Nur Schüler:innen können in Klassen eingeschrieben werden';
  end if;
  insert into public.memberships(class_id, student_id, enrolled_by)
  values (p_class, p_student, auth.uid())
  on conflict (class_id, student_id) do nothing;
end $$;
grant execute on function public.teacher_enroll_student(uuid, uuid) to authenticated;

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
  insert into public.memberships(class_id, student_id, enrolled_by)
  values (p_class, v_id, auth.uid())
  on conflict (class_id, student_id) do nothing;
  return v_name;
end $$;
grant execute on function public.teacher_enroll_student_by_username(uuid, text) to authenticated;

-- Darf ich das Passwort dieser Schüler:in zurücksetzen?  Nur wenn sie in einer
-- meiner Klassen ist UND diese Mitgliedschaft nicht von mir selbst stammt.
create or replace function public.can_reset_student(p_student uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.memberships m
     where m.student_id = p_student
       and public.is_class_teacher(m.class_id)
       and (m.enrolled_by is null or m.enrolled_by <> auth.uid()));
$$;
grant execute on function public.can_reset_student(uuid) to authenticated;

create or replace function public.reset_student_password(p_student uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare new_pw text := ''; b bytea; i int; v_role text; v_admin boolean;
begin
  select role, is_admin into v_role, v_admin from public.profiles where id = p_student;
  if v_role is null then
    raise exception 'Unbekanntes Konto';
  end if;
  if v_admin then
    raise exception 'Admin-Passwörter können hier nicht zurückgesetzt werden';
  end if;
  if v_role <> 'student' then
    raise exception 'Hier können nur Schüler-Passwörter zurückgesetzt werden';
  end if;
  if not public.is_admin() and not public.can_reset_student(p_student) then
    raise exception 'Keine Berechtigung';
  end if;
  b := extensions.gen_random_bytes(6);          -- kryptografisch zufällig statt random()
  for i in 0..5 loop
    new_pw := new_pw || ((get_byte(b, i) % 10))::text;
  end loop;
  update auth.users
     set encrypted_password = extensions.crypt(new_pw, extensions.gen_salt('bf')), updated_at = now()
   where id = p_student;
  return new_pw;
end $$;
grant execute on function public.reset_student_password(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Hamster-Abgaben: kein Schreiben in fremde Klassen mehr
--    (SQL/Java/Filius hatten die Prüfung bereits – Hamster als einziges nicht)
-- ---------------------------------------------------------------------------
drop policy if exists submissions_student_all on public.submissions;
create policy submissions_student_all on public.submissions for all
  using (student_id = auth.uid())
  with check (student_id = auth.uid() and public.is_assignment_member(assignment_id));

-- ---------------------------------------------------------------------------
-- 4) Java-Policy-Fixes aus Phase Y v2 (idempotent wiederholt, falls noch offen)
-- ---------------------------------------------------------------------------
create or replace function public.is_java_assignment_member_pub(p_assignment uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.java_assignments a
                 join public.memberships m on m.class_id = a.class_id
                 where a.id = p_assignment and a.published and m.student_id = auth.uid());
$$;
grant execute on function public.is_java_assignment_member_pub(uuid) to authenticated;

-- nur ausführen, wenn Phase Y die Tabelle schon angelegt hat
do $do$
begin
  if to_regclass('public.java_sample_solutions') is not null then
    drop policy if exists javasamp_teacher_all on public.java_sample_solutions;
    create policy javasamp_teacher_all on public.java_sample_solutions for all
      using (public.is_java_assignment_teacher(assignment_id))
      with check (public.is_java_assignment_teacher(assignment_id));

    drop policy if exists javasamp_student_read on public.java_sample_solutions;
    create policy javasamp_student_read on public.java_sample_solutions for select
      using (released and public.is_java_assignment_member_pub(assignment_id));
  end if;
end $do$;

-- Fertig ✅  (Phase Z – Sicherheits-Härtung)
--
-- WICHTIG danach:
--  · Der alte Lehrer-Code "1969" funktioniert NICHT mehr.
--  · Neue Lehrkräfte brauchen einen Einladungscode: Admin-Bereich ->
--    "Lehrer-Einladungen" -> "+ Einladung erstellen" (Code einmalig sichtbar).
--  · Bestehende Lehrer-Konten bleiben selbstverständlich unverändert.
