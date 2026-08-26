-- ============================================================================
--  Reparatur nach dem Update auf 2.45
-- ----------------------------------------------------------------------------
--  Zwei alte Schema-Dateien waren als "wiederholbar" gekennzeichnet, waren es
--  aber nicht. Beim automatischen Einspielen liefen sie deshalb erneut und
--  haben zwei Dinge zurueckgesetzt:
--
--   1) Die Reihenfolge der Aufgaben. Sie stand danach auf "aelteste zuerst",
--      obwohl neue Aufgaben oben erscheinen sollen.
--   2) Welche Abgabe die "aktuelle" ist. Bei Schueler:innen mit mehreren
--      Versionen konnte danach eine aeltere als aktuell markiert sein.
--
--  Beide Dateien sind seit 2.45 korrigiert - sie fassen nichts mehr an. Dieses
--  Skript stellt einmalig den richtigen Zustand wieder her.
--
--  AUFRUF (im Ordner supabase/docker):
--    docker compose exec -T db psql -U supabase_admin -d postgres \
--      -v ON_ERROR_STOP=1 < hamster-site/reparatur_reihenfolge.sql
--
--  Das Skript ist gefahrlos mehrfach ausfuehrbar.
-- ============================================================================

-- ---------------------------------------------------------------- 1) Reihenfolge
-- Neueste Aufgabe nach oben - so, wie es die Oberflaeche beim Anlegen macht.
-- Wer eine eigene Reihenfolge bevorzugt, sortiert danach mit den Pfeilen ↑ ↓.
update public.assignments a set position = sub.rn
  from (select id, row_number() over (partition by class_id order by created_at desc) as rn
        from public.assignments) sub
 where a.id = sub.id;

-- ------------------------------------------------------- 2) Aktuelle Abgabe
-- Erst alle Markierungen loesen (beliebig viele "false" sind erlaubt), dann je
-- Aufgabe und Person genau die juengste Abgabe wieder als aktuell setzen.
update public.submissions set is_current = false where is_current;

update public.submissions s set is_current = true
 where s.id = (select x.id from public.submissions x
                where x.assignment_id = s.assignment_id
                  and x.student_id    = s.student_id
                order by x.submitted_at desc, x.id desc
                limit 1);

-- Dasselbe fuer Java-Abgaben, falls dort ebenfalls mit Versionen gearbeitet wird.
do $$
begin
  if to_regclass('public.java_submissions') is not null
     and exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='java_submissions'
                    and column_name='is_current') then
    update public.java_submissions set is_current = false where is_current;
    update public.java_submissions s set is_current = true
     where s.id = (select x.id from public.java_submissions x
                    where x.assignment_id = s.assignment_id
                      and x.student_id    = s.student_id
                    order by x.updated_at desc, x.id desc
                    limit 1);
  end if;
end $$;

-- ============================================================================
--  Ergebnis anzeigen
-- ============================================================================
do $$
declare
  v_klassen int;
  v_mehrfach int;
  v_ohne int;
begin
  select count(distinct class_id) into v_klassen from public.assignments;
  select count(*) into v_mehrfach from (
    select assignment_id, student_id from public.submissions
     where is_current group by assignment_id, student_id having count(*) > 1) x;
  select count(*) into v_ohne from (
    select assignment_id, student_id from public.submissions
     group by assignment_id, student_id
    having bool_or(is_current) is not true) y;
  raise notice 'Reihenfolge in % Klasse(n) neu gesetzt: neueste Aufgabe steht oben.', v_klassen;
  if v_mehrfach > 0 then
    raise exception 'Unerwartet: % Paare haben mehr als eine aktuelle Abgabe.', v_mehrfach;
  end if;
  if v_ohne > 0 then
    raise exception 'Unerwartet: % Paare haben gar keine aktuelle Abgabe.', v_ohne;
  end if;
  raise notice 'Abgaben geprueft: je Aufgabe und Person genau eine aktuelle Version.';
  raise notice 'Fertig. Im Browser einmal Strg+F5 druecken.';
end $$;
