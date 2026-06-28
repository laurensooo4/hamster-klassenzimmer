-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase N
--  SQL-Playground: Datenbank-Bibliothek (Lehrkräfte legen DBs an, optional teilbar)
--  -> Im Supabase-SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

create table if not exists public.sql_databases (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  name       text not null,
  sql_text   text not null,                  -- vollständiges CREATE+INSERT-Skript (sql.js db.run-tauglich)
  shared     boolean not null default false, -- für andere Lehrkräfte sichtbar/nutzbar
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sql_databases enable row level security;

-- Eigentümer:in: voller Zugriff
drop policy if exists sqldb_owner_all on public.sql_databases;
create policy sqldb_owner_all on public.sql_databases for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Admin: voller Zugriff (Konsistenz mit classes_admin_all etc.)
drop policy if exists sqldb_admin_all on public.sql_databases;
create policy sqldb_admin_all on public.sql_databases for all
  using (public.is_admin()) with check (public.is_admin());

-- Jede Lehrkraft darf GETEILTE Datenbanken lesen (und in Aufgaben nutzen)
drop policy if exists sqldb_shared_read on public.sql_databases;
create policy sqldb_shared_read on public.sql_databases for select
  using (shared and public.is_teacher_or_admin(auth.uid()));

-- (Schüler:innen-Lesezugriff folgt in Phase 4 über die Aufgaben-Verknüpfung.)

-- Liste der für mich sichtbaren Datenbanken MIT Ersteller-Name.
--   Nötig per SECURITY DEFINER, weil eine Lehrkraft fremde profiles nicht direkt lesen darf
--   (profiles-RLS bleibt unangetastet). Liefert KEIN sql_text (das holt der Client per RLS-select).
create or replace function public.shared_sql_databases()
returns table(id uuid, name text, shared boolean, owner_id uuid, owner_name text,
              created_at timestamptz, updated_at timestamptz, mine boolean)
language sql security definer set search_path = public stable as $$
  select d.id, d.name, d.shared, d.owner_id,
         coalesce(p.display_name, p.username) as owner_name,
         d.created_at, d.updated_at, (d.owner_id = auth.uid()) as mine
    from public.sql_databases d
    join public.profiles p on p.id = d.owner_id
   where public.is_teacher_or_admin(auth.uid())
     and (d.owner_id = auth.uid() or d.shared or public.is_admin())
   order by lower(d.name);
$$;
grant execute on function public.shared_sql_databases() to authenticated;

-- Fertig ✅  (Phase N – SQL-Datenbank-Bibliothek)
