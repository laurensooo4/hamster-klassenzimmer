#!/usr/bin/env bash
# Sammelt Status + Logs der Supabase-Container zur Fehlersuche.
# Ausfuehren im Ordner supabase/docker:   bash scripts/diagnose.sh > diagnose.txt
# (Passwoerter/Schluessel werden NICHT im Klartext ausgegeben.)

echo "===================== docker compose ps ====================="
docker compose ps

for s in db rest realtime meta auth kong storage studio; do
  echo
  echo "===================== letzte 40 Zeilen: $s ====================="
  docker compose logs --tail=40 "$s" 2>&1 || echo "(Dienst $s nicht gefunden)"
done

echo
echo "===================== POSTGRES_PASSWORD-Check ====================="
if [ -f .env ]; then
  PW=$(grep -E "^POSTGRES_PASSWORD=" .env | head -1 | cut -d= -f2-)
  echo "Laenge: ${#PW} Zeichen"
  if printf '%s' "$PW" | grep -qE '[^A-Za-z0-9]'; then
    echo "WARNUNG: Passwort enthaelt Sonderzeichen -> DAS ist sehr wahrscheinlich die Ursache!"
    echo "         Bitte auf nur Buchstaben/Ziffern aendern, dann: docker compose down -v && docker compose up -d"
  else
    echo "OK: nur Buchstaben/Ziffern."
  fi
  echo
  echo "Gesetzte Schluessel (maskiert, nur zur Kontrolle der Laengen):"
  for k in JWT_SECRET ANON_KEY SERVICE_ROLE_KEY SECRET_KEY_BASE VAULT_ENC_KEY REALTIME_DB_ENC_KEY ENABLE_EMAIL_AUTOCONFIRM POOLER_TENANT_ID; do
    v=$(grep -E "^$k=" .env | head -1 | cut -d= -f2-)
    echo "  $k: Laenge ${#v}"
  done
else
  echo "(keine .env im aktuellen Ordner gefunden - bitte in supabase/docker ausfuehren)"
fi

echo
echo "===================== Auth-/API-Tests (localhost) ====================="
# Nebenwirkungsfrei: Health-Checks + eine harmlose Lese-RPC (legt KEINE Konten an).
if [ -f .env ] && command -v curl >/dev/null 2>&1; then
  ANON="$(grep -E '^ANON_KEY=' .env | head -1 | cut -d= -f2- || true)"
  H_APIKEY="apikey: ${ANON}"; H_AUTH="Authorization: Bearer ${ANON}"; H_JSON="Content-Type: application/json"
  code_direct=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:8000/auth/v1/health" -H "$H_APIKEY" -H "$H_AUTH" 2>/dev/null || echo ERR)
  echo "Auth-Health DIREKT an Kong (http://localhost:8000/auth/v1/health) : HTTP ${code_direct}"
  code_proxy=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:8080/supabase/auth/v1/health" -H "$H_APIKEY" -H "$H_AUTH" 2>/dev/null || echo ERR)
  echo "Auth-Health ueber nginx    (http://localhost:8080/supabase/...)   : HTTP ${code_proxy}"
  rpc_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:8080/supabase/rest/v1/rpc/class_exists" -H "$H_APIKEY" -H "$H_AUTH" -H "$H_JSON" -d '{"p_code":"XXXX"}' 2>/dev/null || echo ERR)
  echo "RPC class_exists ueber nginx                                      : HTTP ${rpc_code}"
  echo
  echo "Deutung:"
  echo "  - ueberall 2xx = OK (Gateway, Schluessel, Proxy und Schema funktionieren)."
  echo "  - DIREKT(8000)=2xx aber nginx(8080) != 2xx  -> Problem im nginx-Proxy."
  echo "  - beide 401                                 -> Kong/Schluessel (apikey) passt nicht."
  echo "  - Health 404                                -> Pfad-/Routing-Problem (/supabase)."
  echo "  - nur RPC 404                               -> Datenbank-Schema (noch) nicht eingespielt."
else
  echo "(uebersprungen: keine .env oder 'curl' nicht installiert)"
fi
