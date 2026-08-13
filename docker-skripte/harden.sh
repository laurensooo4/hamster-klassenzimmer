#!/usr/bin/env bash
# ============================================================================
#  harden.sh - Betriebssystem-Haertung fuer den Schulserver   (Release 1.1)
# ----------------------------------------------------------------------------
#  WAS DIESES SKRIPT TUT
#   1. Automatische Sicherheitsupdates einschalten
#   2. Zeitsynchronisation sicherstellen (wichtig fuer TLS und Protokolle)
#   3. Container daran hindern, ins Schulnetz zu funken  <- der Kern
#   4. Diese Firewall-Regeln neustartfest machen
#
#  WAS ES BEWUSST NICHT TUT
#   - Es fasst SSH NICHT an. Eine falsche sshd_config sperrt euch aus, und das
#     laesst sich aus der Ferne nicht reparieren. Die SSH-Haertung steht in
#     SICHERHEIT-2-Haertungsanleitung.md, Schritt 7 - mit Aussperr-Schutz.
#   - Es fasst die Firewall fuer den SERVER selbst (INPUT/OUTPUT) nicht an,
#     aus demselben Grund. Nur die Container werden eingeschraenkt.
#
#  AUFRUF (aus dem Ordner supabase/docker):
#      sudo bash scripts/harden.sh --dry-run    # nur zeigen, nichts aendern
#      sudo bash scripts/harden.sh              # anwenden
#
#  RUECKGAENGIG:
#      sudo bash scripts/harden.sh --aus        # Container-Sperre entfernen
# ============================================================================
set -uo pipefail

MODUS="anwenden"
case "${1:-}" in
  --dry-run|-n) MODUS="probe" ;;
  --aus|--off)  MODUS="aus" ;;
  --help|-h)    sed -n '2,26p' "$0"; exit 0 ;;
  "")           ;;
  *)            echo "Unbekannte Option: $1  (--dry-run, --aus, --help)"; exit 1 ;;
esac

cd "$(dirname "$0")/.." 2>/dev/null || true
TRUSTED_PROXY=""; EGRESS_AUSNAHMEN=""
# shellcheck source=/dev/null
[ -f hardening.conf ] && . ./hardening.conf

SKRIPT="/usr/local/sbin/hamster-container-firewall.sh"
UNIT="/etc/systemd/system/hamster-container-firewall.service"

rot(){ printf '\033[31m%s\033[0m\n' "$*"; }
gruen(){ printf '\033[32m%s\033[0m\n' "$*"; }
info(){ printf '  %s\n' "$*"; }
tun(){ if [ "$MODUS" = "probe" ]; then echo "  [würde ausführen] $*"; else eval "$@"; fi; }

echo "============================================================"
echo "  Haertung des Schulservers   (Modus: $MODUS)"
echo "============================================================"

if [ "$MODUS" != "probe" ] && [ "$(id -u)" -ne 0 ]; then
  rot "FEHLER: Bitte mit sudo starten:  sudo bash scripts/harden.sh"
  exit 1
fi

# ============================================================================
#  A) Container-Sperre entfernen (Rueckweg)
# ============================================================================
if [ "$MODUS" = "aus" ]; then
  echo "[1/1] Entferne die Container-Sperre ..."
  systemctl disable --now hamster-container-firewall.service >/dev/null 2>&1 || true
  rm -f "$UNIT" "$SKRIPT"
  systemctl daemon-reload >/dev/null 2>&1 || true
  iptables -D DOCKER-USER -j HAMSTER-EGRESS 2>/dev/null || true
  iptables -F HAMSTER-EGRESS 2>/dev/null || true
  iptables -X HAMSTER-EGRESS 2>/dev/null || true
  # Loopback-Schutz abraeumen: neue Kette und die alte Einzelregel.
  iptables -t raw -D PREROUTING -d 127.0.0.0/8 -j HAMSTER-LOOPBACK 2>/dev/null || true
  iptables -t raw -F HAMSTER-LOOPBACK 2>/dev/null || true
  iptables -t raw -X HAMSTER-LOOPBACK 2>/dev/null || true
  iptables -t raw -D PREROUTING ! -i lo -d 127.0.0.0/8 -j DROP 2>/dev/null || true
  gruen "Fertig. Die Container duerfen wieder ueberallhin - Zustand wie vorher."
  exit 0
fi

# ============================================================================
#  1) Automatische Sicherheitsupdates
# ============================================================================
echo "[1/4] Automatische Sicherheitsupdates ..."
if command -v apt-get >/dev/null 2>&1; then
  if dpkg -s unattended-upgrades >/dev/null 2>&1; then
    info "unattended-upgrades ist bereits installiert."
  else
    tun "DEBIAN_FRONTEND=noninteractive apt-get update -qq"
    tun "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unattended-upgrades"
  fi
  if [ "$MODUS" != "probe" ]; then
    cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
    gruen "  Sicherheitsupdates werden automatisch eingespielt."
    info "Protokoll: /var/log/unattended-upgrades/"
  else
    echo "  [würde schreiben] /etc/apt/apt.conf.d/20auto-upgrades"
  fi
else
  info "Kein apt-System erkannt - Schritt uebersprungen."
fi

# ============================================================================
#  2) Zeitsynchronisation
# ============================================================================
echo "[2/4] Zeitsynchronisation ..."
if command -v timedatectl >/dev/null 2>&1; then
  if timedatectl show -p NTPSynchronized --value 2>/dev/null | grep -q yes; then
    gruen "  Uhrzeit ist synchron."
  else
    tun "timedatectl set-ntp true"
    info "Zeitsynchronisation eingeschaltet (kann ein paar Minuten brauchen)."
  fi
else
  info "timedatectl nicht vorhanden - bitte von Hand pruefen."
fi

# ============================================================================
#  3) Container-Sperre: kein Zugriff der Container ins Schulnetz
# ----------------------------------------------------------------------------
#  Das ist die Antwort auf die Sorge "ein uebernommener Server greift den
#  IServ an". Die Regeln haengen in der Kette DOCKER-USER, die Docker VOR
#  seinen eigenen Regeln abarbeitet - eine ufw-Regel wuerde hier nichts
#  bewirken, weil Docker sie umgeht.
#
#  REIHENFOLGE IST ENTSCHEIDEND:
#  Regel 1 laesst Antwortpakete bestehender Verbindungen durch. Ohne sie
#  wuerden die Antworten an den vorgelagerten Proxy (IServ) verworfen und die
#  Web-App waere von aussen tot - der Fehler saehe wie ein Proxy-Problem aus.
# ============================================================================
echo "[3/4] Container-Sperre gegen das lokale Netz ..."

if ! command -v iptables >/dev/null 2>&1; then
  rot "  FEHLER: iptables nicht gefunden - Schritt uebersprungen."
else
  # Docker-eigene Netze ermitteln, damit die Container untereinander und mit
  # dem Gateway weiter reden duerfen.
  DOCKER_NETZE="$(docker network inspect $(docker network ls -q) \
      --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]' | sort -u | tr '\n' ' ')"
  if [ -z "${DOCKER_NETZE// /}" ]; then
    rot "  FEHLER: Die Docker-Netze liessen sich nicht ermitteln (laeuft Docker?)."
    info "Ohne diese Liste wuerde die Sperre auch den Verkehr ZWISCHEN den Containern"
    info "verwerfen - die Plattform waere sofort tot. Es wird nichts geaendert."
    info "Bitte 'docker compose up -d' ausfuehren und harden.sh erneut starten."
    exit 1
  fi
  info "Docker-eigene Netze (bleiben erlaubt): $DOCKER_NETZE"
  info "Zusaetzliche Ausnahmen aus hardening.conf: ${EGRESS_AUSNAHMEN:-keine}"

  if [ "$MODUS" = "probe" ]; then
    echo "  [würde schreiben] $SKRIPT  und die Regeln setzen"
  else
    cat > "$SKRIPT" <<EOF
#!/usr/bin/env bash
# Automatisch erzeugt von scripts/harden.sh - nicht von Hand aendern.
# Verhindert, dass Docker-Container Verbindungen ins lokale Netz aufbauen.
set -u
command -v iptables >/dev/null 2>&1 || exit 0
iptables -L DOCKER-USER -n >/dev/null 2>&1 || exit 0

# Eigene Unterkette: so werden Regeln anderer Werkzeuge (z. B. fail2ban) in
# DOCKER-USER nicht mitgeloescht.
iptables -N HAMSTER-EGRESS 2>/dev/null || true
iptables -F HAMSTER-EGRESS
iptables -C DOCKER-USER -j HAMSTER-EGRESS 2>/dev/null || iptables -I DOCKER-USER 1 -j HAMSTER-EGRESS

# 1) MUSS REGEL 1 BLEIBEN: Antworten auf bestehende Verbindungen durchlassen.
#    Sonst blockiert die Sperre unten die Antwortpakete an den Reverse-Proxy
#    und die Web-App ist von aussen nicht mehr erreichbar.
iptables -A HAMSTER-EGRESS -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN

# 2) Docker-eigene Netze bleiben frei (Container untereinander, Gateway).
#    Wird bei JEDEM Lauf neu ermittelt - nach einem Neuaufbau koennen sich die
#    Subnetze aendern; eine fest eingebackene Liste waere dann falsch.
NETZE="\$(docker network inspect \$(docker network ls -q) --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]' | sort -u | tr '\n' ' ')"
if [ -z "\${NETZE// /}" ]; then
  echo "hamster-firewall: Docker-Netze nicht ermittelbar - Regeln werden NICHT gesetzt." >&2
  iptables -D DOCKER-USER -j HAMSTER-EGRESS 2>/dev/null || true
  exit 0
fi
for N in \$NETZE; do
  iptables -A HAMSTER-EGRESS -d "\$N" -j RETURN
done

# 3) Namensaufloesung und Zeitabgleich bleiben erlaubt.
iptables -A HAMSTER-EGRESS -p udp --dport 53  -j RETURN
iptables -A HAMSTER-EGRESS -p tcp --dport 53  -j RETURN
iptables -A HAMSTER-EGRESS -p udp --dport 123 -j RETURN

# 4) Ausdrueckliche Ausnahmen aus hardening.conf (z. B. Mailserver).
for Z in ${EGRESS_AUSNAHMEN}; do
  iptables -A HAMSTER-EGRESS -d "\$Z" -j RETURN
done

# 5) Alles Uebrige ins lokale Netz: verwerfen.
iptables -A HAMSTER-EGRESS -d 10.0.0.0/8     -j DROP
iptables -A HAMSTER-EGRESS -d 172.16.0.0/12  -j DROP
iptables -A HAMSTER-EGRESS -d 192.168.0.0/16 -j DROP
iptables -A HAMSTER-EGRESS -d 169.254.0.0/16 -j DROP

# 6) Ins Internet darf weiterhin alles (Updates, Lets Encrypt).
iptables -A HAMSTER-EGRESS -j RETURN

# 7) Zusatzschutz gegen einen bekannten Docker-Fehler: Pakete von AUSSEN mit
#    Loopback-Zieladresse (127.x) gar nicht erst annehmen.
#
#    Frueher stand hier eine einzelne Regel  "! -i lo -d 127.0.0.0/8 -j DROP".
#    Auf einem normalen Server ist das richtig. Unter WSL2 mit gespiegeltem
#    Netzwerk kommt Verkehr an 127.0.0.1 aber legitim ueber eine ZUSAETZLICHE
#    Schnittstelle namens "loopback0" herein - die Regel hat dort die eigene
#    Web-App unerreichbar gemacht, obwohl alle Container liefen.
#    Deshalb jetzt eine eigene Kette mit einer Liste erlaubter Schnittstellen.
LOKAL="lo"
if grep -qi microsoft /proc/version 2>/dev/null; then
  ip -o link show 2>/dev/null | grep -q ' loopback0:' && LOKAL="\$LOKAL loopback0"
fi
iptables -t raw -N HAMSTER-LOOPBACK 2>/dev/null || true
iptables -t raw -F HAMSTER-LOOPBACK
for I in \$LOKAL; do
  iptables -t raw -A HAMSTER-LOOPBACK -i "\$I" -j RETURN
done
iptables -t raw -A HAMSTER-LOOPBACK -j DROP
# Alte Einzelregel aus frueheren Fassungen entfernen (sonst wirkt sie weiter).
iptables -t raw -D PREROUTING ! -i lo -d 127.0.0.0/8 -j DROP 2>/dev/null || true
iptables -t raw -C PREROUTING -d 127.0.0.0/8 -j HAMSTER-LOOPBACK 2>/dev/null \
  || iptables -t raw -I PREROUTING -d 127.0.0.0/8 -j HAMSTER-LOOPBACK
EOF
    chmod 700 "$SKRIPT"

    cat > "$UNIT" <<EOF
[Unit]
Description=Container-Sperre gegen das lokale Netz (Lern-Plattform)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
# Docker braucht einen Moment, bis die Kette DOCKER-USER existiert.
ExecStartPre=/bin/sleep 5
ExecStart=$SKRIPT

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable hamster-container-firewall.service >/dev/null 2>&1
    if systemctl start hamster-container-firewall.service; then
      gruen "  Container-Sperre aktiv und neustartfest."
    else
      rot "  WARNUNG: Die Sperre liess sich nicht starten."
      info "Pruefen mit: systemctl status hamster-container-firewall.service"
    fi
  fi
fi

# ============================================================================
#  4) Ergebnis zeigen
# ============================================================================
echo "[4/4] Ergebnis ..."
if [ "$MODUS" != "probe" ]; then
  echo ""
  echo "Aktive Regeln in der Kette HAMSTER-EGRESS:"
  iptables -L HAMSTER-EGRESS -n --line-numbers 2>/dev/null | head -20 || info "(nicht lesbar)"
fi

echo ""
echo "============================================================"
if [ "$MODUS" = "probe" ]; then
  echo " PROBELAUF beendet - es wurde NICHTS veraendert."
  echo " Zum Anwenden:  sudo bash scripts/harden.sh"
else
  gruen " Haertung abgeschlossen."
  echo ""
  echo " JETZT BITTE PRUEFEN (wichtig!):"
  echo "   1. Web-App im Browser aufrufen - laedt sie noch?"
  echo "   2. Anmelden - klappt das?"
  echo "   3. bash scripts/check-security.sh"
  echo ""
  echo " Falls etwas nicht mehr geht:"
  echo "   sudo bash scripts/harden.sh --aus"
fi
echo "============================================================"
