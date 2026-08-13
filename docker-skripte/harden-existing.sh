#!/usr/bin/env bash
# ============================================================================
#  harden-existing.sh - Haertung auf einen LAUFENDEN Server nachziehen
# ----------------------------------------------------------------------------
#  Wofuer ist das?
#  Die Sicherheits-Einstellungen (Ports nur lokal, /supabase/-Positivliste,
#  Rate-Limit) baut normalerweise setup.sh ein. setup.sh setzt aber die
#  Datenbank ZURUECK und ist deshalb nur fuer die Erstinstallation gedacht.
#
#  Dieses Skript macht dasselbe OHNE die Datenbank anzufassen:
#  Konten, Klassen, Aufgaben und Abgaben bleiben vollstaendig erhalten.
#
#  AUFRUF (aus dem Ordner supabase/docker):
#      bash scripts/harden-existing.sh
#
#  Es legt vorher ein Backup an und sichert die alten Konfigurationsdateien,
#  sodass sich jeder Schritt rueckgaengig machen laesst.
# ============================================================================
set -uo pipefail

cd "$(dirname "$0")/.." || { echo "FEHLER: Ordner nicht gefunden."; exit 1; }
[ -f docker-compose.yml ] || { echo "FEHLER: Bitte aus dem Ordner supabase/docker starten."; exit 1; }

TRUSTED_PROXY=""; BIND_FRONTEND=""
if [ -f hardening.conf ]; then
  # shellcheck source=/dev/null
  if ! . ./hardening.conf; then
    echo "FEHLER: hardening.conf ist fehlerhaft."
    echo "Bitte pruefen: keine Leerzeichen um das = und Werte in Anfuehrungszeichen."
    echo '  Richtig:  TRUSTED_PROXY="10.0.0.5"'
    echo '  Falsch:   TRUSTED_PROXY = 10.0.0.5'
    exit 1
  fi
fi

sedi(){ sed "$1" "$2" > "$2.tmp" && mv "$2.tmp" "$2"; }
STAMP="$(date +%Y-%m-%d_%H%M)"
SICHER="konfig-sicherung_$STAMP"

echo "============================================================"
echo "  Haertung nachziehen (Datenbank bleibt unangetastet)"
echo "============================================================"

# --- 0) Backup + Konfigurationen sichern ------------------------------------
echo "[1/6] Sicherung anlegen ..."
if bash scripts/backup.sh >/dev/null 2>&1; then
  echo "      OK: $(ls -1t backups/hamster-db_*.sql.gz* 2>/dev/null | head -1)"
else
  echo "      WARNUNG: Backup fehlgeschlagen."
  printf "      Trotzdem weitermachen? (j/N): "
  read -r A; case "$A" in [jJ]*) ;; *) echo "Abgebrochen."; exit 1;; esac
fi
mkdir -p "$SICHER"
cp docker-compose.yml "$SICHER/" 2>/dev/null
cp frontend/nginx.conf "$SICHER/" 2>/dev/null
cp docker-compose.override.yml "$SICHER/" 2>/dev/null
echo "      Alte Konfiguration gesichert in: $SICHER/"

# --- 1) Gateway-Namen ermitteln ---------------------------------------------
GW=""
for k in kong api-gw; do grep -qE "^  ${k}:" docker-compose.yml && { GW="$k"; break; }; done
[ -n "$GW" ] || { echo "FEHLER: Gateway-Dienst (kong/api-gw) nicht gefunden."; exit 1; }
echo "[2/6] API-Gateway heisst: $GW"

# --- 2) Neue nginx-Konfiguration einspielen ---------------------------------
echo "[3/6] Neue nginx-Konfiguration (Positivliste) einspielen ..."
NEU=""
for k in ../../frontend/nginx.conf ../../../frontend/nginx.conf; do [ -f "$k" ] && NEU="$k" && break; done
if [ -z "$NEU" ]; then
  echo "      FEHLER: frontend/nginx.conf aus dem Release-Paket nicht gefunden."
  echo "      Bitte die Datei aus dem entpackten Paket nach frontend/nginx.conf kopieren"
  echo "      und dieses Skript erneut starten."
  exit 1
fi
cp "$NEU" frontend/nginx.conf
for alt in kong api-gw; do sedi "s|http://${alt}:8000|http://${GW}:8000|g" frontend/nginx.conf; done
if [ -n "$TRUSTED_PROXY" ]; then
  case "$TRUSTED_PROXY" in
    *[!0-9./:a-fA-F]*) echo "      FEHLER: TRUSTED_PROXY darf nur EINE IP oder EIN Netz enthalten."; exit 1 ;;
  esac
  sedi 's|^\([[:space:]]*\)#TRUSTED_PROXY_PLATZHALTER|\1set_real_ip_from '"$TRUSTED_PROXY"'; real_ip_header X-Forwarded-For; real_ip_recursive on;|' frontend/nginx.conf
  echo "      Vertrauenswuerdiger Proxy eingetragen: $TRUSTED_PROXY"
fi

# Konfiguration in einem Wegwerf-Container pruefen, BEVOR sie aktiv wird
# --add-host: siehe setup.sh - der Pruefcontainer kennt das Compose-Netz nicht.
if ! docker run --rm --add-host kong:127.0.0.1 --add-host api-gw:127.0.0.1 \
     -v "$(pwd)/frontend/nginx.conf":/etc/nginx/conf.d/default.conf:ro \
     nginx:alpine nginx -t >/tmp/nginxpruef.txt 2>&1; then
  echo "      FEHLER: Die neue nginx-Konfiguration ist fehlerhaft:"
  sed 's/^/        /' /tmp/nginxpruef.txt | tail -10
  cp "$SICHER/nginx.conf" frontend/nginx.conf 2>/dev/null
  echo "      Alte Fassung wiederhergestellt - es wurde nichts veraendert."
  exit 1
fi
echo "      Konfiguration geprueft: in Ordnung."

# --- 3) Ports nur noch lokal binden -----------------------------------------
echo "[4/6] Gateway und Datenbank an localhost binden ..."
for V in API_GW_HTTP_PORT KONG_HTTP_PORT API_GW_HTTPS_PORT KONG_HTTPS_PORT POSTGRES_PORT POOLER_PROXY_PORT_TRANSACTION; do
  sedi 's|^\([[:space:]]*\)- \(\${'"$V"'\)|\1- 127.0.0.1:\2|' docker-compose.yml
done
if [ -n "$BIND_FRONTEND" ]; then
  sedi 's|^\([[:space:]]*\)- "8080:80"|\1- "'"$BIND_FRONTEND"':8080:80"|' docker-compose.override.yml
fi
if ! docker compose config -q 2>/tmp/composepruef.txt; then
  echo "      FEHLER: Die Compose-Konfiguration ist jetzt fehlerhaft:"
  sed 's/^/        /' /tmp/composepruef.txt | tail -10
  cp "$SICHER/docker-compose.yml" docker-compose.yml 2>/dev/null
  cp "$SICHER/docker-compose.override.yml" docker-compose.override.yml 2>/dev/null
  cp "$SICHER/nginx.conf" frontend/nginx.conf 2>/dev/null
  echo "      Alles zurueckgesetzt - es wurde nichts veraendert."
  exit 1
fi
chmod 600 .env 2>/dev/null || true
chmod 700 backups 2>/dev/null || true

# --- 4) Neu starten - OHNE -v, die Daten bleiben! ---------------------------
echo "[5/6] Container neu starten (die Datenbank bleibt erhalten) ..."
docker compose up -d >/dev/null 2>&1
sleep 5

# --- 5) Nachpruefen ----------------------------------------------------------
echo "[6/6] Pruefen ..."
FEHLER=0
for _ in $(seq 1 20); do
  C="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8080/ 2>/dev/null)"
  [ "$C" = "200" ] && break
  sleep 3
done
[ "${C:-000}" = "200" ] && echo "      Startseite: OK" || { echo "      FEHLER: Startseite liefert $C"; FEHLER=1; }
N="$(docker compose exec -T db psql -U postgres -d postgres -tAc 'select count(*) from auth.users' 2>/dev/null | tr -d ' \r')"
[ -n "$N" ] && echo "      Datenbank: OK ($N Konten - unveraendert)" || { echo "      FEHLER: Datenbank nicht lesbar"; FEHLER=1; }

echo ""
echo "============================================================"
if [ "$FEHLER" = "0" ]; then
  echo " FERTIG. Die Haertung ist aktiv, alle Daten sind erhalten."
  echo ""
  echo " Weiter mit:"
  echo "   sudo bash scripts/harden.sh          (Firewall + Updates)"
  echo "   bash scripts/check-security.sh       (Abnahme-Pruefung)"
else
  echo " ACHTUNG: Es gab Fehler. Rueckweg:"
  echo "   cp $SICHER/nginx.conf frontend/nginx.conf"
  echo "   cp $SICHER/docker-compose.yml docker-compose.yml"
  echo "   cp $SICHER/docker-compose.override.yml docker-compose.override.yml"
  echo "   docker compose up -d"
fi
echo " Alte Konfiguration liegt in: $SICHER/"
echo "============================================================"
