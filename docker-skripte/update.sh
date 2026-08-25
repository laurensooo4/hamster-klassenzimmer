#!/usr/bin/env bash
# ============================================================================
#  Plattform aktualisieren (neue Version der Web-App einspielen)
# ----------------------------------------------------------------------------
#  Holt den aktuellen Stand der Web-App von GitHub, tauscht die Dateien aus und
#  startet den Web-Container neu. Die Datenbank bleibt dabei unangetastet -
#  Konten, Klassen, Aufgaben und Abgaben bleiben also erhalten.
#
#  AUFRUF (aus dem Ordner supabase/docker):
#      bash scripts/update.sh
#
#  Ohne Internet auf dem Server? Dann die neuen Dateien von Hand nach
#  hamster-site/ kopieren und  docker compose restart frontend  ausfuehren.
# ============================================================================
set -uo pipefail

REPO="${REPO:-https://github.com/laurensooo4/hamster-klassenzimmer}"

cd "$(dirname "$0")/.." || { echo "FEHLER: Ordner nicht gefunden."; exit 1; }
[ -f docker-compose.yml ] || { echo "FEHLER: Bitte aus dem Ordner supabase/docker starten."; exit 1; }
command -v git >/dev/null 2>&1 || { echo "FEHLER: 'git' ist nicht installiert."; exit 1; }

echo "=== Update der Web-App ==="
echo "Quelle: $REPO"
echo ""

# --- 1) Sicherheitsnetz: vorher sichern -------------------------------------
echo "[1/4] Lege vorher ein Backup an ..."
if bash scripts/backup.sh >/dev/null 2>&1; then
  echo "      OK ($(ls -1t backups/hamster-db_*.sql.gz 2>/dev/null | head -1))"
else
  echo "      WARNUNG: Backup fehlgeschlagen."
  printf "      Trotzdem aktualisieren? (j/N): "
  read -r W; case "$W" in [jJ]*) ;; *) echo "Abgebrochen."; exit 1;; esac
fi

# --- 2) Neuen Stand holen ----------------------------------------------------
echo "[2/4] Hole den aktuellen Stand ..."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if ! git clone --depth 1 "$REPO" "$TMP/neu" >/dev/null 2>&1; then
  echo "FEHLER: Konnte das Repository nicht laden. Internet auf dem Server vorhanden?"
  exit 1
fi
VERSION="$(grep -oE 'APP_BUILD = "[^"]+"' "$TMP/neu/app.js" 2>/dev/null | head -1 | cut -d'"' -f2)"
[ -n "$VERSION" ] && echo "      Neuer Stand: $VERSION"

# --- 3) Dateien austauschen --------------------------------------------------
# WICHTIG: config.js wird NICHT uebernommen - der Container blendet ohnehin
# frontend/config.docker.js darueber (Login-only, eigener ANON_KEY).
echo "[3/4] Tausche die Web-Dateien aus ..."
ALT="hamster-site.alt-$(date +%Y-%m-%d_%H%M)"
mv hamster-site "$ALT" || { echo "FEHLER: hamster-site liess sich nicht umbenennen."; exit 1; }
rm -rf "$TMP/neu/.git"
cp -r "$TMP/neu" hamster-site
# Server-Konfiguration aus der alten Installation uebernehmen, falls vorhanden
[ -f "$ALT/config.js" ] && cp "$ALT/config.js" hamster-site/config.js 2>/dev/null
echo "      Vorherige Fassung liegt in: $ALT"

# --- 3b) Anmeldeschutz: Auth-Dienst auf den Hook umstellen -------------------
# Die Sperre nach fuenf Fehlversuchen braucht zwei Umgebungsvariablen im
# Auth-Dienst. Die stehen in docker-compose.override.yml - einer Datei, die
# beim Update BEWUSST nicht ausgetauscht wird (dort koennen eigene Anpassungen
# stehen, z. B. ein anderer Port). Deshalb ergaenzt das Update sie hier selbst,
# aber nur, wenn sie fehlen. Ohne die Datenbankfunktion aus Phase AC bliebe der
# Hook wirkungslos, deshalb wird zuerst geprueft, ob es sie schon gibt.
HOOKDATEI="docker-compose.override.yml"
if [ -f "$HOOKDATEI" ] && ! grep -q "PASSWORD_VERIFICATION_ATTEMPT" "$HOOKDATEI"; then
  if docker compose exec -T db psql -U supabase_admin -d postgres -tAc \
       "select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='password_verification_attempt'" \
       </dev/null 2>/dev/null | grep -q 1; then
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
      echo "[3b] Anmeldeschutz eingeschaltet (Sperre nach 5 Fehlversuchen)."
      docker compose up -d auth >/dev/null 2>&1
    else
      mv "$HOOKDATEI.vor-update" "$HOOKDATEI"
      echo "[3b] WARNUNG: Eintrag passte nicht zur Datei - nichts veraendert."
      echo "     Bitte den auth-Abschnitt von Hand ergaenzen (siehe RELEASE-Datei)."
    fi
  else
    echo "[3b] Anmeldeschutz uebersprungen: schema_update_phaseAC_anmeldeschutz.sql"
    echo "     ist noch nicht eingespielt. Danach dieses Update einfach erneut starten."
  fi
fi

# --- 4) Web-Container neu starten -------------------------------------------
echo "[4/4] Starte den Web-Container neu ..."
docker compose restart frontend >/dev/null 2>&1 || docker compose up -d frontend >/dev/null 2>&1

echo ""
echo "============================================================"
echo " FERTIG. Die neue Fassung ist aktiv."
echo ""
echo " Im Browser bitte einmal Strg+F5 druecken (harter Neuladen),"
echo " sonst zeigt er noch die alte Fassung aus dem Zwischenspeicher."
echo "============================================================"
echo ""
echo "Falls etwas nicht stimmt, laesst sich die vorherige Fassung"
echo "so zurueckholen:"
echo "   rm -rf hamster-site && mv $ALT hamster-site && docker compose restart frontend"
echo ""
echo "HINWEIS: Bringt eine Version Aenderungen an der Datenbank mit, steht das"
echo "         in den Patch-Notes. Das komplette Schema laesst sich gefahrlos"
echo "         erneut einspielen (es ist wiederholbar aufgebaut):"
echo "         bash scripts/import-schema.sh"
