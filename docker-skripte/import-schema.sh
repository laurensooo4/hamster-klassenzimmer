#!/usr/bin/env bash
# Spielt das komplette DB-Schema per psql ein (umgeht den Studio-SQL-Editor).
# Ausfuehren im Ordner supabase/docker:   bash scripts/import-schema.sh
set -euo pipefail

SQL="init/hamster-schema-komplett.sql"
if [ ! -f "$SQL" ]; then
  echo "FEHLER: $SQL nicht gefunden."
  echo "Bitte im Ordner 'supabase/docker' ausfuehren (der Ordner 'init/' muss dort liegen)."
  exit 1
fi

echo "Spiele Schema ein: $SQL"
cat "$SQL" | docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1
echo
echo "Fertig: Schema erfolgreich eingespielt."
