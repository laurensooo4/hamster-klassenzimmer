-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase S
--  SQL-Sandbox: echte Datenbanken statt Standard-Beispiele.
--   - Geteilte DBs (shared)         -> für ALLE (Lehrkräfte UND Schüler:innen)
--   - Eigene DBs (owner)            -> für die Eigentümer-Lehrkraft (auch private)
--   - Aufgaben-DBs                  -> für Schüler:innen, denen damit eine veröffentlichte
--                                      Aufgabe in einer ihrer Klassen gestellt wurde
--   - Admin                         -> alle
--  -> Im Supabase-SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

create or replace function public.sandbox_sql_databases()
returns table(id uuid, name text, sql_text text, shared boolean,
              owner_id uuid, owner_name text, mine boolean)
language sql security definer set search_path = public stable as $$
  select d.id, d.name, d.sql_text, d.shared, d.owner_id,
         coalesce(p.display_name, p.username) as owner_name,
         (d.owner_id = auth.uid()) as mine
    from public.sql_databases d
    join public.profiles p on p.id = d.owner_id
   where d.shared                              -- geteilt -> alle
      or d.owner_id = auth.uid()               -- eigene (Lehrkraft, auch privat)
      or public.is_admin()                     -- Admin -> alle
      or exists (                              -- Schüler:in: DB aus veröffentlichter Aufgabe der eigenen Klasse
           select 1
             from public.sql_assignments a
             join public.memberships m on m.class_id = a.class_id
            where a.database_id = d.id
              and a.published
              and m.student_id = auth.uid()
         )
   order by lower(d.name);
$$;
grant execute on function public.sandbox_sql_databases() to authenticated;

-- Fertig ✅  (Phase S – SQL-Sandbox-Datenbanken)
