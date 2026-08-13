#!/usr/bin/env bash
# ============================================================================
#  Datenbank-Backup der Lern-Plattform  ("Informatik am Gymnasium Wesermuende")
# ----------------------------------------------------------------------------
#  Sichert die Datenbank "postgres" (Konten, Klassen, Aufgaben, Abgaben) in eine
#  komprimierte Datei und raeumt alte Sicherungen automatisch auf.
#
#  AUFRUF (aus dem Ordner supabase/docker):
#      bash scripts/backup.sh
#
#  AUTOMATISCH JEDE NACHT (empfohlen) - einmalig einrichten:
#      crontab -e
#  und diese Zeile ans Ende setzen (Pfad ggf. anpassen):
#      30 2 * * * cd /pfad/zu/supabase/docker && bash scripts/backup.sh >> backups/backup.log 2>&1
#
#  WIEDERHERSTELLEN:  bash scripts/restore.sh backups/<datei>.sql.gz
#
#  HINWEIS ZUM FORMAT (seit Release 1.0.1):
#  Gesichert wird mit  pg_dump --create --clean --if-exists  fuer die Datenbank
#  "postgres". Der Dump loescht die Datenbank beim Einspielen also SELBST und legt
#  sie neu an - dadurch ist der wiederhergestellte Stand exakt der gesicherte.
#  Frueher wurde pg_dumpall verwendet; dessen Dump liess sich nicht einspielen,
#  weil man die Datenbank, mit der man verbunden ist, nicht loeschen kann.
#  Rollen (anon, authenticated, service_role ...) werden bewusst NICHT gesichert:
#  die legt der Supabase-Container bei jeder Installation selbst an.
# ============================================================================
set -uo pipefail

# --- Einstellungen (bei Bedarf anpassen) ------------------------------------
BACKUP_DIR="${BACKUP_DIR:-backups}"   # Zielordner (relativ zu supabase/docker)
KEEP_DAYS="${KEEP_DAYS:-30}"          # taegliche Sicherungen so viele Tage behalten
KEEP_MONTHLY="${KEEP_MONTHLY:-12}"    # zusaetzlich: Monats-Sicherung (jeweils 1. des Monats)
DB="${DB:-postgres}"                  # Name der Datenbank

cd "$(dirname "$0")/.." || { echo "FEHLER: Ordner nicht gefunden."; exit 1; }

# --- Verschluesselung (optional, siehe hardening.conf) ----------------------
# Grundsatz: Ein Backup darf NIE ausfallen. Fehlt der Schluessel oder das
# Werkzeug "age", wird unverschluesselt gesichert und laut gewarnt - lieber
# eine unverschluesselte Sicherung als gar keine.
BACKUP_AGE_RECIPIENT=""
# shellcheck source=/dev/null
[ -f hardening.conf ] && . ./hardening.conf
VERSCHLUESSELN=0
if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
  if command -v age >/dev/null 2>&1; then
    VERSCHLUESSELN=1
  else
    echo "WARNUNG: BACKUP_AGE_RECIPIENT ist gesetzt, aber 'age' ist nicht installiert."
    echo "         Es wird UNVERSCHLUESSELT gesichert. Installieren mit: sudo apt install age"
  fi
fi

if [ ! -f docker-compose.yml ]; then
  echo "FEHLER: Dieses Skript muss im Ordner  supabase/docker  liegen (dort ist die docker-compose.yml)."
  echo "        Aktuell: $(pwd)"
  exit 1
fi

STAMP="$(date +%Y-%m-%d_%H%M)"
DAY_OF_MONTH="$(date +%d)"
mkdir -p "$BACKUP_DIR"
# Reste abgebrochener Laeufe entfernen (enthalten Klartext-Hashes!)
find "$BACKUP_DIR" -maxdepth 1 \( -name '.roh_*' -o -name '*.unfertig' \) -mmin +60 -delete 2>/dev/null || true
chmod 700 "$BACKUP_DIR" 2>/dev/null || true    # Sicherungen enthalten Passwort-Hashes
umask 077                                       # neue Dateien nur fuer den Besitzer
OUT="$BACKUP_DIR/hamster-db_${STAMP}.sql.gz"
[ "$VERSCHLUESSELN" = "1" ] && OUT="$OUT.age"
TMP="$OUT.unfertig"

echo "=== Backup gestartet: $(date '+%Y-%m-%d %H:%M:%S') ==="

# --- Laeuft die Datenbank ueberhaupt? ---------------------------------------
if ! docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; then
  echo "FEHLER: Die Datenbank antwortet nicht. Laeuft der Server? ('docker compose ps')"
  exit 1
fi

# --- Dump erzeugen -----------------------------------------------------------
# Erst IMMER unverschluesselt in eine Zwischendatei: nur so lassen sich die
# Pruefungen unten ueberhaupt durchfuehren. Verschluesselt wird danach.
ROH="$BACKUP_DIR/.roh_$$.sql.gz"
aufraeumen(){ rm -f "$ROH" "$TMP"; }
trap aufraeumen EXIT
if ! docker compose exec -T db pg_dump -U postgres -d "$DB" \
       --create --clean --if-exists 2>"$BACKUP_DIR/.fehler" | gzip -9 > "$ROH"; then
  echo "FEHLER beim Erstellen des Backups:"
  tail -20 "$BACKUP_DIR/.fehler" 2>/dev/null
  exit 1
fi

# --- Plausibilitaetspruefung: ist die Datei wirklich brauchbar? --------------
SIZE=$(wc -c < "$ROH" | tr -d ' ')
if [ "$SIZE" -lt 10000 ]; then
  echo "FEHLER: Das Backup ist nur $SIZE Bytes gross - das kann nicht stimmen. Verworfen."
  exit 1
fi
if ! gzip -t "$ROH" 2>/dev/null; then
  echo "FEHLER: Das Backup ist beschaedigt (gzip-Pruefung fehlgeschlagen). Verworfen."
  exit 1
fi
# Muss die Datenbank neu anlegen UND unsere Kerntabellen enthalten.
#
# ACHTUNG, hier lauerte ein boeser Fehler (behoben in Release 1.1.1):
# Frueher stand hier  zcat ... | grep -q "$MUSS".  "grep -q" beendet sich beim
# ERSTEN Treffer. Dadurch bekommt zcat ein SIGPIPE, und wegen "set -o pipefail"
# gilt die gesamte Pipe als fehlgeschlagen - obwohl der Suchbegriff gefunden
# wurde. Das passiert nur bei GROSSEN Dumps (mehr als ~64 KB, also sobald echte
# Klassendaten drin sind); kleine Testdatenbanken liefen problemlos durch.
# Ergebnis auf dem Schulserver: ein voellig intaktes Backup wurde als "nicht
# wiederherstellbar" verworfen. Deshalb jetzt "grep -c": das liest den Strom
# bis zum Ende und kann kein SIGPIPE ausloesen.
GEFUNDEN="$(zcat "$ROH" 2>/dev/null \
  | grep -oF -e "CREATE DATABASE" -e "COPY public.profiles" -e "COPY auth.users" \
  | sort -u || true)"
for MUSS in "CREATE DATABASE" "COPY public.profiles" "COPY auth.users"; do
  case "$GEFUNDEN" in
    *"$MUSS"*) ;;
    *) echo "FEHLER: Im Dump fehlt '$MUSS' - die Sicherung waere nicht wiederherstellbar. Verworfen."
       exit 1 ;;
  esac
done
KONTEN=$(zcat "$ROH" 2>/dev/null | sed -n '/^COPY auth\.users/,/^\\\.$/p' | grep -c '^[0-9a-f]\{8\}-' || true)

# --- Erst jetzt verschluesseln ----------------------------------------------
if [ "$VERSCHLUESSELN" = "1" ]; then
  if ! age -r "$BACKUP_AGE_RECIPIENT" -o "$TMP" "$ROH" 2>"$BACKUP_DIR/.fehler"; then
    echo "FEHLER beim Verschluesseln:"
    tail -10 "$BACKUP_DIR/.fehler" 2>/dev/null
    echo "Pruefe BACKUP_AGE_RECIPIENT in hardening.conf. Es wurde NICHTS gespeichert."
    exit 1
  fi
  # Gegenprobe: verschluesselte Datei muss groesser als 0 und != Klartext sein
  if [ ! -s "$TMP" ]; then echo "FEHLER: Verschluesselte Datei ist leer. Verworfen."; exit 1; fi
else
  mv "$ROH" "$TMP"
fi
rm -f "$ROH"

mv "$TMP" "$OUT" || { echo "FEHLER: Sicherung liess sich nicht ablegen ($OUT). Platte voll?"; exit 1; }
trap - EXIT
rm -f "$BACKUP_DIR/.fehler"
SCHUTZ=$([ "$VERSCHLUESSELN" = "1" ] && echo "verschluesselt" || echo "UNVERSCHLUESSELT")
echo "OK: $OUT  ($(du -h "$OUT" | cut -f1), $KONTEN Konten, $SCHUTZ)"
if [ "$VERSCHLUESSELN" != "1" ]; then
  echo "    Hinweis: In der Sicherung stehen alle Konten samt Passwort-Hashes."
  echo "    Verschluesselung einschalten: BACKUP_AGE_RECIPIENT in hardening.conf setzen."
fi

# --- Monats-Sicherung: am 1. des Monats eine Kopie dauerhaft aufheben --------
if [ "$DAY_OF_MONTH" = "01" ]; then
  MON="$BACKUP_DIR/monatlich_$(date +%Y-%m).sql.gz"
  [ "$VERSCHLUESSELN" = "1" ] && MON="$MON.age"
  cp "$OUT" "$MON"
  echo "OK: Monats-Sicherung angelegt ($(basename "$MON"))"
fi

# --- Aufraeumen --------------------------------------------------------------
# Muster mit '*' am Ende, damit auch verschluesselte Dateien (.sql.gz.age)
# erfasst werden - sonst wuerde nie etwas geloescht und die Platte laeuft voll.
GELOESCHT=$(find "$BACKUP_DIR" -maxdepth 1 -name 'hamster-db_*.sql.gz*' -type f -mtime "+$KEEP_DAYS" -print -delete 2>/dev/null | wc -l | tr -d ' ')
[ "$GELOESCHT" -gt 0 ] && echo "Aufgeraeumt: $GELOESCHT Sicherung(en) aelter als $KEEP_DAYS Tage geloescht."
ALT_MONAT=$(ls -1t "$BACKUP_DIR"/monatlich_*.sql.gz* 2>/dev/null | tail -n "+$((KEEP_MONTHLY+1))")
if [ -n "$ALT_MONAT" ]; then
  echo "$ALT_MONAT" | xargs rm -f
  echo "Aufgeraeumt: alte Monats-Sicherungen (aelter als $KEEP_MONTHLY Monate) geloescht."
fi

ANZ=$(ls -1 "$BACKUP_DIR"/*.sql.gz* 2>/dev/null | wc -l | tr -d ' ')
GES=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)
echo "Bestand: $ANZ Sicherung(en), $GES gesamt."
echo "=== Backup fertig: $(date '+%Y-%m-%d %H:%M:%S') ==="
echo ""
echo "WICHTIG: Kopiert die Sicherungen regelmaessig auch AUSSERHALB dieses Servers"
echo "         (z. B. auf ein Netzlaufwerk der Schule). Ein Backup, das nur auf"
echo "         demselben Rechner liegt, hilft bei einem Festplattendefekt nicht."
