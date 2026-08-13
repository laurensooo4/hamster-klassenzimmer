#!/usr/bin/env bash
# ============================================================================
#  Datenbank WIEDERHERSTELLEN aus einem Backup
# ----------------------------------------------------------------------------
#  ACHTUNG: Ueberschreibt den AKTUELLEN Datenbestand vollstaendig!
#
#  AUFRUF (aus dem Ordner supabase/docker):
#      bash scripts/restore.sh backups/hamster-db_2026-08-11_0230.sql.gz
#
#  SO LAEUFT ES AB:
#   1. Der jetzige Stand wird vorsichtshalber gesichert.
#   2. Alle Dienste werden angehalten, nur die Datenbank laeuft weiter -
#      sonst schreibt jemand waehrend der Wiederherstellung dazwischen.
#   3. Offene Verbindungen zur Datenbank werden gekappt.
#   4. Der Dump wird eingespielt. Er loescht die Datenbank selbst und legt sie
#      neu an; eingespielt wird deshalb ueber eine ANDERE Datenbank
#      (_supabase bzw. template1) - man kann die Datenbank, mit der man
#      verbunden ist, nicht loeschen. Genau daran ist die erste Fassung dieses
#      Skripts gescheitert.
#   5. Es wird geprueft, ob die Daten wirklich angekommen sind.
#   6. Alle Dienste starten wieder.
# ============================================================================
set -uo pipefail

cd "$(dirname "$0")/.." || { echo "FEHLER: Ordner nicht gefunden."; exit 1; }
umask 077
[ -f docker-compose.yml ] || { echo "FEHLER: Bitte aus dem Ordner supabase/docker starten."; exit 1; }

DATEI="${1:-}"
if [ -z "$DATEI" ]; then
  echo "AUFRUF: bash scripts/restore.sh <sicherungsdatei.sql.gz>"
  echo ""
  echo "Vorhandene Sicherungen:"
  ls -1sh backups/*.sql.gz* 2>/dev/null || echo "  (keine gefunden)"
  exit 1
fi
[ -f "$DATEI" ] || { echo "FEHLER: Datei nicht gefunden: $DATEI"; exit 1; }

# --- Verschluesselte Sicherung? dann zuerst entschluesseln -------------------
ENTSCHLUESSELT=""
if [ "${DATEI##*.}" = "age" ]; then
  command -v age >/dev/null 2>&1 || { echo "FEHLER: Diese Sicherung ist verschluesselt, 'age' fehlt. Installieren: sudo apt install age"; exit 1; }
  SCHLUESSEL="${AGE_KEY:-}"
  if [ -z "$SCHLUESSEL" ]; then
    echo "Diese Sicherung ist verschluesselt. Wo liegt der private Schluessel?"
    echo "(Datei aus 'age-keygen', z. B. /media/usb/backup-key.txt - NICHT auf diesem Server aufbewahren)"
    printf "Pfad zum Schluessel: "
    read -r SCHLUESSEL
  fi
  [ -f "$SCHLUESSEL" ] || { echo "FEHLER: Schluesseldatei nicht gefunden: $SCHLUESSEL"; exit 1; }
  QUELLE="$DATEI"
  ENTSCHLUESSELT="$(mktemp)"
  chmod 600 "$ENTSCHLUESSELT"
  trap 'rm -f "$ENTSCHLUESSELT"' EXIT
  if ! age -d -i "$SCHLUESSEL" -o "$ENTSCHLUESSELT" "$DATEI" 2>/tmp/agefehler.txt; then
    echo "FEHLER beim Entschluesseln:"; tail -10 /tmp/agefehler.txt; exit 1
  fi
  echo "Sicherung entschluesselt."
  DATEI="$ENTSCHLUESSELT"
fi

gzip -t "$DATEI" 2>/dev/null || { echo "FEHLER: Die Datei ist beschaedigt (gzip-Pruefung fehlgeschlagen)."; exit 1; }

# --- Format erkennen ---------------------------------------------------------
# Neu (Release 1.0.1+): "PostgreSQL database dump"        -> pg_dump, einspielbar
# Alt  (Release 1.0):   "PostgreSQL database cluster dump" -> pg_dumpall, defekt
# "|| true", weil head sich nach 5 Zeilen beendet: zcat bekommt SIGPIPE und die
# Pipe gilt wegen "pipefail" sonst als fehlgeschlagen (siehe backup.sh).
KOPF="$(zcat "$DATEI" 2>/dev/null | head -5 || true)"
if printf '%s' "$KOPF" | grep -q "database cluster dump"; then
  ALTFORMAT=1
  echo "HINWEIS: Diese Sicherung stammt aus der alten Fassung (pg_dumpall)."
  echo "         Sie wird unterstuetzt, ist aber weniger zuverlaessig."
  echo "         Bitte nach der Wiederherstellung sofort ein neues Backup anlegen."
  echo ""
else
  ALTFORMAT=0
fi

echo "============================================================"
echo " WIEDERHERSTELLUNG"
echo "   Quelle : ${QUELLE:-$DATEI}"
echo "   Groesse: $(du -h "${QUELLE:-$DATEI}" | cut -f1)"
echo "   Datum  : $(date -r "${QUELLE:-$DATEI}" '+%Y-%m-%d %H:%M' 2>/dev/null || echo unbekannt)"
echo ""
echo " ACHTUNG: Der aktuelle Datenbestand wird VOLLSTAENDIG ersetzt."
echo "          Alle seitdem entstandenen Abgaben gehen verloren."
echo "============================================================"
printf "Wirklich fortfahren? Tippe GENAU  JA  und Enter: "
read -r ANTWORT
[ "$ANTWORT" = "JA" ] || { echo "Abgebrochen - es wurde nichts veraendert."; exit 0; }

warte_auf_db(){
  for _ in $(seq 1 60); do
    docker compose exec -T db pg_isready -U postgres </dev/null >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

# --- Rolle mit ausreichenden Rechten waehlen (neu in Release 1.1.1) ---------
# In Supabase self-hosted ist "postgres" KEIN Superuser - das ist "supabase_admin"
# (nachzulesen in der Einstellung supautils.superuser). Ein Dump enthaelt aber
# Anweisungen, die nur ein Superuser ausfuehren darf, unter anderem:
#     ALTER DATABASE postgres SET "app.settings.jwt_secret" TO '...'
#     CREATE EVENT TRIGGER ... / ALTER ... OWNER TO supabase_admin
#     CREATE EXTENSION ... / COMMENT ON EXTENSION ...
# Als "postgres" bricht das Einspielen daran ab - und zwar NACHDEM der Dump die
# Datenbank bereits geloescht und leer neu angelegt hat. Genau so ist eine
# Schulinstallation leergelaufen. Deshalb wird, wenn vorhanden, als
# "supabase_admin" gearbeitet; sonst bleibt es bei "postgres".
DBROLLE=""
for kand in supabase_admin postgres; do
  if docker compose exec -T db psql -U "$kand" -d postgres -tAc "select 1" </dev/null >/dev/null 2>&1; then
    DBROLLE="$kand"; break
  fi
done
[ -n "$DBROLLE" ] || { echo "FEHLER: Keine Verbindung zur Datenbank moeglich."; exit 1; }
echo "Datenbank-Rolle: $DBROLLE"

# --- 1) Sicherheitsnetz ------------------------------------------------------
# Hinweis zu "</dev/null": "docker compose exec" haengt sich an die Eingabe des
# Skripts. Ohne diese Umleitung frisst es die Tastatureingaben weg, die spaeter
# noch gebraucht werden (z. B. die Rueckfrage weiter unten).
echo "[1/6] Sichere den aktuellen Stand ..."
mkdir -p backups
VORHER=""
KERN_JETZT="$(docker compose exec -T db psql -U "$DBROLLE" -d postgres -tAc \
              "select to_regclass('auth.users') is not null" </dev/null 2>/dev/null | tr -d ' \r')"
if [ "$KERN_JETZT" != "t" ]; then
  echo "      In der Datenbank liegen derzeit keine Plattform-Daten."
  echo "      (Normal, wenn eine vorherige Wiederherstellung abgebrochen ist.)"
  echo "      Es gibt also nichts zu sichern - weiter."
else
  VORHER="backups/vor-wiederherstellung_$(date +%Y-%m-%d_%H%M).sql.gz"
  if docker compose exec -T db pg_dump -U "$DBROLLE" -d postgres --create --clean --if-exists \
       </dev/null 2>/dev/null | gzip -9 > "$VORHER" \
     && [ "$(wc -c < "$VORHER" | tr -d ' ')" -gt 10000 ]; then
    echo "      -> $VORHER"
  else
    rm -f "$VORHER"; VORHER=""
    echo "      WARNUNG: Sicherung des aktuellen Standes fehlgeschlagen."
    printf "      Trotzdem weitermachen? (j/N): "
    read -r W; case "$W" in [jJ]*) ;; *) echo "Abgebrochen."; exit 1;; esac
  fi
fi

# --- 2) Dienste anhalten, nur Datenbank laufen lassen ------------------------
# Bewusst OHNE feste Dienstnamen (Supabase benennt Dienste gelegentlich um).
echo "[2/6] Halte die Dienste an (nur die Datenbank bleibt) ..."
docker compose stop >/dev/null 2>&1
docker compose up -d db >/dev/null 2>&1
warte_auf_db || { echo "FEHLER: Die Datenbank startet nicht. 'docker compose logs db' pruefen."; exit 1; }

# --- 3) Einspiel-Datenbank waehlen (NICHT die, die ersetzt wird) -------------
ZIELDB=""
for kand in _supabase template1; do
  if docker compose exec -T db psql -U "$DBROLLE" -d "$kand" -c "select 1" </dev/null >/dev/null 2>&1; then ZIELDB="$kand"; break; fi
done
[ -n "$ZIELDB" ] || { echo "FEHLER: Keine Hilfs-Datenbank (_supabase/template1) erreichbar."; exit 1; }
echo "[3/6] Einspielen ueber die Datenbank '$ZIELDB' ..."

FEHLERLOG="backups/.restore-fehler"

# --- 4) Datenbank freiraeumen (behoben in Release 1.1.1) --------------------
# Frueher wurden hier nur die offenen Verbindungen "abgeschossen". Das reicht
# NICHT: In der Datenbank laufen Hintergrund-Dienste von Supabase (pg_cron und
# pg_net), die sich sofort neu verbinden. Zwischen dem Abschiessen und dem
# "DROP DATABASE" aus dem Dump waren sie laengst wieder da - das Einspielen
# scheiterte mit:  database "postgres" is being accessed by other users.
#
# Richtig ist die Reihenfolge:
#   1. keine NEUEN Verbindungen mehr zulassen  (allow_connections false)
#   2. alle bestehenden Verbindungen beenden
#   3. die Datenbank selbst mit WITH (FORCE) entfernen - das beendet in einem
#      Zug alles, was noch dranhaengt, und loescht sie sofort danach
# Das "DROP DATABASE IF EXISTS" im Dump laeuft dann ins Leere, "CREATE DATABASE"
# legt sie frisch an. Klappt Schritt 3 nicht, wird die Sperre aus Schritt 1
# sofort wieder aufgehoben - die Plattform bleibt also in jedem Fall benutzbar.
psql_ziel(){ docker compose exec -T db psql -U "$DBROLLE" -d "$ZIELDB" -q "$@" </dev/null; }

datenbank_freiraeumen(){
  psql_ziel -c "alter database postgres with allow_connections false;" >/dev/null 2>&1
  psql_ziel -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='postgres' and pid <> pg_backend_pid();" >/dev/null 2>&1
  if psql_ziel -v ON_ERROR_STOP=1 -c "drop database if exists postgres with (force);" >/dev/null 2>"$FEHLERLOG"; then
    return 0
  fi
  psql_ziel -c "alter database postgres with allow_connections true;" >/dev/null 2>&1
  return 1
}

# Sicherheitsnetz (neu in Release 1.1.1): Bricht das Einspielen mittendrin ab,
# ist die Datenbank meist schon geloescht und leer neu angelegt - der Dump
# loescht sie naemlich ganz am Anfang. Frueher meldete das Skript in diesem Fall
# faelschlich "Es wurde nichts Halbes hinterlassen" und liess eine LEERE
# Datenbank stehen. Jetzt wird geprueft, ob die Kerntabellen noch da sind, und
# der Stand von vorher notfalls automatisch zurueckgeholt.
notfall_rueckweg(){
  KERN="$(docker compose exec -T db psql -U "$DBROLLE" -d postgres -tAc \
          "select to_regclass('auth.users') is not null" </dev/null 2>/dev/null | tr -d ' \r')"
  if [ "$KERN" = "t" ]; then
    echo ""
    echo "Die Datenbank ist unveraendert geblieben - es ging nichts verloren."
    docker compose up -d >/dev/null 2>&1
    return 0
  fi
  echo ""
  echo "ACHTUNG: Die Datenbank ist jetzt leer. Ich hole den Stand von vorher zurueck ..."
  if [ -z "${VORHER:-}" ] || [ ! -f "$VORHER" ]; then
    echo "FEHLER: Es gibt keine Sicherung von vorher. Bitte von Hand eine Sicherung"
    echo "        aus dem Ordner 'backups' einspielen."
    docker compose up -d >/dev/null 2>&1
    return 1
  fi
  datenbank_freiraeumen || true
  if zcat "$VORHER" | docker compose exec -T db psql -U "$DBROLLE" -d "$ZIELDB" \
       -v ON_ERROR_STOP=1 -q >/dev/null 2>"$FEHLERLOG.rueckweg"; then
    echo "OK: Der Stand von VOR der Wiederherstellung ist wieder da."
    echo "    Konten: $(docker compose exec -T db psql -U "$DBROLLE" -d postgres -tAc 'select count(*) from auth.users' </dev/null 2>/dev/null | tr -d ' \r')"
  else
    echo "FEHLER: Auch das Zurueckholen ist gescheitert. Letzte Meldungen:"
    tail -15 "$FEHLERLOG.rueckweg" 2>/dev/null
    echo "Die Sicherung liegt unveraendert hier: $VORHER"
  fi
  docker compose up -d >/dev/null 2>&1
  return 1
}

if ! datenbank_freiraeumen; then
  echo ""
  echo "FEHLER: Die Datenbank liess sich nicht zum Ueberschreiben freigeben."
  tail -10 "$FEHLERLOG" 2>/dev/null
  echo ""
  echo "Es wurde NICHTS veraendert. Die Plattform laeuft unveraendert weiter."
  docker compose up -d >/dev/null 2>&1
  exit 1
fi

# --- 5) Dump einspielen ------------------------------------------------------
echo "[4/6] Spiele die Sicherung ein ..."
if [ "$ALTFORMAT" = "1" ]; then
  # Alte Cluster-Dumps enthalten DROP ROLE/DATABASE fuer alles - dabei sind
  # Fehler unvermeidlich (Rollen sind in Benutzung). Deshalb ohne Abbruch,
  # dafuer wird unten hart geprueft, ob die Daten angekommen sind.
  zcat "$DATEI" | docker compose exec -T db psql -U "$DBROLLE" -d template1 >/dev/null 2>"$FEHLERLOG"
else
  if ! zcat "$DATEI" | docker compose exec -T db psql -U "$DBROLLE" -d "$ZIELDB" \
        -v ON_ERROR_STOP=1 -q >/dev/null 2>"$FEHLERLOG"; then
    echo ""
    echo "FEHLER beim Einspielen:"
    tail -25 "$FEHLERLOG"
    notfall_rueckweg
    echo ""
    echo "Die eingespielte Sicherung liegt weiterhin hier: $DATEI"
    exit 1
  fi
fi

# --- 6) Nachpruefen: sind die Daten wirklich da? -----------------------------
echo "[5/6] Pruefe das Ergebnis ..."
warte_auf_db || { echo "FEHLER: Datenbank nicht erreichbar."; exit 1; }
zaehle(){ docker compose exec -T db psql -U "$DBROLLE" -d postgres -tAc "$1" </dev/null 2>/dev/null | tr -d ' \r'; }
N_KONTEN="$(zaehle "select count(*) from auth.users")"
N_PROFILE="$(zaehle "select count(*) from public.profiles")"
N_KLASSEN="$(zaehle "select count(*) from public.classes")"
if [ -z "$N_KONTEN" ] || [ -z "$N_PROFILE" ]; then
  echo ""
  echo "FEHLER: Nach dem Einspielen sind die Tabellen nicht lesbar - die"
  echo "        Wiederherstellung ist NICHT sauber durchgelaufen."
  [ -s "$FEHLERLOG" ] && { echo "Letzte Meldungen:"; tail -25 "$FEHLERLOG"; }
  notfall_rueckweg
  exit 1
fi
rm -f "$FEHLERLOG"

# --- 7) Dienste wieder starten ----------------------------------------------
echo "[6/6] Starte alle Dienste wieder ..."
docker compose up -d >/dev/null 2>&1

# Warten, bis die Web-App wirklich wieder antwortet (neu in Release 1.1.2).
# Das API-Gateway (Envoy) braucht nach einem Neustart rund eine Minute, bis es
# als "healthy" gilt; der Web-Container startet erst danach. Ohne dieses Warten
# meldet das Skript "FERTIG", waehrend die Seite noch nicht erreichbar ist -
# und eine direkt danach ausgefuehrte Abnahme (check-security.sh) meldet
# faelschlich, die Plattform sei kaputt.
APPPORT="$(docker compose port frontend 80 2>/dev/null | sed 's/.*://')"
if [ -n "${APPPORT:-}" ] && command -v curl >/dev/null 2>&1; then
  printf "      Warte, bis die Web-App wieder antwortet "
  APPOK=0
  for _ in $(seq 1 40); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${APPPORT}/" 2>/dev/null)" = "200" ]; then
      APPOK=1; break
    fi
    printf "."; sleep 5
  done
  if [ "$APPOK" = "1" ]; then
    echo " erreichbar."
  else
    echo ""
    echo "      HINWEIS: Die Web-App antwortet nach 200 Sekunden noch nicht."
    echo "      Die Daten sind eingespielt. Bitte kurz warten und dann pruefen:"
    echo "         docker compose ps        (alles 'healthy'?)"
    echo "         curl -I http://127.0.0.1:${APPPORT}/"
  fi
fi

echo ""
echo "============================================================"
echo " FERTIG - wiederhergestellter Stand:"
echo "   Konten (Login):      $N_KONTEN"
echo "   Profile:             $N_PROFILE"
echo "   Klassen:             $N_KLASSEN"
echo "============================================================"
echo "Bitte einmal anmelden und stichprobenartig pruefen."
if [ -n "${VORHER:-}" ]; then
  echo "Der Stand VOR der Wiederherstellung liegt weiterhin in:"
  echo "   $VORHER"
fi
[ "$ALTFORMAT" = "1" ] && echo "" && echo "BITTE JETZT: bash scripts/backup.sh   (legt eine Sicherung im neuen Format an)"
exit 0
