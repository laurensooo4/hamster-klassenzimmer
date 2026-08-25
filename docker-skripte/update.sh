#!/usr/bin/env bash
# ============================================================================
#  Plattform aktualisieren  -  EIN Befehl, alles drin
# ----------------------------------------------------------------------------
#  Holt den aktuellen Stand der Web-App von GitHub, bringt die Datenbank auf
#  denselben Stand, schaltet neue Server-Funktionen ein und startet die
#  betroffenen Container neu.
#
#  AUFRUF (aus dem Ordner supabase/docker):
#      sudo bash scripts/update.sh
#
#  Konten, Klassen, Aufgaben und Abgaben bleiben dabei erhalten. Vor jeder
#  Aenderung wird automatisch gesichert; geht bei der Datenbank etwas schief,
#  stellt das Skript den vorherigen Stand von selbst wieder her.
#
#  Ohne Internet auf dem Server? Dann die neuen Dateien von Hand nach
#  hamster-site/ kopieren und dieses Skript mit  OFFLINE=1  starten:
#      sudo OFFLINE=1 bash scripts/update.sh
# ============================================================================
set -uo pipefail

REPO="${REPO:-https://github.com/laurensooo4/hamster-klassenzimmer}"
OFFLINE="${OFFLINE:-0}"

cd "$(dirname "$0")/.." || { echo "FEHLER: Ordner nicht gefunden."; exit 1; }
[ -f docker-compose.yml ] || { echo "FEHLER: Bitte aus dem Ordner supabase/docker starten."; exit 1; }
if [ "$OFFLINE" != "1" ]; then
  command -v git >/dev/null 2>&1 || { echo "FEHLER: 'git' ist nicht installiert."; exit 1; }
fi

echo "=== Update der Lern-Plattform ==="
[ "$OFFLINE" = "1" ] && echo "Modus: offline (hamster-site/ wird nicht ausgetauscht)" \
                     || echo "Quelle: $REPO"
echo ""

ALT=""            # Sicherungsordner der bisherigen Web-Dateien (fuer den Rueckweg)
SICHERUNG=""      # Pfad der Datensicherung aus Schritt 1

# ---------------------------------------------------------------------------
#  Hilfsfunktionen fuer die Datenbank
# ---------------------------------------------------------------------------
# In Supabase ist NICHT 'postgres' der Superuser, sondern 'supabase_admin'.
# Welche Rolle vorhanden ist, haengt vom Alter der Installation ab -> ausprobieren.
DBROLLE=""
rolle_finden(){
  for kand in supabase_admin postgres; do
    if docker compose exec -T db psql -U "$kand" -d postgres -tAc "select 1" \
         </dev/null >/dev/null 2>&1; then DBROLLE="$kand"; return 0; fi
  done
  return 1
}
# NOTICE-Meldungen der Migrationen unterdruecken, WARNING und ERROR bleiben sichtbar.
psql_still(){ docker compose exec -T -e PGOPTIONS="-c client_min_messages=warning" \
                db psql -U "$DBROLLE" -d postgres -q -v ON_ERROR_STOP=1 "$@"; }
psql_wert(){  docker compose exec -T db psql -U "$DBROLLE" -d postgres -tAc "$1" \
                </dev/null 2>/dev/null | tr -d '\r' | head -1; }

zurueck_zur_alten_web_fassung(){
  [ -n "$ALT" ] && [ -d "$ALT" ] || return 0
  rm -rf hamster-site && mv "$ALT" hamster-site
  docker compose restart frontend >/dev/null 2>&1
  echo "      Die vorherige Fassung der Web-App ist wieder aktiv."
}

# --- 1) Sicherheitsnetz: vorher sichern -------------------------------------
echo "[1/7] Lege vorher eine Sicherung an ..."
if bash scripts/backup.sh >/dev/null 2>&1; then
  SICHERUNG="$(ls -1t backups/hamster-db_*.sql.gz* 2>/dev/null | head -1)"
  echo "      OK: $SICHERUNG"
else
  echo "      WARNUNG: Sicherung fehlgeschlagen."
  printf "      Trotzdem aktualisieren? (j/N): "
  read -r W </dev/tty; case "$W" in [jJ]*) ;; *) echo "Abgebrochen."; exit 1;; esac
fi

# --- 2) Neuen Stand holen ----------------------------------------------------
if [ "$OFFLINE" = "1" ]; then
  echo "[2/7] Uebersprungen (offline)."
else
  echo "[2/7] Hole den aktuellen Stand ..."
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  if ! git clone --depth 1 "$REPO" "$TMP/neu" >/dev/null 2>&1; then
    echo "FEHLER: Konnte das Repository nicht laden. Internet auf dem Server vorhanden?"
    echo "        Alternativ die Dateien von Hand kopieren und  sudo OFFLINE=1 bash scripts/update.sh  starten."
    exit 1
  fi
  VERSION="$(grep -oE 'APP_BUILD = "[^"]+"' "$TMP/neu/app.js" 2>/dev/null | head -1 | cut -d'"' -f2)"
  [ -n "$VERSION" ] && echo "      Neuer Stand: $VERSION"
fi

# --- 3) Dateien austauschen --------------------------------------------------
# WICHTIG: config.js wird NICHT uebernommen - der Container blendet ohnehin
# frontend/config.docker.js darueber (Login-only, eigener ANON_KEY).
if [ "$OFFLINE" = "1" ]; then
  echo "[3/7] Uebersprungen (offline)."
else
  echo "[3/7] Tausche die Web-Dateien aus ..."
  # Sekunden mit im Namen, und notfalls durchzaehlen: Zwei Updates in derselben
  # Minute wuerden sonst denselben Ordner treffen - 'mv' schoebe das Verzeichnis
  # dann in den bestehenden Sicherungsordner HINEIN statt danebenzulegen, und
  # der Rueckweg holte anschliessend Unsinn zurueck.
  ALT="hamster-site.alt-$(date +%Y-%m-%d_%H%M%S)"
  N=2; while [ -e "$ALT" ]; do ALT="hamster-site.alt-$(date +%Y-%m-%d_%H%M%S)-$N"; N=$((N+1)); done
  mv hamster-site "$ALT" || { echo "FEHLER: hamster-site liess sich nicht umbenennen."; exit 1; }
  rm -rf "$TMP/neu/.git"
  cp -r "$TMP/neu" hamster-site
  # Server-Konfiguration aus der alten Installation uebernehmen, falls vorhanden
  [ -f "$ALT/config.js" ] && cp "$ALT/config.js" hamster-site/config.js 2>/dev/null
  echo "      Vorherige Fassung liegt in: $ALT"
fi

# --- 4) Datenbank auf denselben Stand bringen -------------------------------
# Frueher musste man die schema_update_*.sql-Dateien von Hand einspielen. Das
# uebernimmt jetzt dieses Skript: Es merkt sich in der Tabelle
# public.hamster_migrationen, welche Datei in welcher Fassung schon gelaufen
# ist, und spielt nur das Fehlende ein. Alle Dateien sind wiederholbar
# aufgebaut, ein zweiter Lauf richtet also keinen Schaden an.
echo "[4/7] Bringe die Datenbank auf denselben Stand ..."
if ! rolle_finden; then
  echo "      FEHLER: Keine Verbindung zur Datenbank (weder supabase_admin noch postgres)."
  echo "              Laeuft der Container?   docker compose ps db"
  zurueck_zur_alten_web_fassung
  exit 1
fi

LISTE="hamster-site/migrationen.txt"
if [ ! -f "$LISTE" ]; then
  echo "      Uebersprungen: hamster-site/migrationen.txt fehlt (aeltere Fassung)."
else
  # Merkzettel anlegen. Kein Zugriff fuer angemeldete Nutzer - die Tabelle geht
  # nur den Server etwas an.
  psql_still </dev/null -c "
    create table if not exists public.hamster_migrationen(
      datei         text primary key,
      pruefsumme    text not null,
      angewendet_am timestamptz not null default now());
    alter table public.hamster_migrationen enable row level security;
    revoke all on public.hamster_migrationen from anon, authenticated;" >/dev/null 2>&1

  NEU=0; SCHON=0; FEHLER=""
  while IFS= read -r DATEI; do
    case "$DATEI" in ""|\#*) continue;; esac
    PFAD="hamster-site/$DATEI"
    [ -f "$PFAD" ] || { echo "      uebersprungen (fehlt): $DATEI"; continue; }
    SUM="$(md5sum "$PFAD" | cut -d' ' -f1)"
    if [ "$(psql_wert "select 1 from public.hamster_migrationen where datei='$DATEI' and pruefsumme='$SUM'")" = "1" ]; then
      SCHON=$((SCHON+1)); continue
    fi
    printf '      %-46s ' "$DATEI"
    LOG="$(psql_still < "$PFAD" 2>&1)"; RC=$?
    if [ $RC -ne 0 ]; then
      echo "FEHLGESCHLAGEN"
      FEHLER="$DATEI"
      printf '%s\n' "$LOG" | sed 's/^/        /' | tail -20
      break
    fi
    psql_still </dev/null -c "insert into public.hamster_migrationen(datei,pruefsumme)
        values('$DATEI','$SUM')
        on conflict (datei) do update set pruefsumme=excluded.pruefsumme, angewendet_am=now();" >/dev/null 2>&1
    echo "eingespielt"
    NEU=$((NEU+1))
  done < "$LISTE"

  if [ -n "$FEHLER" ]; then
    echo ""
    echo "      ABBRUCH: Die Datenbank-Aenderung '$FEHLER' ist fehlgeschlagen."
    echo "      Es wurde NICHTS Halbfertiges zurueckgelassen: jede Datei laeuft in"
    echo "      einem Rutsch, bei einem Fehler wird sie komplett verworfen."
    zurueck_zur_alten_web_fassung
    echo ""
    echo "      Die Datensicherung von vorhin liegt hier:"
    echo "        $SICHERUNG"
    echo "      Zurueckspielen (nur falls noetig):  sudo bash scripts/restore.sh"
    echo ""
    echo "      Bitte die Fehlermeldung oben weitergeben - dann laesst sich das beheben."
    exit 1
  fi
  echo "      Fertig: $NEU neu eingespielt, $SCHON bereits aktuell."
fi

# --- 5) Anmeldeschutz: Auth-Dienst auf den Hook umstellen -------------------
# Die Sperre nach fuenf Fehlversuchen braucht zwei Umgebungsvariablen im
# Auth-Dienst. Die stehen in docker-compose.override.yml - einer Datei, die
# beim Update BEWUSST nicht ausgetauscht wird (dort koennen eigene Anpassungen
# stehen, z. B. ein anderer Port). Deshalb ergaenzt das Update sie hier selbst,
# aber nur, wenn sie fehlen.
echo "[5/7] Pruefe die Server-Einstellungen ..."
HOOKDATEI="docker-compose.override.yml"
if [ ! -f "$HOOKDATEI" ]; then
  echo "      uebersprungen (keine docker-compose.override.yml)."
elif grep -q "PASSWORD_VERIFICATION_ATTEMPT" "$HOOKDATEI"; then
  echo "      Anmeldeschutz ist bereits eingeschaltet."
elif [ "$(psql_wert "select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='password_verification_attempt'")" = "1" ]; then
  cp "$HOOKDATEI" "$HOOKDATEI.vor-update"
  awk '
    /^services:[[:space:]]*$/ && !getan {
      print
      print "  # Anmeldeschutz: GoTrue meldet jeden Passwortversuch an die Datenbank."
      print "  # Nach fuenf Fehlversuchen sperrt sie das Konto (Phase AC)."
      print "  auth:"
      print "    environment:"
      print "      GOTRUE_HOOK_PASSWORD_VERIFICATION_ATTEMPT_ENABLED: \"true\""
      print "      GOTRUE_HOOK_PASSWORD_VERIFICATION_ATTEMPT_URI: \"pg-functions://postgres/public/password_verification_attempt\""
      print ""
      getan = 1
      next
    }
    { print }
  ' "$HOOKDATEI.vor-update" > "$HOOKDATEI"
  if docker compose config -q 2>/dev/null; then
    echo "      Anmeldeschutz eingeschaltet (Sperre nach 5 Fehlversuchen)."
    docker compose up -d auth >/dev/null 2>&1
  else
    mv "$HOOKDATEI.vor-update" "$HOOKDATEI"
    echo "      WARNUNG: Eintrag passte nicht zur Datei - nichts veraendert."
    echo "               Bitte den auth-Abschnitt von Hand ergaenzen (siehe RELEASE-Datei)."
  fi
else
  echo "      Anmeldeschutz: Datenbankfunktion nicht gefunden - uebersprungen."
fi

# --- 6) Web-Container neu starten -------------------------------------------
echo "[6/7] Starte den Web-Container neu ..."
docker compose restart frontend >/dev/null 2>&1 || docker compose up -d frontend >/dev/null 2>&1

# --- 7) Hilfsskripte auffrischen --------------------------------------------
# scripts/ liegt ausserhalb von hamster-site und wird deshalb nicht mit
# ausgetauscht. Die jeweils aktuellen Fassungen liegen im Repo unter
# hamster-site/docker-skripte/ - von dort werden sie hier uebernommen, damit
# beim naechsten Mal wirklich nur noch EIN Befehl noetig ist.
#
# Wichtig: 'mv' statt 'cp'. Ein laufendes Skript mit 'cp' zu ueberschreiben
# bringt die Shell durcheinander (sie liest die Datei waehrend der Ausfuehrung
# weiter); 'mv' haengt nur den Verzeichniseintrag um, die laufende Fassung
# bleibt unangetastet bestehen.
echo "[7/7] Frische die Hilfsskripte auf ..."
QUELLE="hamster-site/docker-skripte"
if [ -d "$QUELLE" ]; then
  AKT=0
  for DATEI in "$QUELLE"/*.sh; do
    [ -f "$DATEI" ] || continue
    NAME="$(basename "$DATEI")"
    if [ ! -f "scripts/$NAME" ] || ! cmp -s "$DATEI" "scripts/$NAME"; then
      cp "$DATEI" "scripts/.$NAME.neu" && chmod 755 "scripts/.$NAME.neu" \
        && mv -f "scripts/.$NAME.neu" "scripts/$NAME" && AKT=$((AKT+1))
    fi
  done
  [ "$AKT" -gt 0 ] && echo "      $AKT Skript(e) erneuert." || echo "      Alle Skripte sind schon aktuell."
else
  echo "      uebersprungen (keine Skripte im neuen Stand gefunden)."
fi

echo ""
echo "============================================================"
echo " FERTIG. Die neue Fassung ist aktiv - Web-App und Datenbank."
echo ""
echo " Im Browser bitte einmal Strg+F5 druecken (harter Neuladen),"
echo " sonst zeigt er noch die alte Fassung aus dem Zwischenspeicher."
echo "============================================================"
if [ -n "$ALT" ]; then
  echo ""
  echo "Falls etwas nicht stimmt, laesst sich die vorherige Fassung der"
  echo "Web-App so zurueckholen (die Datenbank bleibt dabei, wie sie ist):"
  echo "   rm -rf hamster-site && mv $ALT hamster-site && docker compose restart frontend"
fi
