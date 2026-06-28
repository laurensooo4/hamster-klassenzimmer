-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase P
--  SQL-Playground: Schüler-Abgaben + serverseitige Benotung (Snapshot-Vergleich)
--  -> Im Supabase-SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

-- Mitglied der Aufgaben-Klasse?
create or replace function public.is_sql_assignment_member(p_assignment uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.sql_assignments a
                 join public.memberships m on m.class_id = a.class_id
                 where a.id = p_assignment and m.student_id = auth.uid());
$$;
grant execute on function public.is_sql_assignment_member(uuid) to authenticated;

-- Teilaufgaben für Schüler:innen OHNE Geheimnisse (solution_sql nur bei Freigabe; expected NIE)
create or replace function public.sql_subtasks_for_student(p_assignment uuid)
returns table(id uuid, "position" int, prompt text, compare boolean, "ordered" boolean, solution_sql text, released boolean)
language sql security definer set search_path = public stable as $$
  select s.id, s.position, s.prompt, s.compare, s.ordered,
         case when a.released then s.solution_sql else null end as solution_sql,
         a.released
    from public.sql_subtasks s
    join public.sql_assignments a on a.id = s.assignment_id
   where s.assignment_id = p_assignment and a.published
     and public.is_sql_assignment_member(p_assignment)
   order by s.position;
$$;
grant execute on function public.sql_subtasks_for_student(uuid) to authenticated;

-- Benotung EINER Teilaufgabe: Server vergleicht eingereichte Signatur gegen geheimes expected
create or replace function public.sql_grade_subtask(p_subtask uuid, p_result jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare st public.sql_subtasks; pub boolean;
begin
  select * into st from public.sql_subtasks where id = p_subtask;
  if st.id is null then raise exception 'Teilaufgabe unbekannt'; end if;
  if not public.is_sql_assignment_member(st.assignment_id) then raise exception 'Keine Berechtigung'; end if;
  select published into pub from public.sql_assignments where id = st.assignment_id;
  if not coalesce(pub,false) then raise exception 'Aufgabe nicht verfuegbar'; end if;
  if not st.compare then return 'correct'; end if;       -- nur "läuft fehlerfrei" gefordert
  if p_result is null then return 'empty'; end if;
  if st.expected is null then return 'wrong'; end if;
  return case when (st.expected->'columns') = (p_result->'columns')
                and (st.expected->'rows') = (p_result->'rows')
              then 'correct' else 'wrong' end;
end $$;
grant execute on function public.sql_grade_subtask(uuid, jsonb) to authenticated;

-- Abgaben: genau eine je (Aufgabe, Schüler:in); Antworten + Ergebnisse als JSONB
create table if not exists public.sql_submissions (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.sql_assignments(id) on delete cascade,
  student_id    uuid not null references public.profiles(id) on delete cascade,
  answers       jsonb not null default '{}',   -- { "<subtask_id>": "SELECT ..." }
  results       jsonb not null default '{}',   -- { "<subtask_id>": "correct"|"wrong"|"empty" }
  passed        boolean,
  updated_at    timestamptz not null default now(),
  unique (assignment_id, student_id)
);
alter table public.sql_submissions enable row level security;
drop policy if exists sqlsubm_student_all  on public.sql_submissions;
create policy sqlsubm_student_all on public.sql_submissions for all
  using (student_id = auth.uid())
  with check (student_id = auth.uid() and public.is_sql_assignment_member(assignment_id));
drop policy if exists sqlsubm_teacher_read on public.sql_submissions;
create policy sqlsubm_teacher_read on public.sql_submissions for select
  using (public.is_sql_assignment_teacher(assignment_id));

-- Fertig ✅  (Phase P – SQL-Abgaben + Benotung)
