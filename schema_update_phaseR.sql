-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase R
--  SQL-Playground: Aufgaben-Vorlagen (Aufgabe als Vorlage speichern, wiederverwenden)
--  Spiegelt das Vorbild `sql_databases` (Phase N): Eigentümer + Admin voll, geteilte lesbar.
--  -> Im Supabase-SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

create table if not exists public.sql_assignment_templates (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  description text,
  db_snapshot text not null default '',          -- eingefrorene Datenbank (sql.js db.run-tauglich)
  subtasks    jsonb not null default '[]',        -- [{prompt, solution_sql, compare, ordered, expected}]
  shared      boolean not null default false,     -- für andere Lehrkräfte sichtbar/nutzbar
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.sql_assignment_templates enable row level security;

-- Eigentümer:in (Lehrkraft/Admin): voller Zugriff. with check zusätzlich mit Rollen-Gate,
-- damit Schüler:innen nicht einmal eigene (Junk-)Vorlagen anlegen können (Härtung aus Review).
drop policy if exists sqltpl_owner_all on public.sql_assignment_templates;
create policy sqltpl_owner_all on public.sql_assignment_templates for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and public.is_teacher_or_admin(auth.uid()));

-- Admin: voller Zugriff (Konsistenz mit den übrigen *_admin_all-Policies)
drop policy if exists sqltpl_admin_all on public.sql_assignment_templates;
create policy sqltpl_admin_all on public.sql_assignment_templates for all
  using (public.is_admin()) with check (public.is_admin());

-- Jede Lehrkraft darf GETEILTE Vorlagen lesen (und in einer Klasse verwenden).
-- KEINE Schüler:innen-Policy -> solution_sql/expected in den subtasks bleiben Lehrkraft-intern.
drop policy if exists sqltpl_shared_read on public.sql_assignment_templates;
create policy sqltpl_shared_read on public.sql_assignment_templates for select
  using (shared and public.is_teacher_or_admin(auth.uid()));

-- Liste der für mich sichtbaren Vorlagen MIT Ersteller-Name (ohne db_snapshot/subtasks-Inhalt;
-- den vollen Datensatz holt der Client beim Verwenden per RLS-select). SECURITY DEFINER wegen profiles.
create or replace function public.shared_sql_templates()
returns table(id uuid, title text, description text, shared boolean, owner_id uuid, owner_name text,
              subtask_count int, created_at timestamptz, updated_at timestamptz, mine boolean)
language sql security definer set search_path = public stable as $$
  select t.id, t.title, t.description, t.shared, t.owner_id,
         coalesce(p.display_name, p.username) as owner_name,
         coalesce(jsonb_array_length(t.subtasks), 0) as subtask_count,
         t.created_at, t.updated_at, (t.owner_id = auth.uid()) as mine
    from public.sql_assignment_templates t
    join public.profiles p on p.id = t.owner_id
   where public.is_teacher_or_admin(auth.uid())
     and (t.owner_id = auth.uid() or t.shared or public.is_admin())
   order by lower(t.title);
$$;
grant execute on function public.shared_sql_templates() to authenticated;

-- Fertig ✅  (Phase R – SQL-Aufgaben-Vorlagen)
