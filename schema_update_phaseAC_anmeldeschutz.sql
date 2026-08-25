-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase AC
--  Schutz gegen Passwort-Raten: Konto sperrt nach 5 Fehlversuchen,
--  Freigabe nur durch eine Admin-Person.
--
--  WARUM SO UND NICHT ANDERS
--  Zwei Wege wurden gemessen und verworfen:
--    * Zählen im Browser: Der öffentliche Anmeldeschlüssel steht im Quelltext.
--      Wer direkt gegen /supabase/auth/v1/token schickt, meldet der Web-App
--      nichts und würde nie gezählt. Das schützt also gar nichts.
--    * Zählen aus dem Anmelde-Protokoll (auth.audit_log_entries): gemessen —
--      GoTrue schreibt dort NUR erfolgreiche Anmeldungen hinein. Fünf falsche
--      Passwörter hintereinander erzeugten null Einträge.
--
--  Gebaut ist es deshalb über den Auth-Hook "password_verification_attempt":
--  GoTrue ruft nach JEDER Passwortprüfung diese Datenbankfunktion auf und
--  teilt mit, ob das Passwort stimmte. Das gilt auch für Anfragen, die an der
--  Web-App vorbei geschickt werden — dort ist also nichts zu umgehen.
--  Durchgesetzt wird die Sperre über auth.users.banned_until; das prüft GoTrue
--  selbst (gemessen: Anmeldung mit RICHTIGEM Passwort ergibt dann
--  "user_banned").
--
--  EINSPIELEN (im Ordner supabase/docker):
--      docker compose exec -T db psql -U supabase_admin -d postgres \
--        -v ON_ERROR_STOP=1 < hamster-site/schema_update_phaseAC_anmeldeschutz.sql
--
--  DANACH ist noch EIN Schritt nötig: der Auth-Dienst muss den Hook kennen.
--  Siehe docker-compose.override.yml (Abschnitt "auth") und dann
--      docker compose up -d auth
--
--  Gefahrlos wiederholbar, verändert keine vorhandenen Daten.
-- ============================================================================

-- --------------------------------------------------------------- Zählwerk --
create table if not exists public.anmelde_sperren (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  fehlversuche   integer not null default 0,
  letzter_versuch timestamptz,
  gesperrt_seit  timestamptz
);
alter table public.anmelde_sperren enable row level security;

comment on table  public.anmelde_sperren                is 'Fehlversuche je Konto. Wird vom Auth-Hook gepflegt, nicht von der Web-App.';
comment on column public.anmelde_sperren.gesperrt_seit  is 'Gesetzt, sobald die Grenze erreicht wurde. NULL = nicht gesperrt.';

-- Admins duerfen sehen, wer gesperrt ist. Schreiben darf nur der Hook.
drop policy if exists anmeldesperre_admin_read on public.anmelde_sperren;
create policy anmeldesperre_admin_read on public.anmelde_sperren
  for select using (public.is_admin());

-- --------------------------------------------------- Der Hook von GoTrue --
--  Aufruf durch GoTrue mit  {"user_id":"…","valid":true|false}
--  Antwort: {"decision":"continue"}  oder  {"decision":"reject","message":"…"}
create or replace function public.password_verification_attempt(event jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
  gueltig boolean;
  n integer;
  GRENZE constant integer := 5;
begin
  uid     := nullif(event->>'user_id','')::uuid;
  gueltig := coalesce((event->>'valid')::boolean, false);
  if uid is null then
    return jsonb_build_object('decision','continue');
  end if;

  -- Richtiges Passwort: Zähler zurücksetzen (eine bestehende Sperre bleibt
  -- bestehen - die hebt nur eine Admin-Person auf, so ist es gewollt).
  if gueltig then
    delete from public.anmelde_sperren
     where user_id = uid and gesperrt_seit is null;
    return jsonb_build_object('decision','continue');
  end if;

  insert into public.anmelde_sperren as s (user_id, fehlversuche, letzter_versuch)
       values (uid, 1, now())
  on conflict (user_id) do update
       set fehlversuche    = s.fehlversuche + 1,
           letzter_versuch = now()
  returning s.fehlversuche into n;

  if n >= GRENZE then
    update auth.users
       set banned_until = now() + interval '100 years'
     where id = uid;
    update public.anmelde_sperren
       set gesperrt_seit = coalesce(gesperrt_seit, now())
     where user_id = uid;
    return jsonb_build_object(
      'decision','reject',
      'message','Dieses Konto wurde nach mehreren falschen Passwörtern gesperrt. Bitte an die Lehrkraft wenden.');
  end if;

  return jsonb_build_object('decision','continue');
end $$;

-- Nur GoTrue darf den Hook aufrufen - niemand sonst.
revoke all on function public.password_verification_attempt(jsonb) from public, anon, authenticated;
grant execute on function public.password_verification_attempt(jsonb) to supabase_auth_admin;
grant all on table public.anmelde_sperren to supabase_auth_admin;

-- ------------------------------------------------------- Admin: Freigabe --
create or replace function public.admin_konto_entsperren(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Nur Admin'; end if;
  update auth.users set banned_until = null where id = p_user;
  delete from public.anmelde_sperren where user_id = p_user;
end $$;
grant execute on function public.admin_konto_entsperren(uuid) to authenticated;

-- Übersicht für die Admin-Ansicht: wer ist gesperrt, seit wann, wie viele
-- Fehlversuche? (Die Tabelle auth.users ist für die Web-App nicht lesbar.)
create or replace function public.admin_gesperrte_konten()
returns table(user_id uuid, username text, display_name text,
              fehlversuche integer, gesperrt_seit timestamptz, letzter_versuch timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Nur Admin'; end if;
  return query
    select s.user_id, p.username, p.display_name,
           s.fehlversuche, s.gesperrt_seit, s.letzter_versuch
      from public.anmelde_sperren s
      join public.profiles p on p.id = s.user_id
     order by s.gesperrt_seit desc nulls last, s.letzter_versuch desc;
end $$;
grant execute on function public.admin_gesperrte_konten() to authenticated;

-- ============================================================================
--  Kontrolle
-- ============================================================================
do $$
declare fehlt text := '';
begin
  if to_regclass('public.anmelde_sperren') is null then fehlt := fehlt || ' anmelde_sperren'; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='password_verification_attempt')
    then fehlt := fehlt || ' password_verification_attempt'; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='admin_konto_entsperren')
    then fehlt := fehlt || ' admin_konto_entsperren'; end if;
  if not has_function_privilege('supabase_auth_admin',
        'public.password_verification_attempt(jsonb)', 'execute')
    then fehlt := fehlt || ' Ausfuehrrecht-fuer-GoTrue'; end if;
  if fehlt <> '' then raise exception 'Diese Teile fehlen:%', fehlt; end if;
  raise notice 'OK: Anmeldeschutz eingerichtet. JETZT NOCH den Auth-Dienst umstellen:';
  raise notice '    docker-compose.override.yml -> Abschnitt "auth", dann: docker compose up -d auth';
end $$;

-- Fertig ✅  (Phase AC – Sperre nach 5 Fehlversuchen, Freigabe durch Admin)
