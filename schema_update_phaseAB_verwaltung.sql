-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase AB
--
--  EIN Update für drei Neuerungen:
--    Teil 1  Entwürfe: der Bearbeitungsstand bleibt beim Verlassen erhalten
--            (Hamster, SQL, FILIUS — für Java gab es das schon)
--    Teil 2  Nutzerverwaltung: Abgleich mit einer IServ-Liste, Schutzschalter,
--            Sammellöschung, Protokoll
--    Teil 3  Mehrere Welten je Hamster-Aufgabe + Teilergebnisse je Welt
--
--  EINSPIELEN (im Ordner supabase/docker):
--      docker compose exec -T db psql -U supabase_admin -d postgres \
--        -v ON_ERROR_STOP=1 < hamster-site/schema_update_phaseAB_verwaltung.sql
--
--  Gefahrlos wiederholbar. Verändert KEINE vorhandenen Daten: es werden nur
--  Spalten und Tabellen ergänzt (alle mit "if not exists") und Funktionen neu
--  angelegt. Bestehende Aufgaben, Klassen, Abgaben bleiben unberührt.
-- ============================================================================

-- ============================================================================
--  TEIL 1 — Entwürfe (Bearbeitungsstand)
-- ----------------------------------------------------------------------------
--  Gebaut wie die schon vorhandene Tabelle java_drafts (Phase Y): Schlüssel ist
--  Aufgabe + Schüler:in, der Inhalt liegt als jsonb. Beim Löschen einer Aufgabe
--  oder eines Kontos verschwinden die Entwürfe automatisch mit.
-- ============================================================================

create table if not exists public.hamster_drafts (
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id    uuid not null references public.profiles(id)    on delete cascade,
  code          text not null default '',
  updated_at    timestamptz not null default now(),
  primary key (assignment_id, student_id)
);
alter table public.hamster_drafts enable row level security;
drop policy if exists hamsterdraft_owner_all on public.hamster_drafts;
create policy hamsterdraft_owner_all on public.hamster_drafts for all
  using (student_id = auth.uid())
  with check (student_id = auth.uid() and public.is_assignment_member(assignment_id));

create table if not exists public.sql_drafts (
  assignment_id uuid not null references public.sql_assignments(id) on delete cascade,
  student_id    uuid not null references public.profiles(id)        on delete cascade,
  answers       jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now(),
  primary key (assignment_id, student_id)
);
alter table public.sql_drafts enable row level security;
drop policy if exists sqldraft_owner_all on public.sql_drafts;
create policy sqldraft_owner_all on public.sql_drafts for all
  using (student_id = auth.uid())
  with check (student_id = auth.uid() and public.is_sql_assignment_member(assignment_id));

create table if not exists public.filius_drafts (
  assignment_id uuid not null references public.filius_assignments(id) on delete cascade,
  student_id    uuid not null references public.profiles(id)           on delete cascade,
  net           jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now(),
  primary key (assignment_id, student_id)
);
alter table public.filius_drafts enable row level security;
drop policy if exists filiusdraft_owner_all on public.filius_drafts;
create policy filiusdraft_owner_all on public.filius_drafts for all
  using (student_id = auth.uid())
  with check (student_id = auth.uid() and public.is_filius_assignment_member(assignment_id));


-- ============================================================================
--  TEIL 2 — Nutzerverwaltung
-- ----------------------------------------------------------------------------
--  Grundgedanke: Wer die Schule verlassen hat, lässt sich NICHT aus dem
--  Anlegedatum erraten — Wiederholer machen jede Prognose kaputt. Verlässlich
--  ist nur der Abgleich mit der Liste aus IServ. Wer dort fehlt, wird markiert,
--  nicht gelöscht. Gelöscht wird erst nach Sichtung durch einen Menschen.
-- ============================================================================

alter table public.profiles add column if not exists iserv_fehlt_seit       timestamptz;
alter table public.profiles add column if not exists iserv_fehlt_anzahl     integer not null default 0;
alter table public.profiles add column if not exists iserv_zuletzt_geprueft timestamptz;
alter table public.profiles add column if not exists nie_loeschen           boolean not null default false;

comment on column public.profiles.iserv_fehlt_seit       is 'Seit wann fehlt dieses Konto in der IServ-Liste? NULL = es ist dort vorhanden.';
comment on column public.profiles.iserv_fehlt_anzahl     is 'Wie viele Abgleiche (an verschiedenen Tagen) hat es hintereinander gefehlt?';
comment on column public.profiles.iserv_zuletzt_geprueft is 'Zeitpunkt des letzten Abgleichs, an dem dieses Konto betrachtet wurde.';
comment on column public.profiles.nie_loeschen           is 'Schutzschalter: dieses Konto wird nie markiert und nie sammelgelöscht.';

-- Protokoll der Abgleiche ----------------------------------------------------
create table if not exists public.iserv_abgleiche (
  id                bigserial primary key,
  zeitpunkt         timestamptz not null default now(),
  von_wem           uuid references public.profiles(id) on delete set null,
  anzahl_liste      integer not null,
  anzahl_gefunden   integer not null,
  anzahl_markiert   integer not null,
  anzahl_entmarkiert integer not null
);
alter table public.iserv_abgleiche enable row level security;
drop policy if exists iserv_admin_read on public.iserv_abgleiche;
create policy iserv_admin_read on public.iserv_abgleiche for select using (public.is_admin());

-- Schutzschalter setzen ------------------------------------------------------
create or replace function public.admin_set_nie_loeschen(p_user uuid, p_wert boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Nur Admin'; end if;
  -- Wer ein Konto unter Schutz stellt, will auch eine bereits vorhandene
  -- Markierung los - sonst bliebe es fuer immer in der Liste "fehlt in IServ"
  -- stehen, obwohl es nie geloescht werden soll.
  update public.profiles
     set nie_loeschen       = coalesce(p_wert,false),
         iserv_fehlt_seit   = case when coalesce(p_wert,false) then null else iserv_fehlt_seit end,
         iserv_fehlt_anzahl = case when coalesce(p_wert,false) then 0    else iserv_fehlt_anzahl end
   where id = p_user;
end $$;
grant execute on function public.admin_set_nie_loeschen(uuid, boolean) to authenticated;

-- Trockenlauf: was WÜRDE ein Abgleich tun? -----------------------------------
create or replace function public.admin_iserv_vorschau(p_namen text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  liste text[]; n_liste int; n_schueler int; n_gefunden int;
  n_markiert int; n_entmarkiert int; n_geschuetzt int; unbekannt text[];
begin
  if not public.is_admin() then raise exception 'Nur Admin'; end if;
  -- Namen vereinheitlichen: klein, ohne Leerzeichen, ohne Leereinträge, ohne Dubletten
  select coalesce(array_agg(distinct x), '{}') into liste
    from unnest(coalesce(p_namen,'{}')) as x0(x0)
    cross join lateral (select lower(btrim(x0))) as t(x)
   where lower(btrim(x0)) <> '';
  n_liste := coalesce(array_length(liste,1),0);

  select count(*) into n_schueler from public.profiles where role='student';
  select count(*) into n_gefunden from public.profiles where role='student' and username = any(liste);
  select count(*) into n_markiert from public.profiles
    where role='student' and not nie_loeschen and not (username = any(liste));
  select count(*) into n_entmarkiert from public.profiles
    where role='student' and username = any(liste) and iserv_fehlt_seit is not null;
  select count(*) into n_geschuetzt from public.profiles
    where role='student' and nie_loeschen and not (username = any(liste));

  -- Namen aus der Liste, zu denen es kein Konto gibt (Tippfehler? neu?)
  select coalesce(array_agg(x), '{}') into unbekannt from (
    select x from unnest(liste) as u(x)
     where not exists (select 1 from public.profiles p where p.username = u.x)
     order by x limit 50
  ) s;

  return jsonb_build_object(
    'namen_in_liste',  n_liste,
    'schueler_gesamt', n_schueler,
    'gefunden',        n_gefunden,
    'wuerde_markieren',n_markiert,
    'wuerde_loesen',   n_entmarkiert,
    'geschuetzt',      n_geschuetzt,
    'unbekannt',       to_jsonb(unbekannt),
    'anteil_prozent',  case when n_schueler>0 then round(100.0*n_markiert/n_schueler,1) else 0 end
  );
end $$;
grant execute on function public.admin_iserv_vorschau(text[]) to authenticated;

-- Abgleich wirklich durchführen ----------------------------------------------
create or replace function public.admin_iserv_abgleich(p_namen text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  liste text[]; n_liste int; n_schueler int; n_markiert int; n_entmarkiert int;
begin
  if not public.is_admin() then raise exception 'Nur Admin'; end if;

  select coalesce(array_agg(distinct x), '{}') into liste
    from unnest(coalesce(p_namen,'{}')) as x0(x0)
    cross join lateral (select lower(btrim(x0))) as t(x)
   where lower(btrim(x0)) <> '';
  n_liste := coalesce(array_length(liste,1),0);

  if n_liste = 0 then
    raise exception 'Die Liste ist leer. Es wurde nichts verändert.';
  end if;

  select count(*) into n_schueler from public.profiles where role='student';
  select count(*) into n_markiert from public.profiles
    where role='student' and not nie_loeschen and not (username = any(liste));

  -- Plausibilitätsbremse: eine halb exportierte Liste darf keine halbe Schule
  -- markieren. 30 % ist die Grenze; bei sehr kleinen Beständen greift sie nicht.
  if n_schueler >= 20 and n_markiert > (n_schueler * 0.30) then
    raise exception 'Abbruch: % von % Schülerkonten (% Prozent) würden markiert. Das sieht nach einer unvollständigen Liste aus. Es wurde nichts verändert.',
      n_markiert, n_schueler, round(100.0*n_markiert/n_schueler,1);
  end if;

  -- 1) In der Liste vorhanden -> Markierung zurücknehmen
  update public.profiles
     set iserv_fehlt_seit = null,
         iserv_fehlt_anzahl = 0,
         iserv_zuletzt_geprueft = now()
   where role='student' and username = any(liste);
  get diagnostics n_entmarkiert = row_count;

  -- 2) Nicht in der Liste -> markieren bzw. Zähler erhöhen.
  --    Der Zähler steigt höchstens einmal pro Tag, damit ein zweiter Lauf am
  --    selben Tag nicht künstlich einen "zweiten Abgleich" vortäuscht.
  update public.profiles
     set iserv_fehlt_seit = coalesce(iserv_fehlt_seit, now()),
         iserv_fehlt_anzahl = case
           when iserv_zuletzt_geprueft is null
             or iserv_zuletzt_geprueft < now() - interval '20 hours'
           then iserv_fehlt_anzahl + 1 else iserv_fehlt_anzahl end,
         iserv_zuletzt_geprueft = now()
   where role='student' and not nie_loeschen and not (username = any(liste));

  insert into public.iserv_abgleiche(von_wem, anzahl_liste, anzahl_gefunden, anzahl_markiert, anzahl_entmarkiert)
  select auth.uid(), n_liste,
         (select count(*) from public.profiles where role='student' and username = any(liste)),
         n_markiert, n_entmarkiert;

  return jsonb_build_object('markiert', n_markiert, 'geloest', n_entmarkiert,
                            'namen_in_liste', n_liste, 'schueler_gesamt', n_schueler);
end $$;
grant execute on function public.admin_iserv_abgleich(text[]) to authenticated;

-- Sammellöschung -------------------------------------------------------------
--  Prüft je Konto dasselbe wie admin_delete_user: nur Admin darf, Admins werden
--  nie gelöscht, geschützte Konten werden übersprungen.
create or replace function public.admin_delete_users(p_users uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid; n_ok int := 0; n_uebersprungen int := 0; grund text;
begin
  if not public.is_admin() then raise exception 'Nur Admin'; end if;
  if p_users is null or array_length(p_users,1) is null then
    return jsonb_build_object('geloescht',0,'uebersprungen',0);
  end if;
  if array_length(p_users,1) > 500 then
    raise exception 'Höchstens 500 Konten auf einmal.';
  end if;

  foreach u in array p_users loop
    grund := null;
    if u = auth.uid() then grund := 'eigenes Konto';
    elsif exists (select 1 from public.profiles where id=u and is_admin)      then grund := 'Admin';
    elsif exists (select 1 from public.profiles where id=u and nie_loeschen)  then grund := 'geschützt';
    elsif not exists (select 1 from public.profiles where id=u)               then grund := 'nicht vorhanden';
    end if;
    if grund is null then
      delete from auth.users where id = u;   -- Kaskade: Profil, Abgaben, Entwürfe, …
      n_ok := n_ok + 1;
    else
      n_uebersprungen := n_uebersprungen + 1;
    end if;
  end loop;

  return jsonb_build_object('geloescht', n_ok, 'uebersprungen', n_uebersprungen);
end $$;
grant execute on function public.admin_delete_users(uuid[]) to authenticated;


-- ============================================================================
--  TEIL 3 — Mehrere Welten je Hamster-Aufgabe
-- ----------------------------------------------------------------------------
--  worlds ist eine Liste von Welten im GLEICHEN Format wie die bisherige Spalte
--  territory: [{name, territory, goal}, …]. Ist worlds NULL, verhält sich alles
--  wie bisher — bestehende Aufgaben bleiben also unverändert gültig.
--  territory/goal werden weiter mitgeführt (Spiegel der ersten Welt), damit eine
--  ältere Programmfassung im Browser nichts kaputt macht.
--  submissions.results nimmt das Ergebnis je Welt auf: [{welt, name, passed}, …]
-- ============================================================================

alter table public.assignments add column if not exists worlds  jsonb;
alter table public.submissions add column if not exists results jsonb;

comment on column public.assignments.worlds is 'Liste der Welten [{name,territory,goal}]; NULL = nur die einzelne Welt in territory/goal.';
comment on column public.submissions.results is 'Ergebnis je Welt [{welt,name,passed}]; NULL = nur das Gesamtergebnis in passed.';


-- ============================================================================
--  Kontrolle
-- ============================================================================
do $$
declare fehlt text := '';
begin
  if to_regclass('public.hamster_drafts') is null then fehlt := fehlt || ' hamster_drafts'; end if;
  if to_regclass('public.sql_drafts')     is null then fehlt := fehlt || ' sql_drafts';     end if;
  if to_regclass('public.filius_drafts')  is null then fehlt := fehlt || ' filius_drafts';  end if;
  if to_regclass('public.iserv_abgleiche') is null then fehlt := fehlt || ' iserv_abgleiche'; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='profiles' and column_name='nie_loeschen')
    then fehlt := fehlt || ' profiles.nie_loeschen'; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='assignments' and column_name='worlds')
    then fehlt := fehlt || ' assignments.worlds'; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='submissions' and column_name='results')
    then fehlt := fehlt || ' submissions.results'; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='admin_iserv_abgleich')
    then fehlt := fehlt || ' admin_iserv_abgleich'; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='admin_delete_users')
    then fehlt := fehlt || ' admin_delete_users'; end if;

  if fehlt <> '' then
    raise exception 'Diese Teile fehlen:%', fehlt;
  end if;
  raise notice 'OK: Entwuerfe, Nutzerverwaltung und Mehr-Welten-Spalten sind eingerichtet.';
end $$;

-- Fertig ✅  (Phase AB – Entwürfe, Nutzerverwaltung, mehrere Welten)
