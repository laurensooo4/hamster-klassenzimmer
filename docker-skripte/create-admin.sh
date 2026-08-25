#!/usr/bin/env bash
# ============================================================================
#  Legt ein LEHRER-Konto MIT Admin-Rechten in der Datenbank an.
#  Fragt interaktiv nach Vorname, Nachname, Benutzername und Passwort.
#
#  Ausfuehren (Stack muss laufen):   bash scripts/create-admin.sh
#  (funktioniert aus hamster-docker/ ODER aus hamster-docker/supabase/docker/)
#
#  Technik: Der Auth-Nutzer wird ueber die GoTrue-Admin-API angelegt (mit dem
#  SERVICE_ROLE_KEY aus der .env – dieser Schluessel bleibt IMMER auf dem Server,
#  nie im Browser). Danach wird das Profil als Lehrkraft + Admin per psql gesetzt.
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

# --- Ordner mit docker-compose.yml + .env finden --------------------------
DOCKER_DIR=""
for d in "$HERE/.." "$HERE/../supabase/docker" "$PWD" "$PWD/supabase/docker"; do
  if [ -f "$d/.env" ] && [ -f "$d/docker-compose.yml" ]; then DOCKER_DIR="$(cd "$d" && pwd)"; break; fi
done
if [ -z "$DOCKER_DIR" ]; then
  echo "FEHLER: Konnte den Ordner mit .env/docker-compose.yml nicht finden."
  echo "        Bitte dieses Skript aus dem entpackten Paket heraus starten (Stack muss eingerichtet sein)."
  exit 1
fi
cd "$DOCKER_DIR"

# --- Voraussetzungen ------------------------------------------------------
command -v curl >/dev/null 2>&1 || { echo "FEHLER: 'curl' wird benoetigt."; exit 1; }
docker compose ps >/dev/null 2>&1 || { echo "FEHLER: 'docker compose' nicht verfuegbar oder Stack nicht eingerichtet."; exit 1; }

SERVICE_ROLE_KEY="$(grep -E '^SERVICE_ROLE_KEY=' .env | head -1 | cut -d= -f2- || true)"
[ -n "$SERVICE_ROLE_KEY" ] || { echo "FEHLER: SERVICE_ROLE_KEY fehlt in der .env."; exit 1; }
KONG_PORT="$(grep -E '^KONG_HTTP_PORT=' .env | head -1 | cut -d= -f2- || true)"; KONG_PORT="${KONG_PORT:-8000}"
EMAIL_DOMAIN="${EMAIL_DOMAIN:-hamster.local}"   # muss zu config.docker.js (EMAIL_DOMAIN) passen
API="http://localhost:${KONG_PORT}"

echo "============================================================"
echo "  Admin-Konto anlegen (Lehrkraft mit Admin-Rechten)"
echo "============================================================"

# --- Eingaben -------------------------------------------------------------
read -r -p "Vorname:      " VORNAME
read -r -p "Nachname:     " NACHNAME
read -r -p "Benutzername: " BENUTZER
BENUTZER="$(printf '%s' "$BENUTZER" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
if ! printf '%s' "$BENUTZER" | grep -qE '^[a-z0-9_.\-]{3,32}$'; then
  echo "FEHLER: Benutzername: 3-32 Zeichen, nur Buchstaben/Ziffern/._-"; exit 1
fi
VORNAME="$(printf '%s' "$VORNAME" | sed 's/^ *//;s/ *$//')"
NACHNAME="$(printf '%s' "$NACHNAME" | sed 's/^ *//;s/ *$//')"
[ -n "$VORNAME" ] && [ -n "$NACHNAME" ] || { echo "FEHLER: Vor- und Nachname duerfen nicht leer sein."; exit 1; }
DISPLAYNAME="$VORNAME $NACHNAME"

read -r -s -p "Passwort (min. 6 Zeichen): " PASS; echo
read -r -s -p "Passwort wiederholen:      " PASS2; echo
[ "$PASS" = "$PASS2" ] || { echo "FEHLER: Passwoerter stimmen nicht ueberein."; exit 1; }
[ "${#PASS}" -ge 6 ] || { echo "FEHLER: Das Passwort muss mindestens 6 Zeichen haben."; exit 1; }
if printf '%s' "$PASS" | LC_ALL=C grep -q '[[:cntrl:]]'; then
  echo "FEHLER: Das Passwort darf keine Steuerzeichen (z. B. Tab) enthalten."; exit 1
fi

EMAIL="${BENUTZER}@${EMAIL_DOMAIN}"

# --- 1) Auth-Nutzer ueber GoTrue-Admin-API anlegen (bestaetigt) -----------
json_escape(){ local s="$1"; s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; printf '%s' "$s"; }
BODY="{\"email\":\"$(json_escape "$EMAIL")\",\"password\":\"$(json_escape "$PASS")\",\"email_confirm\":true}"

echo "Lege Auth-Nutzer an ..."
RESP="$(curl -s -X POST "${API}/auth/v1/admin/users" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "$BODY" || true)"   # '|| true': curl-Verbindungsfehler soll unten sauber gemeldet werden

USER_ID="$(printf '%s' "$RESP" | grep -oE '"id"[[:space:]]*:[[:space:]]*"[0-9a-fA-F-]{36}"' | head -1 | grep -oE '[0-9a-fA-F-]{36}' || true)"

# Wiederanlauf-Fall: Auth-Nutzer existiert schon (z. B. frueherer Teil-Fehlschlag).
# Dann seine ID aus der DB holen, Passwort neu setzen und unten das Profil (neu) schreiben.
if [ -z "$USER_ID" ] && printf '%s' "$RESP" | grep -qiE 'already|exists|registered|duplicate'; then
  echo "Hinweis: Auth-Nutzer existiert bereits - verwende ihn weiter (Passwort wird neu gesetzt) ..."
  USER_ID="$(docker compose exec -T db psql -U postgres -d postgres -tA \
    -c "select id from auth.users where email = '${EMAIL}' limit 1" | tr -d '[:space:]' || true)"
  if [ -n "$USER_ID" ]; then
    curl -s -X PUT "${API}/auth/v1/admin/users/${USER_ID}" \
      -H "apikey: ${SERVICE_ROLE_KEY}" \
      -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"password\":\"$(json_escape "$PASS")\"}" >/dev/null || true
  fi
fi

if [ -z "$USER_ID" ]; then
  echo "FEHLER: Auth-Nutzer konnte nicht angelegt werden."
  if [ -z "$RESP" ]; then
    echo "  Keine Antwort von ${API} - laeuft der Stack? (docker compose up -d, dann erneut versuchen)"
  else
    echo "  Antwort der API: $RESP"
    echo "  (Haeufig: Benutzername bereits vergeben, oder Stack/Kong nicht erreichbar.)"
  fi
  exit 1
fi

# --- 2) Profil als Lehrkraft + Admin setzen (per psql, injektionssicher) --
echo "Setze Profil (Lehrkraft + Admin) ..."
docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v uid="$USER_ID" -v uname="$BENUTZER" -v dname="$DISPLAYNAME" <<'SQL'
insert into public.profiles (id, username, role, display_name, is_admin)
values (:'uid'::uuid, :'uname', 'teacher', :'dname', true)
on conflict (id) do update
  set role         = 'teacher',
      is_admin     = true,
      display_name = excluded.display_name,
      username     = excluded.username;
SQL

echo
echo "============================================================"
echo "  FERTIG – Admin-Konto angelegt:"
echo "    Name:        ${DISPLAYNAME}"
echo "    Benutzer:    ${BENUTZER}"
echo "    Rolle:       Lehrkraft (mit Admin-Rechten)"
echo "  Anmeldung in der App mit Benutzername + Passwort."
echo "============================================================"
