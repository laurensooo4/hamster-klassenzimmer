# Skripte fuer die selbst gehostete Fassung (Docker)

Diese Dateien gehoeren zum Docker-Paket der Lern-Plattform. Sie liegen hier,
damit ein laufender Server einzelne Korrekturen nachladen kann, ohne dass eine
ZIP-Datei auf den Rechner uebertragen werden muss.

**Einspielen** (im Ordner `supabase/docker` des Servers, Beispiel `restore.sh`):

```
cp scripts/restore.sh scripts/restore.sh.alt
curl -fsSL https://raw.githubusercontent.com/laurensooo4/hamster-klassenzimmer/main/docker-skripte/restore.sh -o scripts/restore.sh
```

## Stand 1.1.3 (13. August 2026)

| Datei | Korrektur |
|---|---|
| `backup.sh` | Pruefung verwarf grosse, voellig intakte Sicherungen (`grep -q` loeste ueber SIGPIPE einen falschen Fehler aus) |
| `restore.sh` | Einspielen als `supabase_admin` statt `postgres` (nur der Superuser darf `app.settings.*`, Event-Trigger und Extensions setzen); Datenbank wird vorher sauber freigeraeumt; automatischer Rueckweg, falls das Einspielen abbricht; wartet am Ende, bis die Web-App wirklich wieder antwortet |
| `check-security.sh` | fasst bei HTTP-Pruefungen mehrfach nach, statt direkt nach einem Neustart Alarm zu schlagen; prueft den Loopback-Schutz jetzt richtig |
| `harden.sh` | Loopback-Schutz als eigene Kette mit Liste erlaubter Schnittstellen - die alte Einzelregel konnte auf Systemen mit gespiegeltem Loopback den eigenen Rechner aussperren |
| `setup.sh` | Vorabpruefung der nginx-Konfiguration lief ausserhalb des Docker-Netzes und meldete faelschlich `host not found in upstream` |

## Wie geprueft wurde

Komplette Neuinstallation aus dem Paket gegen das Image
`supabase/postgres:17.6.1.136` (dieselbe Fassung wie auf dem Schulserver):
entpacken unter Linux, `setup.sh` von null, Admin-Konto, Anmeldung, Klasse
anlegen, Sicherung, alle Daten loeschen, Wiederherstellung, Anmeldung erneut,
Haertung anwenden, Abnahme. Ergebnis: 12 von 12 Containern gesund,
`check-security.sh` meldet **21 OK, 2 Hinweise, 0 Fehler**; die Container-Sperre
blockiert nachweislich den Weg ins lokale Netz, laesst Updates aus dem Internet
aber zu.
