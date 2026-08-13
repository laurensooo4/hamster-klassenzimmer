#!/usr/bin/env bash
# ============================================================================
#  check-security.sh - Abnahme-Pruefung   (Release 1.1)
# ----------------------------------------------------------------------------
#  Prueft nach der Haertung ZWEI Dinge:
#    a) Sind die Sicherheitsluecken wirklich geschlossen?
#    b) Funktioniert die Plattform ueberhaupt noch?
#
#  Beides ist gleich wichtig - eine perfekt abgeriegelte, aber kaputte
#  Plattform hilft niemandem.
#
#  AUFRUF (aus dem Ordner supabase/docker):
#      bash scripts/check-security.sh
#
#  Das Skript veraendert NICHTS. Es liest nur.
# ============================================================================
set -uo pipefail

cd "$(dirname "$0")/.." || { echo "FEHLER: Ordner nicht gefunden."; exit 1; }
[ -f docker-compose.yml ] || { echo "FEHLER: Bitte aus dem Ordner supabase/docker starten."; exit 1; }

TRUSTED_PROXY=""; BIND_FRONTEND=""; BACKUP_AGE_RECIPIENT=""
# shellcheck source=/dev/null
[ -f hardening.conf ] && . ./hardening.conf

OK=0; WARN=0; FEHL=0
gut(){  printf '  \033[32m[ OK ]\033[0m %s\n' "$1"; OK=$((OK+1)); }
warn(){ printf '  \033[33m[WARN]\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '         -> %s\n' "$2"; WARN=$((WARN+1)); }
bad(){  printf '  \033[31m[FEHL]\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '         -> %s\n' "$2"; FEHL=$((FEHL+1)); }
titel(){ printf '\n\033[1m%s\033[0m\n' "$1"; }

echo "============================================================"
echo "  Abnahme-Pruefung der Lern-Plattform"
echo "  $(date '+%Y-%m-%d %H:%M')"
echo "============================================================"

# ---------------------------------------------------------------------------
titel "1. Welche Ports sind nach aussen offen?"
# ---------------------------------------------------------------------------
if command -v ss >/dev/null 2>&1; then
  OFFEN="$(ss -tlnH 2>/dev/null | awk '{print $4}')"
  if [ -z "$OFFEN" ]; then
    warn "Die Portliste ist leer - die Pruefung konnte nicht durchgefuehrt werden."          "Bitte mit sudo starten: sudo bash scripts/check-security.sh"
  fi
  pruefe_port(){   # $1 = Port, $2 = Klartext
    local treffer
    treffer="$(printf '%s\n' "$OFFEN" | grep -E "(^|[^0-9.])(0\.0\.0\.0|\*|\[::\]):$1$" || true)"
    if [ -n "$treffer" ]; then
      bad "Port $1 ($2) ist auf ALLEN Schnittstellen offen." \
          "Jedes Geraet im Schulnetz erreicht ihn. bash scripts/harden-existing.sh ausfuehren (setup.sh NICHT - das loescht die Datenbank!)."
    else
      if printf '%s\n' "$OFFEN" | grep -qE "127\.0\.0\.1:$1$"; then
        gut "Port $1 ($2) nur lokal erreichbar."
      else
        gut "Port $1 ($2) ist gar nicht offen."
      fi
    fi
  }
  pruefe_port 8000 "Supabase-Gateway inkl. Studio"
  pruefe_port 5432 "PostgreSQL"
  pruefe_port 6543 "PostgreSQL-Pooler"

  if printf '%s\n' "$OFFEN" | grep -qE "(0\.0\.0\.0|\*|\[::\]):8080$"; then
    if [ -n "$BIND_FRONTEND" ]; then
      warn "Port 8080 ist auf allen Schnittstellen offen, obwohl BIND_FRONTEND gesetzt ist." \
           "bash scripts/harden-existing.sh ausfuehren (setup.sh wuerde die Datenbank loeschen!)."
    else
      gut "Port 8080 (Web-App) ist im Netz erreichbar - so gewollt, wenn der IServ von aussen zugreift."
    fi
  else
    gut "Port 8080 (Web-App) ist nur lokal gebunden."
  fi
else
  warn "'ss' nicht gefunden - Ports konnten nicht geprueft werden." "sudo apt install iproute2"
fi

# ---------------------------------------------------------------------------
titel "2. Ist die Administrationsoberflaeche von aussen dicht?"
# ---------------------------------------------------------------------------
# Antwortet die Web-App gerade nicht (000), wird mehrfach nachgefasst: nach
# einem Neustart oder einer Wiederherstellung braucht das API-Gateway rund eine
# Minute, bis der Web-Container ueberhaupt startet. Ohne dieses Nachfassen
# meldet die Abnahme faelschlich "Plattform kaputt" (neu in Release 1.1.2).
hole(){
  local c i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$1" 2>/dev/null)"
    [ -n "$c" ] || c="000"
    [ "$c" != "000" ] && break
    [ "$i" = "1" ] && printf '      (Web-App antwortet noch nicht - warte' >&2
    printf '.' >&2
    sleep 5
  done
  [ "$i" != "1" ] && printf ')\n' >&2
  printf '%s' "$c"
}
BASIS="http://127.0.0.1:8080"

C="$(hole "$BASIS/supabase/")"
if [ "$C" = "404" ]; then gut "/supabase/ liefert 404 (Studio nicht erreichbar)."
elif [ "$C" = "000" ]; then warn "Web-App antwortet nicht auf $BASIS." "Laeuft der Frontend-Container? 'docker compose ps'"
else bad "/supabase/ liefert HTTP $C statt 404." "Die Positivliste in frontend/nginx.conf fehlt oder greift nicht."; fi

C="$(hole "$BASIS/supabase/pg/query")"
if [ "$C" = "404" ]; then gut "/supabase/pg/ (SQL-Endpunkt) ist gesperrt."
elif [ "$C" = "000" ]; then warn "Keine Antwort - uebersprungen." ""
else bad "/supabase/pg/ liefert HTTP $C statt 404." "Sehr gefaehrlich: darueber ist beliebiges SQL moeglich."; fi

C="$(hole "$BASIS/supabase/auth/v1/admin/users")"
if [ "$C" = "404" ]; then gut "/supabase/auth/v1/admin ist gesperrt."
elif [ "$C" = "000" ]; then warn "Keine Antwort - uebersprungen." ""
else bad "/supabase/auth/v1/admin liefert HTTP $C statt 404." "Darueber lassen sich Konten anlegen und loeschen."; fi

for D in README.md LICENSE; do
  C="$(hole "$BASIS/$D")"
  if [ "$C" = "404" ]; then gut "$D wird nicht ausgeliefert."
  elif [ "$C" = "000" ]; then :
  else warn "$D ist ueber den Browser abrufbar (HTTP $C)." "Harmlos, aber unnoetig."; fi
done

# ---------------------------------------------------------------------------
titel "3. Funktioniert die Plattform noch?"
# ---------------------------------------------------------------------------
C="$(hole "$BASIS/")"
if [ "$C" = "200" ]; then gut "Startseite laedt (HTTP 200)."
else bad "Startseite liefert HTTP $C." "Ohne sie ist die Plattform nicht benutzbar."; fi

C="$(hole "$BASIS/config.js")"
if [ "$C" = "200" ]; then gut "config.js wird ausgeliefert."
else bad "config.js liefert HTTP $C." "Ohne sie kann sich niemand anmelden."; fi

C="$(hole "$BASIS/supabase/auth/v1/health")"
if [ "$C" = "200" ] || [ "$C" = "401" ]; then gut "Auth-Dienst antwortet ueber den Proxy (HTTP $C)."
else bad "Auth-Dienst antwortet nicht ueber den Proxy (HTTP $C)." "Anmeldung waere unmoeglich. Positivliste in nginx.conf pruefen."; fi

ANON="$(grep -oE '"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"' frontend/config.docker.js 2>/dev/null | head -1 | tr -d '"')"
if [ -n "$ANON" ]; then
  C="000"
  for _ in 1 2 3 4 5 6; do
    C="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 \
         -H "apikey: $ANON" "$BASIS/supabase/rest/v1/classes?select=id&limit=1" 2>/dev/null)"
    [ -n "$C" ] || C="000"
    [ "$C" != "000" ] && break
    sleep 5
  done
  if [ "$C" = "200" ]; then gut "Datenbank-Zugriff ueber den Proxy funktioniert (HTTP 200)."
  else bad "Datenbank-Zugriff liefert HTTP $C." "Die App koennte keine Daten laden."; fi
else
  warn "ANON_KEY nicht aus frontend/config.docker.js lesbar - Datenbanktest uebersprungen." ""
fi

# ---------------------------------------------------------------------------
titel "4. Container-Sperre gegen das Schulnetz"
# ---------------------------------------------------------------------------
if command -v iptables >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; then
  R="$(iptables -L HAMSTER-EGRESS -n 2>/dev/null || iptables -L DOCKER-USER -n 2>/dev/null || true)"
  if printf '%s' "$R" | grep -q "DROP"; then
    gut "Container-Sperre ist aktiv (DROP-Regeln vorhanden)."
    ERSTE="$(iptables -S HAMSTER-EGRESS 2>/dev/null | sed -n '2p')"
    if printf '%s' "$ERSTE" | grep -q "RELATED,ESTABLISHED"; then
      gut "Die conntrack-Regel steht an erster Stelle (richtig)."
    else
      bad "Regel 1 ist NICHT die conntrack-Regel." "In dieser Reihenfolge werden Antworten an den Proxy verworfen - die App waere von aussen tot."
    fi
  else
    warn "Keine Sperre gefunden." "sudo bash scripts/harden.sh"
  fi
  RAW="$(iptables -t raw -S PREROUTING 2>/dev/null || true)"
  LOOP="$(iptables -t raw -S HAMSTER-LOOPBACK 2>/dev/null || true)"
  if [ -n "$LOOP" ]; then
    # Neue Fassung (1.1.3): eigene Kette mit Liste erlaubter Schnittstellen.
    if printf '%s' "$LOOP" | grep -q -- '-i lo -j RETURN'; then
      gut "Loopback-Schutz laesst den eigenen Rechner durch ($(printf '%s' "$LOOP" | grep -c -- '-j RETURN') Schnittstelle(n) erlaubt)."
    else
      bad "Der Loopback-Schutz laesst 'lo' NICHT durch - das legt DNS, Anmeldung und Studio-Zugang lahm." "sudo bash scripts/harden.sh erneut ausfuehren."
    fi
  elif printf '%s' "$RAW" | grep -q '127.0.0.0/8 -j DROP'; then
    # Alte Fassung: einzelne Regel. Nur korrekt, wenn sie 'lo' ausnimmt.
    if printf '%s' "$RAW" | grep -q -- '! -i lo .*127.0.0.0/8 -j DROP'; then
      warn "Loopback-Schutz stammt aus einer aelteren Fassung." "Beim naechsten 'sudo bash scripts/harden.sh' wird er ersetzt."
    else
      bad "Die Loopback-Regel gilt AUCH fuer lo - das legt DNS, Anmeldung und Studio-Zugang lahm." "sudo bash scripts/harden.sh erneut ausfuehren."
    fi
  fi
  if systemctl is-enabled hamster-container-firewall.service >/dev/null 2>&1; then
    gut "Sperre ueberlebt einen Neustart (systemd-Dienst aktiv)."
  else
    warn "Sperre ist nicht neustartfest." "sudo bash scripts/harden.sh"
  fi
else
  warn "Firewall nicht geprueft (root noetig)." "Fuer diesen Punkt: sudo bash scripts/check-security.sh"
fi

# ---------------------------------------------------------------------------
titel "5. Backups"
# ---------------------------------------------------------------------------
if [ -d backups ]; then
  NEUSTE="$(ls -1t backups/hamster-db_*.sql.gz* 2>/dev/null | head -1)"
  if [ -n "$NEUSTE" ]; then
    ALTER=$(( ( $(date +%s) - $(date -r "$NEUSTE" +%s 2>/dev/null || echo 0) ) / 86400 ))
    if [ "$ALTER" -le 2 ]; then gut "Juengste Sicherung ist $ALTER Tag(e) alt."
    else warn "Juengste Sicherung ist $ALTER Tage alt." "Laeuft der cron-Eintrag? 'crontab -l'"; fi
    case "$NEUSTE" in
      *.age) gut "Sicherungen sind verschluesselt." ;;
      *) if [ -n "$BACKUP_AGE_RECIPIENT" ]; then
           bad "BACKUP_AGE_RECIPIENT ist gesetzt, aber die Sicherung ist unverschluesselt." "Ist 'age' installiert? sudo apt install age"
         else
           warn "Sicherungen sind UNVERSCHLUESSELT." "Sie enthalten alle Konten samt Passwort-Hashes. BACKUP_AGE_RECIPIENT in hardening.conf setzen."
         fi ;;
    esac
  else
    bad "Keine Sicherung gefunden." "bash scripts/backup.sh"
  fi
  RECHTE="$(stat -c '%a' backups 2>/dev/null || echo '?')"
  if [ "$RECHTE" = "700" ]; then gut "Backup-Ordner ist nur fuer den Besitzer lesbar (700)."
  else warn "Backup-Ordner hat die Rechte $RECHTE." "chmod 700 backups"; fi
else
  bad "Ordner 'backups' fehlt." "bash scripts/backup.sh"
fi

CRONUSER="${SUDO_USER:-$(id -un)}"
if crontab -u "$CRONUSER" -l 2>/dev/null | grep -q "backup.sh" || crontab -l 2>/dev/null | grep -q "backup.sh" || grep -rqs "backup.sh" /etc/cron.d 2>/dev/null; then gut "Naechtliches Backup ist im cron eingetragen."
else warn "Kein cron-Eintrag fuer backup.sh gefunden." "crontab -e - siehe ANLEITUNG-Installation-und-Backup.md"; fi

# ---------------------------------------------------------------------------
titel "6. System"
# ---------------------------------------------------------------------------
if [ -f /etc/apt/apt.conf.d/20auto-upgrades ] && grep -q 'Unattended-Upgrade "1"' /etc/apt/apt.conf.d/20auto-upgrades 2>/dev/null; then
  gut "Automatische Sicherheitsupdates sind eingeschaltet."
else
  warn "Automatische Sicherheitsupdates sind nicht eingerichtet." "sudo bash scripts/harden.sh"
fi
if [ -f .env ]; then
  R="$(stat -c '%a' .env 2>/dev/null || echo '?')"
  if [ "$R" = "600" ]; then gut ".env ist nur fuer den Besitzer lesbar (600)."
  else bad ".env hat die Rechte $R." "Sie enthaelt alle Geheimnisse: chmod 600 .env"; fi
fi
if [ -n "$TRUSTED_PROXY" ]; then
  if grep -q "set_real_ip_from" frontend/nginx.conf 2>/dev/null; then
    gut "Echte Besucher-IP wird vom Proxy uebernommen."
  else
    bad "TRUSTED_PROXY gesetzt, aber nicht in nginx eingetragen." "bash scripts/harden-existing.sh ausfuehren - sonst zaehlt das Rate-Limit alle Nutzer als einen. (setup.sh NICHT!)"
  fi
fi

# ---------------------------------------------------------------------------
echo ""
echo "============================================================"
printf "  Ergebnis:  \033[32m%d OK\033[0m   \033[33m%d Hinweise\033[0m   \033[31m%d Fehler\033[0m\n" "$OK" "$WARN" "$FEHL"
echo "============================================================"
if [ "$FEHL" -gt 0 ]; then
  echo "  Bitte die mit [FEHL] markierten Punkte beheben, BEVOR der Server"
  echo "  aus dem Internet erreichbar gemacht wird."
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo "  Keine Fehler. Die Hinweise sollten mittelfristig abgearbeitet werden."
  exit 0
else
  echo "  Alles in Ordnung."
  exit 0
fi
