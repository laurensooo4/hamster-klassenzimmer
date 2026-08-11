-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase Z2  🔒
--  Stärkere Passwörter beim Zurücksetzen durch die Lehrkraft
-- ----------------------------------------------------------------------------
--  Bisher erzeugte reset_student_password() ein **6-stelliges Zahlen**-Passwort.
--  Das sind nur eine Million Möglichkeiten – über eine aus dem Internet
--  erreichbare Anmeldemaske ist so etwas in überschaubarer Zeit durchprobierbar,
--  besonders weil solche Passwörter oft tagelang unverändert bleiben.
--
--  NEU: 10 Zeichen aus einem 32er-Alphabet ohne verwechselbare Zeichen
--  (kein I, O, 0, 1) = 50 Bit. Bleibt gut vorlesbar und abtippbar, ist aber
--  nicht mehr zu erraten. Format: XXXXX-XXXXX
--
--  -> Im Supabase-SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

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

  -- 10 Zeichen aus einem 32er-Alphabet: 256 ist durch 32 teilbar -> keine Verzerrung
  b := extensions.gen_random_bytes(10);
  for i in 0..9 loop
    new_pw := new_pw || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 32), 1);
  end loop;
  new_pw := substr(new_pw,1,5) || '-' || substr(new_pw,6,5);

  update auth.users
     set encrypted_password = extensions.crypt(new_pw, extensions.gen_salt('bf')), updated_at = now()
   where id = p_student;
  return new_pw;
end $$;
grant execute on function public.reset_student_password(uuid) to authenticated;

-- Fertig ✅  (Phase Z2 – stärkere Reset-Passwörter)
