#!/usr/bin/env bash
# ============================================================================
#  Rundum-Setup fuer die Lern-Plattform "Informatik am Gymnasium Wesermuende"
#  -> Holt Supabase, konfiguriert alles sicher, startet alle Container und
#     spielt das Datenbank-Schema ein. EIN Befehl:   bash setup.sh
#
#  Voraussetzungen: Docker + Docker Compose v2, git, openssl, Internet (einmalig).
#  ACHTUNG: Richtet die Datenbank FRISCH ein (Reset). Vorhandene Daten im
#           Docker-Volume gehen dabei verloren (fuer Erstinstallation gedacht).
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SUPA="$HERE/supabase/docker"

# Portables In-Place-sed (funktioniert unter macOS/BSD UND Linux/GNU):
#   sedi <sed-ausdruck> <datei>
sedi(){ sed "$1" "$2" > "$2.tmp" && mv "$2.tmp" "$2"; }

# --- Haertungs-Einstellungen laden (alle Werte optional) --------------------
TRUSTED_PROXY=""; BIND_FRONTEND=""; BACKUP_AGE_RECIPIENT=""; EGRESS_AUSNAHMEN=""
# shellcheck source=/dev/null
if [ -f "$HERE/hardening.conf" ]; then
  if ! . "$HERE/hardening.conf"; then
    echo "FEHLER: hardening.conf ist fehlerhaft."
    echo "Bitte pruefen: KEINE Leerzeichen um das = und Werte in Anfuehrungszeichen."
    echo '  Richtig:  TRUSTED_PROXY="10.0.0.5"'
    echo '  Falsch:   TRUSTED_PROXY = 10.0.0.5'
    exit 1
  fi
fi

echo "============================================================"
echo "  Setup: Lern-Plattform (Supabase + Web-App) via Docker"
echo "============================================================"

# --- 0) Voraussetzungen pruefen -------------------------------------------
for c in docker git openssl; do
  command -v "$c" >/dev/null 2>&1 || { echo "FEHLER: '$c' ist nicht installiert. Bitte installieren und erneut ausfuehren."; exit 1; }
done
docker compose version >/dev/null 2>&1 || { echo "FEHLER: 'docker compose' (Compose v2) fehlt."; exit 1; }
docker info >/dev/null 2>&1 || { echo "FEHLER: Docker laeuft nicht / keine Rechte. Docker starten (ggf. Nutzer zur docker-Gruppe hinzufuegen)."; exit 1; }

# --- 1) Offizielle Supabase-Docker-Vorlage holen --------------------------
if [ ! -f "$SUPA/docker-compose.yml" ]; then
  echo "[1/6] Hole offizielle Supabase-Docker-Vorlage (git clone) ..."
  rm -rf "$HERE/supabase"
  git clone --depth 1 https://github.com/supabase/supabase "$HERE/supabase"
else
  echo "[1/6] Supabase-Vorlage bereits vorhanden."
fi

# --- 2) Unsere Dateien hineinkopieren -------------------------------------
echo "[2/6] Kopiere Plattform-Dateien in supabase/docker ..."
mkdir -p "$SUPA/frontend" "$SUPA/init" "$SUPA/scripts"
cp "$HERE/docker-compose.override.yml" "$SUPA/"
cp "$HERE/frontend/nginx.conf"          "$SUPA/frontend/"
cp "$HERE/init/hamster-schema-komplett.sql" "$SUPA/init/"
cp "$HERE/scripts/import-schema.sh" "$HERE/scripts/diagnose.sh" "$HERE/scripts/create-admin.sh" \
   "$HERE/scripts/backup.sh" "$HERE/scripts/restore.sh" "$HERE/scripts/update.sh" \
   "$HERE/scripts/harden.sh" "$HERE/scripts/check-security.sh" \
   "$HERE/scripts/harden-existing.sh" "$SUPA/scripts/"
[ -f "$HERE/hardening.conf" ] && cp "$HERE/hardening.conf" "$SUPA/hardening.conf"
rm -rf "$SUPA/hamster-site"
cp -r "$HERE/hamster-site" "$SUPA/hamster-site"

# --- 2b) Namen des API-Gateways aus der Vorlage ermitteln -----------------
# Supabase hat den Gateway von Kong auf Envoy umgestellt: der Dienst heisst in
# neueren Fassungen "api-gw", in aelteren "kong". Unser Frontend-Container
# verweist per depends_on darauf und nginx reicht /supabase dorthin weiter -
# passt der Name nicht, bricht Compose mit
#   service "frontend" depends on undefined service "kong"
# ab. Deshalb lesen wir den tatsaechlichen Namen aus der geklonten Vorlage.
GW=""
for cand in kong api-gw; do
  if grep -qE "^  ${cand}:" "$SUPA/docker-compose.yml"; then GW="$cand"; break; fi
done
if [ -n "$GW" ]; then
  echo "      API-Gateway der Vorlage: $GW"
  for alt in kong api-gw; do
    sedi "s|^\([[:space:]]*\)- ${alt}[[:space:]]*$|\1- ${GW}|" "$SUPA/docker-compose.override.yml"
    sedi "s|http://${alt}:8000|http://${GW}:8000|g"            "$SUPA/frontend/nginx.conf"
  done
else
  echo "      WARNUNG: Kein bekannter Gateway-Dienst (kong/api-gw) in der Vorlage gefunden."
  echo "               depends_on wird entfernt; nginx behaelt das bisherige Ziel."
  sedi "/^[[:space:]]*depends_on:[[:space:]]*$/d" "$SUPA/docker-compose.override.yml"
  sedi "/^[[:space:]]*- kong[[:space:]]*$/d"      "$SUPA/docker-compose.override.yml"
  sedi "/^[[:space:]]*- api-gw[[:space:]]*$/d"    "$SUPA/docker-compose.override.yml"
fi

# --- 2c) HAERTUNG: Gateway und Datenbank nur noch an localhost binden ------
# Im Auslieferungszustand veroeffentlicht Supabase das API-Gateway (Port 8000,
# enthaelt die Studio-Administrationsoberflaeche!) und den Datenbank-Pooler
# (5432/6543) auf ALLEN Netzwerk-Schnittstellen. Jedes Geraet im Schulnetz
# koennte sie erreichen; eine ufw-Regel hilft dagegen NICHT, weil Docker eigene
# iptables-Regeln davorsetzt. Wir binden sie deshalb an 127.0.0.1.
# Zugriff auf Studio danach nur noch per SSH-Tunnel:
#     ssh -L 8000:localhost:8000 administrator@<server>   -> http://localhost:8000
# Die sed-Ausdruecke greifen nur, solange die Zeile mit "- ${" beginnt - ein
# zweiter Lauf veraendert also nichts (idempotent).
echo "[2b] Haertung: Gateway und Datenbank an localhost binden ..."
for V in API_GW_HTTP_PORT KONG_HTTP_PORT API_GW_HTTPS_PORT KONG_HTTPS_PORT POSTGRES_PORT POOLER_PROXY_PORT_TRANSACTION; do
  sedi 's|^\([[:space:]]*\)- \(\${'"$V"'\)|\1- 127.0.0.1:\2|' "$SUPA/docker-compose.yml"
done
OFFEN="$(grep -cE '^[[:space:]]*- \$\{(API_GW_HTTP_PORT|KONG_HTTP_PORT|API_GW_HTTPS_PORT|KONG_HTTPS_PORT|POSTGRES_PORT|POOLER_PROXY_PORT_TRANSACTION)' "$SUPA/docker-compose.yml" || true)"
if [ "${OFFEN:-0}" -gt 0 ]; then
  echo "      WARNUNG: $OFFEN Port-Zeile(n) konnten nicht umgestellt werden."
  echo "               Bitte nach dem Setup 'bash scripts/check-security.sh' ausfuehren."
else
  echo "      OK - 8000/5432/6543 sind jetzt nur noch lokal erreichbar."
fi

# --- 2d) Web-App-Port binden (nur wenn in hardening.conf gewuenscht) -------
if [ -n "${BIND_FRONTEND:-}" ]; then
  sedi 's|^\([[:space:]]*\)- "8080:80"|\1- "'"$BIND_FRONTEND"':8080:80"|' "$SUPA/docker-compose.override.yml"
  echo "      Web-App an ${BIND_FRONTEND}:8080 gebunden."
fi

# --- 2e) Vertrauenswuerdigen Reverse-Proxy in nginx eintragen --------------
# Ohne diesen Eintrag sieht der Frontend-nginx nur die IP des vorgelagerten
# Proxys - dann zaehlt das Rate-Limit alle Nutzer als eine einzige Person.
if [ -n "${TRUSTED_PROXY:-}" ]; then
  case "$TRUSTED_PROXY" in
    *[!0-9./:a-fA-F]*)
      echo "FEHLER: TRUSTED_PROXY darf nur EINE IP oder EIN Netz enthalten."
      echo "        Richtig: TRUSTED_PROXY=\"10.0.0.5\"  oder  \"10.0.0.0/24\""
      exit 1 ;;
  esac
  # Alles in EINE Zeile (nginx erlaubt mehrere Direktiven je Zeile) - ein "\n"
  # im Ersetzungstext funktioniert mit BSD-sed nicht.
  sedi 's|^\([[:space:]]*\)#TRUSTED_PROXY_PLATZHALTER|\1set_real_ip_from '"$TRUSTED_PROXY"'; real_ip_header X-Forwarded-For; real_ip_recursive on;|' "$SUPA/frontend/nginx.conf"
  echo "      Vertrauenswuerdiger Proxy eingetragen: $TRUSTED_PROXY"
else
  echo "      HINWEIS: TRUSTED_PROXY ist nicht gesetzt (hardening.conf)."
  echo "               Solange kein Proxy davorsteht, ist das richtig."
fi

# --- 3) .env erzeugen (sicheres, alphanumerisches Passwort) ---------------
echo "[3/6] Schreibe .env (sichere Rezeptur) ..."
cd "$SUPA"
cp .env.example .env
# WICHTIG: Die offizielle .env setzt COMPOSE_FILE=docker-compose.yml -> das schaltet das
# automatische Laden von docker-compose.override.yml AB. Wir haengen unsere Override an,
# damit 'docker compose up/ps/down' den Frontend-Container immer mitnimmt.
if grep -q "^COMPOSE_FILE=" .env; then
  CUR="$(grep "^COMPOSE_FILE=" .env | head -1 | cut -d= -f2-)"
  case ":${CUR}:" in
    *":docker-compose.override.yml:"*) : ;;                                   # schon drin
    *) sedi "s|^COMPOSE_FILE=.*|COMPOSE_FILE=${CUR}:docker-compose.override.yml|" .env ;;
  esac
else
  printf '\nCOMPOSE_FILE=docker-compose.yml:docker-compose.override.yml\n' >> .env
fi
PGPW="$(openssl rand -hex 24)"     # 48 Zeichen 0-9a-f = alphanumerisch, KEINE Sonderzeichen
DASHPW="$(openssl rand -hex 8)"
sedi "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PGPW}|" .env
sedi "s|^DASHBOARD_PASSWORD=.*|DASHBOARD_PASSWORD=${DASHPW}|" .env
if grep -q "^ENABLE_EMAIL_AUTOCONFIRM=" .env; then
  sedi "s|^ENABLE_EMAIL_AUTOCONFIRM=.*|ENABLE_EMAIL_AUTOCONFIRM=true|" .env
else
  printf '\nENABLE_EMAIL_AUTOCONFIRM=true\n' >> .env
fi

# --- WICHTIG (Schulserver): EIGENE, einmalige Schluessel statt der oeffentlich
#     bekannten Supabase-Demo-Schluessel. JWT_SECRET wird frisch erzeugt und
#     ANON_KEY / SERVICE_ROLE_KEY werden PASSEND dazu signiert (HMAC-SHA256).
#     Nur so ist die Datenbank-API gegen Fremde abgesichert, sobald der Server
#     spaeter z. B. ueber inf.gywem.de erreichbar ist.
b64url(){ openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt_for_role(){
  # $1 = Rolle (anon | service_role), $2 = JWT_SECRET
  local role="$1" secret="$2" now exp h p s
  now="$(date +%s)"; exp=$((now + 315360000))   # gueltig ~10 Jahre
  h="$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)"
  p="$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' "$role" "$now" "$exp" | b64url)"
  s="$(printf '%s.%s' "$h" "$p" | openssl dgst -sha256 -hmac "$secret" -binary | b64url)"
  printf '%s.%s.%s' "$h" "$p" "$s"
}
JWTSECRET="$(openssl rand -hex 32)"                       # 64 Zeichen
ANONKEY="$(jwt_for_role anon "$JWTSECRET")"
SERVICEKEY="$(jwt_for_role service_role "$JWTSECRET")"
sedi "s|^JWT_SECRET=.*|JWT_SECRET=${JWTSECRET}|" .env
sedi "s|^ANON_KEY=.*|ANON_KEY=${ANONKEY}|" .env
sedi "s|^SERVICE_ROLE_KEY=.*|SERVICE_ROLE_KEY=${SERVICEKEY}|" .env
# Weitere Geheimnisse mit fester Laenge (nur ersetzen, wenn der Schluessel existiert):
regen(){ if grep -q "^$1=" .env; then sedi "s|^$1=.*|$1=$2|" .env; fi }
regen SECRET_KEY_BASE     "$(openssl rand -hex 32)"       # 64 Zeichen
regen VAULT_ENC_KEY       "$(openssl rand -hex 16)"       # exakt 32 Zeichen
regen REALTIME_DB_ENC_KEY "$(openssl rand -hex 8)"        # exakt 16 Zeichen

# --- 4) config.js der Web-App mit ANON_KEY fuellen ------------------------
echo "[4/6] Setze ANON_KEY in die Web-App-Konfiguration ..."
ANON="$(grep -E '^ANON_KEY=' .env | head -1 | cut -d= -f2-)"
sed "s|__ANON_KEY__|${ANON}|" "$HERE/frontend/config.docker.js" > "$SUPA/frontend/config.docker.js"

# --- 4b) Dateirechte: .env enthaelt alle Geheimnisse -----------------------
chmod 600 .env 2>/dev/null || true
chmod 700 "$SUPA/scripts" 2>/dev/null || true

# --- 4c) Konfiguration pruefen, BEVOR etwas gestartet wird ------------------
# Faengt Tippfehler in unseren Aenderungen ab, statt sie beim Start zu
# entdecken - und verhindert, dass eine halb gestartete Anlage zurueckbleibt.
echo "      Pruefe die Compose-Konfiguration ..."
if ! docker compose config -q 2>/tmp/composecheck.txt; then
  echo "FEHLER: Die Docker-Konfiguration ist fehlerhaft. Es wurde nichts gestartet."
  echo "----------------------------------------------------------------"
  tail -20 /tmp/composecheck.txt
  echo "----------------------------------------------------------------"
  echo "Bitte diese Ausgabe schicken. LOESCHT NICHTS - in supabase/docker liegen"
  echo "eure Schluessel (.env) und die Sicherungen (backups/)."
  exit 1
fi

# --- 4d) SCHUTZ: laeuft hier schon eine Anlage mit echten Daten? -----------
# setup.sh ist NUR fuer die Erstinstallation. Der naechste Schritt loescht die
# Datenbank. Ohne diese Sperre wuerde ein zweiter Lauf - etwa um die Haertung
# nachzuziehen - alle Konten, Klassen und Abgaben vernichten.
# Nur auf DIESES Compose-Projekt schauen - eine globale Volume-Suche wuerde
# auch fremde Docker-Volumes treffen und bei einer frischen Installation
# faelschlich nachfragen.
BESTAND=0
docker compose ps -aq 2>/dev/null | grep -q . && BESTAND=1
[ -d ./volumes/db/data ] && BESTAND=1
if [ "$BESTAND" = "1" ]; then
  echo
  echo "============================================================"
  echo "  STOPP - hier laeuft bereits eine Installation."
  echo "------------------------------------------------------------"
  echo "  setup.sh richtet die Datenbank FRISCH ein und wuerde dabei"
  echo "  ALLE Konten, Klassen, Aufgaben und Abgaben LOESCHEN."
  echo
  echo "  Du willst vermutlich etwas anderes:"
  echo "    - Neue Programmversion einspielen : bash scripts/update.sh"
  echo "    - Sicherheits-Haertung nachziehen : bash scripts/harden-existing.sh"
  echo "    - Sicherung anlegen               : bash scripts/backup.sh"
  echo
  echo "  Nur wenn du die Datenbank WIRKLICH loeschen willst:"
  echo "  Tippe GENAU  LOESCHEN  und Enter. Alles andere bricht ab."
  echo "============================================================"
  printf "> "
  read -r BESTAETIGUNG || BESTAETIGUNG=""
  if [ "$BESTAETIGUNG" != "LOESCHEN" ]; then
    echo "Abgebrochen - es wurde NICHTS veraendert. Gut so."
    exit 0
  fi
  echo "  Lege vorher noch eine Sicherung an ..."
  bash "$SUPA/scripts/backup.sh" >/dev/null 2>&1 && echo "  OK - liegt in supabase/docker/backups/" \
    || echo "  WARNUNG: Sicherung fehlgeschlagen (evtl. laeuft die Datenbank nicht)."
fi

# --- 5) Container starten (Datenbank frisch) ------------------------------
echo "[5/6] Starte Container ... (beim ersten Mal laedt Docker viele Images - das dauert)"
# Reihenfolge bewusst: ZUERST die Images holen. Scheitert das (kein Netz,
# Docker-Hub-Limit, Schulproxy), bricht das Skript ab, OHNE vorher die
# Datenbank geloescht zu haben.
# nginx-Konfiguration in einem Wegwerf-Container pruefen - ein Tippfehler
# darin wuerde sonst erst beim Start auffallen (Container startet gar nicht).
# --add-host: Der Pruefcontainer haengt NICHT im Compose-Netz - dort gibt es den
# Gateway-Namen nicht. Ohne diese Zuordnung scheitert nginx -t mit
# "host not found in upstream", obwohl die Konfiguration in Ordnung ist.
if ! docker run --rm --add-host kong:127.0.0.1 --add-host api-gw:127.0.0.1 \
     -v "$SUPA/frontend/nginx.conf":/etc/nginx/conf.d/default.conf:ro \
     nginx:alpine nginx -t >/tmp/nginxpruef.txt 2>&1; then
  echo "FEHLER: frontend/nginx.conf ist fehlerhaft - es wurde nichts gestartet:"
  tail -10 /tmp/nginxpruef.txt
  exit 1
fi
docker compose pull
docker compose down -v >/dev/null 2>&1 || true
docker compose up -d

echo "      Warte auf die Datenbank ..."
ready=0
for i in $(seq 1 80); do
  if docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 3
done
if [ "$ready" -ne 1 ]; then
  echo "WARNUNG: Datenbank nicht rechtzeitig bereit. Bitte 'bash scripts/diagnose.sh' pruefen."
fi
sleep 12   # Rollen/Schemas fertig initialisieren lassen

# --- 6) Datenbank-Schema einspielen (per psql, umgeht den Studio-Editor) --
echo "[6/6] Spiele Datenbank-Schema ein ..."
ok=0
for attempt in 1 2 3; do
  if cat init/hamster-schema-komplett.sql | docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1; then ok=1; break; fi
  echo "     Versuch ${attempt} noch nicht erfolgreich (DB evtl. noch nicht fertig) - warte und probiere erneut ..."
  sleep 12
done
if [ "$ok" -ne 1 ]; then
  echo "FEHLER: Schema-Import fehlgeschlagen. Bitte 'cd supabase/docker && bash scripts/diagnose.sh > diagnose.txt' ausfuehren und die Datei schicken."
  exit 1
fi

# --- 6b) Optional: erstes Admin-Konto (Lehrkraft mit Admin-Rechten) anlegen
if [ -t 0 ]; then
  echo
  read -r -p "Jetzt ein Admin-Konto (Lehrkraft mit Admin-Rechten) anlegen? [J/n] " ADMANS || ADMANS="n"   # Strg-D bricht nur die Frage ab, nicht das Setup
  case "${ADMANS:-J}" in
    [nN]*) echo "  Uebersprungen. Spaeter: cd supabase/docker && bash scripts/create-admin.sh" ;;
    *)     bash "$SUPA/scripts/create-admin.sh" || echo "  (Admin-Anlage abgebrochen – spaeter erneut mit: bash scripts/create-admin.sh)" ;;
  esac
fi

# --- Fertig ---------------------------------------------------------------
IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"               # '|| true': BSD-hostname (macOS) kennt -I nicht
[ -z "${IP:-}" ] && IP="$(ipconfig getifaddr en0 2>/dev/null || true)"   # macOS-Fallback
echo
echo "============================================================"
echo "  FERTIG - die Plattform laeuft!"
echo "------------------------------------------------------------"
echo "  App im Browser:    http://localhost:8080"
[ -n "${IP:-}" ] && echo "  Im Netzwerk:       http://${IP}:8080"
echo "  Supabase-Studio:   http://localhost:8000"
echo "     Benutzer:  $(grep -E '^DASHBOARD_USERNAME=' .env | cut -d= -f2-)"
echo "     Passwort:  ${DASHPW}"
echo "------------------------------------------------------------"
echo "  Status:   cd supabase/docker && docker compose ps"
echo "  Stoppen:  cd supabase/docker && docker compose down"
echo "  Starten:  cd supabase/docker && docker compose up -d"
echo "------------------------------------------------------------"
echo "  NOCH ZU TUN: naechtliches Backup einrichten (5 Minuten)"
echo "     crontab -e   und diese Zeile einfuegen:"
echo "     30 2 * * * cd $SUPA && bash scripts/backup.sh >> backups/backup.log 2>&1"
echo "     Sofort testen:  cd supabase/docker && bash scripts/backup.sh"
echo "============================================================"
