-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase AD
--  Mehrere Welten je Aufgabe + Klassenwechsel mit Abgaben-Übernahme
-- ----------------------------------------------------------------------------
--  1) templates.worlds — Aufgaben-Vorlagen können jetzt ebenfalls mehrere
--     Start-Territorien mitbringen (assignments.worlds gibt es seit Phase AB).
--
--  2) teacher_move_student() — verschiebt eine Schülerin / einen Schüler von
--     einer Klasse in eine andere und nimmt die Abgaben mit. Welche Aufgabe der
--     alten Klasse auf welche Aufgabe der neuen Klasse abgebildet wird, gibt
--     die Lehrkraft vorher an; ohne Zuordnung wird nur die Mitgliedschaft
--     umgehängt.
--
--  3) teacher_regrade_submission() — schreibt das Ergebnis einer Hamster-Abgabe
--     zurück. Bewertet wird im Browser der Lehrkraft (dort läuft die Engine),
--     geschrieben wird über diese Funktion, damit die Rechteprüfung im Server
--     bleibt.
--
--  Dieses Skript ist beliebig oft ausführbar (idempotent).
-- ============================================================================

-- ---------------------------------------------------------------- 1) Welten
alter table public.templates    add column if not exists worlds jsonb;
alter table public.assignments  add column if not exists worlds jsonb;
alter table public.submissions  add column if not exists results jsonb;

comment on column public.assignments.worlds is
  'Liste weiterer Start-Territorien: [{id,name,territory,goal}]. NULL = nur territory/goal.';
comment on column public.submissions.results is
  'Ergebnis je Welt: {"weltId": true|false}. NULL bei Aufgaben mit nur einer Welt.';

-- ------------------------------------------------- 2) Protokoll der Wechsel
create table if not exists public.klassenwechsel (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.profiles(id) on delete cascade,
  von_klasse   uuid references public.classes(id) on delete set null,
  nach_klasse  uuid references public.classes(id) on delete set null,
  lehrkraft_id uuid references public.profiles(id) on delete set null,
  bilanz       jsonb not null default '{}'::jsonb,
  gewechselt_am timestamptz not null default now()
);
alter table public.klassenwechsel enable row level security;

drop policy if exists kw_teacher_read on public.klassenwechsel;
create policy kw_teacher_read on public.klassenwechsel for select to authenticated
  using ( lehrkraft_id = auth.uid()
          or public.is_class_teacher(von_klasse)
          or public.is_class_teacher(nach_klasse) );

-- ------------------------------------------------------ 3) Der Wechsel selbst
-- p_zuordnung: [{"art":"hamster","von":"<uuid>","nach":"<uuid>"}, ...]
--   art ∈ hamster | sql | filius | java
-- Rückgabe: {"verschoben":{...}, "uebersprungen":[...], "neu_bewerten":[...]}
create or replace function public.teacher_move_student(
  p_student   uuid,
  p_von       uuid,
  p_nach      uuid,
  p_zuordnung jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  z            jsonb;
  v_art        text;
  v_von_a      uuid;
  v_nach_a     uuid;
  v_anzahl     int;
  v_hamster    int := 0;
  v_sql        int := 0;
  v_filius     int := 0;
  v_java       int := 0;
  v_uebersprungen jsonb := '[]'::jsonb;
  v_neu        jsonb := '[]'::jsonb;
begin
  if p_student is null or p_von is null or p_nach is null then
    raise exception 'Es fehlen Angaben (Schüler:in, Herkunfts- oder Zielklasse).';
  end if;
  if p_von = p_nach then
    raise exception 'Herkunfts- und Zielklasse sind dieselbe Klasse.';
  end if;
  -- Beide Klassen müssen der aufrufenden Lehrkraft gehören. Sonst liessen sich
  -- fremde Schüler:innen in die eigene Klasse ziehen.
  if not public.is_class_teacher(p_von) then
    raise exception 'Du bist nicht Lehrkraft der Herkunftsklasse.';
  end if;
  if not public.is_class_teacher(p_nach) then
    raise exception 'Du bist nicht Lehrkraft der Zielklasse.';
  end if;
  if not exists (select 1 from public.memberships
                 where class_id = p_von and student_id = p_student) then
    raise exception 'Diese Person ist gar nicht in der Herkunftsklasse.';
  end if;

  -- ---- Abgaben umhängen, Zuordnung für Zuordnung -------------------------
  for z in select * from jsonb_array_elements(coalesce(p_zuordnung, '[]'::jsonb)) loop
    v_art    := coalesce(z->>'art', 'hamster');
    v_von_a  := nullif(z->>'von','')::uuid;
    v_nach_a := nullif(z->>'nach','')::uuid;
    continue when v_von_a is null or v_nach_a is null;

    if v_art = 'hamster' then
      -- Aufgaben müssen wirklich zu den beiden Klassen gehören.
      if not exists (select 1 from public.assignments where id=v_von_a  and class_id=p_von)
      or not exists (select 1 from public.assignments where id=v_nach_a and class_id=p_nach) then
        v_uebersprungen := v_uebersprungen || jsonb_build_object('art',v_art,'von',v_von_a,'grund','Aufgabe gehört nicht zur angegebenen Klasse');
        continue;
      end if;
      -- Hamster-Abgaben haben eine Versionsgeschichte (is_current). Vorhandene
      -- Abgaben in der Zielaufgabe verlieren die Markierung "aktuell"; die
      -- jüngste mitgebrachte Abgabe übernimmt sie.
      update public.submissions set is_current = false
        where assignment_id = v_nach_a and student_id = p_student;
      update public.submissions set assignment_id = v_nach_a, results = null
        where assignment_id = v_von_a and student_id = p_student;
      get diagnostics v_anzahl = row_count;
      v_hamster := v_hamster + v_anzahl;
      update public.submissions set is_current = true
        where id = (select id from public.submissions
                    where assignment_id = v_nach_a and student_id = p_student
                    order by submitted_at desc limit 1);
      -- Die Neubewertung passiert im Browser der Lehrkraft (dort läuft die
      -- Hamster-Engine) und kommt über teacher_regrade_submission zurück.
      v_neu := v_neu || (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'assignment',v_nach_a)), '[]'::jsonb)
                         from public.submissions s
                         where s.assignment_id = v_nach_a and s.student_id = p_student);

    elsif v_art = 'sql' then
      if not exists (select 1 from public.sql_assignments where id=v_von_a  and class_id=p_von)
      or not exists (select 1 from public.sql_assignments where id=v_nach_a and class_id=p_nach) then
        v_uebersprungen := v_uebersprungen || jsonb_build_object('art',v_art,'von',v_von_a,'grund','Aufgabe gehört nicht zur angegebenen Klasse');
        continue;
      end if;
      if exists (select 1 from public.sql_submissions where assignment_id=v_nach_a and student_id=p_student) then
        v_uebersprungen := v_uebersprungen || jsonb_build_object('art',v_art,'von',v_von_a,'grund','In der Zielaufgabe gibt es bereits eine Abgabe');
        continue;
      end if;
      -- Die Teilaufgaben-Kennungen der neuen Aufgabe sind andere: Antworten
      -- bleiben, die Bewertung wird zurückgesetzt und beim nächsten Öffnen neu
      -- ermittelt.
      update public.sql_submissions
         set assignment_id = v_nach_a, results = '{}'::jsonb, passed = null
       where assignment_id = v_von_a and student_id = p_student;
      get diagnostics v_anzahl = row_count;
      v_sql := v_sql + v_anzahl;

    elsif v_art = 'filius' then
      if not exists (select 1 from public.filius_assignments where id=v_von_a  and class_id=p_von)
      or not exists (select 1 from public.filius_assignments where id=v_nach_a and class_id=p_nach) then
        v_uebersprungen := v_uebersprungen || jsonb_build_object('art',v_art,'von',v_von_a,'grund','Aufgabe gehört nicht zur angegebenen Klasse');
        continue;
      end if;
      if exists (select 1 from public.filius_submissions where assignment_id=v_nach_a and student_id=p_student) then
        v_uebersprungen := v_uebersprungen || jsonb_build_object('art',v_art,'von',v_von_a,'grund','In der Zielaufgabe gibt es bereits eine Abgabe');
        continue;
      end if;
      update public.filius_submissions
         set assignment_id = v_nach_a, results = '{}'::jsonb, passed = null
       where assignment_id = v_von_a and student_id = p_student;
      get diagnostics v_anzahl = row_count;
      v_filius := v_filius + v_anzahl;

    elsif v_art = 'java' then
      if not exists (select 1 from public.java_assignments where id=v_von_a  and class_id=p_von)
      or not exists (select 1 from public.java_assignments where id=v_nach_a and class_id=p_nach) then
        v_uebersprungen := v_uebersprungen || jsonb_build_object('art',v_art,'von',v_von_a,'grund','Aufgabe gehört nicht zur angegebenen Klasse');
        continue;
      end if;
      update public.java_submissions set is_current = false
        where assignment_id = v_nach_a and student_id = p_student;
      update public.java_submissions
         set assignment_id = v_nach_a, results = '{}'::jsonb, passed = null
       where assignment_id = v_von_a and student_id = p_student;
      get diagnostics v_anzahl = row_count;
      v_java := v_java + v_anzahl;
      update public.java_submissions set is_current = true
        where id = (select id from public.java_submissions
                    where assignment_id = v_nach_a and student_id = p_student
                    order by updated_at desc limit 1);
    end if;
  end loop;

  -- ---- Mitgliedschaft umhängen -------------------------------------------
  if exists (select 1 from public.memberships where class_id=p_nach and student_id=p_student) then
    delete from public.memberships where class_id=p_von and student_id=p_student;
  else
    update public.memberships set class_id = p_nach
     where class_id = p_von and student_id = p_student;
  end if;

  insert into public.klassenwechsel(student_id, von_klasse, nach_klasse, lehrkraft_id, bilanz)
  values (p_student, p_von, p_nach, auth.uid(),
          jsonb_build_object('hamster',v_hamster,'sql',v_sql,'filius',v_filius,'java',v_java));

  return jsonb_build_object(
    'verschoben',    jsonb_build_object('hamster',v_hamster,'sql',v_sql,'filius',v_filius,'java',v_java),
    'uebersprungen', v_uebersprungen,
    'neu_bewerten',  v_neu);
end;
$$;

revoke all on function public.teacher_move_student(uuid,uuid,uuid,jsonb) from public, anon;
grant execute on function public.teacher_move_student(uuid,uuid,uuid,jsonb) to authenticated;

-- ------------------------------------------- 4) Ergebnis zurückschreiben
create or replace function public.teacher_regrade_submission(
  p_sub     uuid,
  p_passed  boolean,
  p_results jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_class uuid;
begin
  select a.class_id into v_class
    from public.submissions s join public.assignments a on a.id = s.assignment_id
   where s.id = p_sub;
  if v_class is null then
    raise exception 'Abgabe nicht gefunden.';
  end if;
  if not public.is_class_teacher(v_class) then
    raise exception 'Du bist nicht Lehrkraft dieser Klasse.';
  end if;
  update public.submissions
     set passed = p_passed,
         results = case when p_results is null then results else p_results end
   where id = p_sub;
end;
$$;

revoke all on function public.teacher_regrade_submission(uuid,boolean,jsonb) from public, anon;
grant execute on function public.teacher_regrade_submission(uuid,boolean,jsonb) to authenticated;

-- ============================================================================
--  Selbstprüfung: meldet sich laut, wenn etwas nicht angekommen ist.
-- ============================================================================
do $$
declare fehlt text := '';
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='templates' and column_name='worlds')
    then fehlt := fehlt || ' templates.worlds'; end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='assignments' and column_name='worlds')
    then fehlt := fehlt || ' assignments.worlds'; end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='submissions' and column_name='results')
    then fehlt := fehlt || ' submissions.results'; end if;
  if to_regclass('public.klassenwechsel') is null
    then fehlt := fehlt || ' Tabelle klassenwechsel'; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='teacher_move_student')
    then fehlt := fehlt || ' teacher_move_student'; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='teacher_regrade_submission')
    then fehlt := fehlt || ' teacher_regrade_submission'; end if;
  if fehlt <> '' then
    raise exception 'Phase AD unvollstaendig, es fehlt:%', fehlt;
  end if;
  raise notice 'Phase AD vollstaendig: Welten fuer Vorlagen + Klassenwechsel mit Abgaben-Uebernahme.';
end $$;
