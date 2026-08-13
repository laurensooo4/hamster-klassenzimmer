# Skripte fuer die selbst gehostete Fassung (Docker)

Diese Dateien gehoeren zum Docker-Paket der Lern-Plattform. Sie liegen hier,
damit ein laufender Server einzelne Korrekturen nachladen kann, ohne dass eine
ZIP-Datei auf den Rechner uebertragen werden muss.

**Einspielen** (im Ordner `supabase/docker` des Servers):

```
curl -fsSL https://raw.githubusercontent.com/laurensooo4/hamster-klassenzimmer/main/docker-skripte/restore.sh -o scripts/restore.sh
```

Vor dem Ueberschreiben lohnt sich eine Kopie: `cp scripts/restore.sh scripts/restore.sh.alt`

## Stand 1.1.1 (13. August 2026)

| Datei | Korrektur |
|---|---|
| `backup.sh` | Pruefung verwarf grosse, voellig intakte Sicherungen (`grep -q` loeste ueber SIGPIPE einen falschen Fehler aus) |
| `restore.sh` | Einspielen jetzt als `supabase_admin` statt `postgres` (nur der Superuser darf `app.settings.*`, Event-Trigger und Extensions setzen); Datenbank wird vorher sauber freigeraeumt; automatischer Rueckweg, falls das Einspielen abbricht |
| `setup.sh` | Vorabpruefung der nginx-Konfiguration lief ausserhalb des Docker-Netzes und meldete faelschlich `host not found in upstream` |
| `check-security.sh`, `harden.sh`, `harden-existing.sh` | unveraendert seit 1.1 |

Alle Aenderungen wurden gegen das Image `supabase/postgres:17.6.1.136` in einer
isolierten Testumgebung geprueft: Sicherung anlegen, Datenverlust erzeugen,
wiederherstellen, Ergebnis zaehlen.
