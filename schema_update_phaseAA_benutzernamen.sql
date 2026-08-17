-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase AA
--  Benutzernamen dürfen bis zu 32 Zeichen lang sein (vorher 20).
--
--  WARUM war es überhaupt begrenzt?
--    * Die Prüfung  ^[a-z0-9_.\-]{3,20}$  stand an drei Stellen: zweimal im
--      Frontend und hier in der Datenbank-Funktion admin_rename_user.
--    * Beim Schüler-Import kürzte das Frontend zusätzlich auf 18 Zeichen, weil
--      bei Namensgleichheit eine Ziffer angehängt wird (max. 2 Ziffern) und das
--      Ergebnis unter der 20er-Grenze bleiben musste.
--    * Deshalb liessen sich Namen nachträglich auf 20, beim Import aber nur auf
--      18 Zeichen bringen. Eine technische Notwendigkeit gab es nie: die Spalte
--      profiles.username ist "text unique not null" und hat KEINE Längengrenze,
--      und die Login-Adresse <username>@hamster.local ist ebenfalls unbegrenzt.
--
--  Neu: 32 Zeichen in der Datenbank, 32 im Frontend, Kürzung beim Import auf 30
--       (30 + bis zu 2 Ziffern = 32).
--
--  EINSPIELEN (selbst gehostete Fassung, im Ordner supabase/docker):
--      docker compose exec -T db psql -U supabase_admin -d postgres \
--        -v ON_ERROR_STOP=1 < schema_update_phaseAA_benutzernamen.sql
--  Oder im Supabase-Studio (SSH-Tunnel) einfügen und ausführen.
--  Gefahrlos wiederholbar (create or replace), verändert KEINE Daten.
-- ============================================================================

create or replace function public.admin_rename_user(p_user uuid, p_new text)
returns void language plpgsql security definer set search_path = public as $$
declare u text; new_email text;
begin
  if not public.is_admin() then raise exception 'Nur Admin'; end if;
  u := lower(trim(p_new));
  if u !~ '^[a-z0-9_.\-]{3,32}$' then
    raise exception 'Ungueltiger Benutzername (3-32 Zeichen: a-z, 0-9, Punkt, _ , -)';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Nutzer:in nicht gefunden';
  end if;
  if exists (select 1 from public.profiles where username = u and id <> p_user) then
    raise exception 'Benutzername ist bereits vergeben';
  end if;
  new_email := u || '@hamster.local';
  if exists (select 1 from auth.users where email = new_email and id <> p_user) then
    raise exception 'Benutzername ist bereits vergeben';
  end if;
  -- 1) Profil-Benutzername
  update public.profiles set username = u where id = p_user;
  -- 2) Login-E-Mail in auth.users
  update auth.users set email = new_email, updated_at = now() where id = p_user;
  -- 3) E-Mail in der zugehörigen Identity (Provider 'email') konsistent halten
  update auth.identities
     set identity_data = jsonb_set(coalesce(identity_data,'{}'::jsonb), '{email}', to_jsonb(new_email))
   where user_id = p_user and provider = 'email';
end $$;
grant execute on function public.admin_rename_user(uuid, text) to authenticated;

-- Kontrolle: sollte 32 anzeigen
do $$
declare quelle text;
begin
  select pg_get_functiondef(p.oid) into quelle
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_rename_user';
  if quelle like '%{3,32}%' then
    raise notice 'OK: Benutzernamen bis 32 Zeichen sind erlaubt.';
  else
    raise exception 'Die Funktion wurde nicht aktualisiert.';
  end if;
end $$;

-- Fertig ✅  (Phase AA – Benutzernamen bis 32 Zeichen)
