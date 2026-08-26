#!/usr/bin/env bash
# ============================================================================
#  Pruefung: Aendert ein erneutes Einspielen der Schema-Dateien Daten?
# ----------------------------------------------------------------------------
#  Hintergrund: Seit scripts/update.sh die Dateien aus migrationen.txt selbst
#  abarbeitet, laufen sie bei JEDEM Update erneut. Eine Zeile, die dabei Daten
#  umschreibt statt nur Strukturen anzulegen, richtet dann jedes Mal Schaden an.
#
#  Genau das ist am 25.08.2026 passiert: schema_update_phaseB.sql nummerierte
#  die Aufgaben neu durch und stellte damit die Reihenfolge auf den Kopf.
#
#  Diese Pruefung legt Testdaten an, spielt alle Dateien dreimal ein und
#  vergleicht danach eine Pruefsumme ueber JEDE Tabelle. Sie gehoert vor jede
#  Veroeffentlichung, die eine Schema-Datei aendert oder hinzufuegt.
#
#  AUFRUF (im Ordner supabase/docker, Plattform muss laufen):
#      bash hamster-site/tests/pruefe-wiederholtes-einspielen.sh
#
#  Legt nur Testdaten mit dem Praefix PRUEFLAUF an und raeumt sie wieder weg.
# ============================================================================
set -uo pipefail

SQLDIR="${SQLDIR:-hamster-site}"
[ -f "$SQLDIR/migrationen.txt" ] || {
  echo "FEHLER: $SQLDIR/migrationen.txt nicht gefunden."
  echo "        Aus dem Ordner supabase/docker starten, oder SQLDIR=... setzen."; exit 1; }
[ -f docker-compose.yml ] || { echo "FEHLER: Bitte aus dem Ordner supabase/docker starten."; exit 1; }

OK=0; FEHL=0
gut(){ printf '  [ OK ] %s\n' "$1"; OK=$((OK+1)); }
bad(){ printf '  [FEHL] %s\n' "$1"; FEHL=$((FEHL+1)); }

ROLLE=""
for k in supabase_admin postgres; do
  if docker compose exec -T db psql -U "$k" -d postgres -tAc "select 1" </dev/null >/dev/null 2>&1; then
    ROLLE="$k"; break; fi
done
[ -n "$ROLLE" ] || { echo "FEHLER: keine Verbindung zur Datenbank."; exit 1; }

P(){ docker compose exec -T db psql -U "$ROLLE" -d postgres -tAc "$1" </dev/null 2>&1 | tr -d '\r'; }
EINSPIELEN(){
  local f rc=0
  while IFS= read -r f; do
    case "$f" in ""|\#*) continue;; esac
    [ -f "$SQLDIR/$f" ] || continue
    if ! docker compose exec -T -e PGOPTIONS="-c client_min_messages=warning" db \
         psql -U "$ROLLE" -d postgres -q -v ON_ERROR_STOP=1 < "$SQLDIR/$f" >/tmp/pruef.log 2>&1; then
      echo "  [!] $f schlug fehl:"; tail -4 /tmp/pruef.log | sed 's/^/      /'; rc=1
    fi
  done < "$SQLDIR/migrationen.txt"
  return $rc
}

echo "=== Testdaten anlegen ==="
docker compose exec -T db psql -U "$ROLLE" -d postgres -q </dev/null -c "
do \$\$
declare v_l uuid; v_s uuid; v_k uuid; v_a uuid; v_pos int; i int;
begin
  delete from public.classes  where name like 'PRUEFLAUF%';
  delete from public.profiles where username like 'pruef_%';
  delete from auth.users      where email like 'pruef_%@hamster.local';
  v_l := gen_random_uuid(); v_s := gen_random_uuid();
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
      created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,
      email_change_token_current,phone_change,phone_change_token,reauthentication_token) values
    (v_l,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','pruef_l@hamster.local','x',now(),now(),now(),'','','','','','','',''),
    (v_s,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','pruef_s@hamster.local','x',now(),now(),now(),'','','','','','','','');
  insert into public.profiles(id,username,role,display_name) values
    (v_l,'pruef_lehrer','teacher','Prueflauf Lehrkraft'), (v_s,'pruef_kind','student','Prueflauf Kind');
  insert into public.classes(name,code,teacher_id) values ('PRUEFLAUF','PRUEF1',v_l) returning id into v_k;
  insert into public.memberships(class_id,student_id) values (v_k,v_s);
  -- Aufgaben so anlegen, wie es die Oberflaeche tut: jede neue ganz nach oben
  v_pos := 0;
  for i in 1..4 loop
    insert into public.assignments(class_id,title,territory,published,position,created_at)
      values (v_k,'Aufgabe '||i,'{\"rows\":1,\"cols\":5,\"walls\":[],\"grains\":[],\"hamster\":{\"row\":0,\"col\":0,\"dir\":0,\"grains\":0}}'::jsonb,
              true, v_pos, now() - ((5-i)||' days')::interval);
    v_pos := v_pos - 1;
  end loop;
  select id into v_a from public.assignments where class_id=v_k and title='Aufgabe 1';
  -- drei Abgabe-Versionen, die juengste ist die aktuelle
  insert into public.submissions(assignment_id,student_id,code,passed,is_current,submitted_at) values
    (v_a,v_s,'Fassung 1',false,false, now()- interval '2 days'),
    (v_a,v_s,'Fassung 2',false,false, now()- interval '1 day');
  insert into public.submissions(assignment_id,student_id,code,passed,is_current,submitted_at) values
    (v_a,v_s,'Fassung 3',true, true,  now());
end \$\$;" 2>&1 | sed 's/^/  /'

docker compose exec -T db psql -U "$ROLLE" -d postgres -q </dev/null -c "
create or replace function public.__pruef_summe()
returns table(tabelle text, summe text) language plpgsql as \$\$
declare r record; s text;
begin
  for r in select tablename from pg_tables
            where schemaname='public' and tablename <> 'hamster_migrationen'
            order by tablename loop
    execute format('select md5(coalesce(string_agg(x::text, %L order by x::text), %L)) from public.%I x',
                   '|', 'leer', r.tablename) into s;
    tabelle := r.tablename; summe := s; return next;
  end loop;
end \$\$;" >/dev/null 2>&1
SUMME(){ P "select string_agg(tabelle||'='||summe, E'\n' order by tabelle) from public.__pruef_summe()"; }

echo ""
echo "=== 1. Durchgang ==="
EINSPIELEN && gut "ohne Fehler durchgelaufen" || bad "eine Datei schlug fehl"
A="$(SUMME)"
N=$(printf '%s\n' "$A" | wc -l)
ECHT=$(P "select count(*) from pg_tables where schemaname='public' and tablename <> 'hamster_migrationen'")
# Wichtig: erst pruefen, ob die Pruefsumme ueberhaupt etwas erfasst hat. Sonst
# waere ein Vergleich zweier Fehlermeldungen faelschlich "gruen".
if [ "$N" -ge "$ECHT" ] 2>/dev/null && [ "$N" -gt 10 ]; then
  gut "Pruefsumme ueber $N Tabellen gebildet"
else
  bad "nur $N von $ECHT Tabellen erfasst - dieser Vergleich waere wertlos"
  printf '%s\n' "$A" | head -3 | sed 's/^/       /'
fi

echo ""
echo "=== 2. und 3. Durchgang ==="
EINSPIELEN && gut "zweiter Durchgang ohne Fehler" || bad "zweiter Durchgang schlug fehl"
B="$(SUMME)"
if [ "$A" = "$B" ]; then gut "keine Tabelle hat sich veraendert"
else bad "diese Tabellen wurden veraendert:"
     diff <(printf '%s\n' "$A") <(printf '%s\n' "$B") | grep '^[<>]' | sed 's/^/       /'; fi
EINSPIELEN >/dev/null 2>&1
[ "$(SUMME)" = "$A" ] && gut "auch nach dem dritten Durchgang unveraendert" || bad "dritter Durchgang aenderte etwas"

echo ""
echo "=== Reihenfolge und Abgabe-Verlauf im Klartext ==="
[ "$(P "select a.title from public.assignments a join public.classes c on c.id=a.class_id
        where c.name='PRUEFLAUF' order by a.position limit 1")" = "Aufgabe 4" ] \
  && gut "die neueste Aufgabe steht weiterhin oben" || bad "die Reihenfolge wurde verdreht"
[ "$(P "select s.code from public.submissions s join public.profiles p on p.id=s.student_id
        where p.username='pruef_kind' and s.is_current")" = "Fassung 3" ] \
  && gut "die juengste Abgabe ist weiterhin die aktuelle" || bad "eine andere Version ist markiert"
[ "$(P "select count(*) from public.submissions s join public.profiles p on p.id=s.student_id
        where p.username='pruef_kind' and s.is_current")" = "1" ] \
  && gut "genau eine Abgabe ist als aktuell markiert" || bad "nicht genau eine aktuelle Abgabe"

docker compose exec -T db psql -U "$ROLLE" -d postgres -q </dev/null -c "
  drop function if exists public.__pruef_summe();
  delete from public.classes  where name like 'PRUEFLAUF%';
  delete from public.profiles where username like 'pruef_%';
  delete from auth.users      where email like 'pruef_%@hamster.local';" >/dev/null 2>&1

echo ""
echo "============================================================"
echo "  WIEDERHOLTES EINSPIELEN:  $OK bestanden, $FEHL fehlgeschlagen"
echo "============================================================"
[ "$FEHL" -eq 0 ] || exit 1
