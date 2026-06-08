-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase K
--  Admin kann Benutzernamen von Schüler:innen & Lehrkräften ändern.
--  -> Muss zugleich die Login-E-Mail (<username>@hamster.local) anpassen.
--  -> Im Supabase-SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

create or replace function public.admin_rename_user(p_user uuid, p_new text)
returns void language plpgsql security definer set search_path = public as $$
declare u text; new_email text;
begin
  if not public.is_admin() then raise exception 'Nur Admin'; end if;
  u := lower(trim(p_new));
  if u !~ '^[a-z0-9_.\-]{3,20}$' then
    raise exception 'Ungueltiger Benutzername (3-20 Zeichen: a-z, 0-9, Punkt, _ , -)';
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

-- Fertig ✅  (Phase K – Admin: Benutzernamen ändern)
