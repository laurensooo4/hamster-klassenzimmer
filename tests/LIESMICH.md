# Prüfungen

## Vor jeder Veröffentlichung, die eine `schema_update_*.sql` anfasst

```
bash hamster-site/tests/pruefe-wiederholtes-einspielen.sh
```

Im Ordner `supabase/docker` ausführen, während die Plattform läuft.

### Wogegen das schützt

Seit `scripts/update.sh` die Dateien aus `migrationen.txt` selbst abarbeitet,
laufen sie bei **jedem** Update erneut. Eine Zeile, die dabei Daten umschreibt
statt nur Strukturen anzulegen, richtet dann jedes Mal Schaden an.

Genau das ist am 25.08.2026 passiert: `schema_update_phaseB.sql` enthielt eine
Zeile, die alle Aufgaben in Erstell-Reihenfolge durchnummeriert. Sie war als
einmalige Einrichtung gedacht — der Dateikopf behauptete „re-runnable", sie war
es aber nicht. Nach dem Update stand die Reihenfolge der Aufgaben auf dem Kopf.
Dieselbe Sorte Zeile in `schema_update_phaseC.sql` markierte bei mehreren
Abgabe-Versionen die falsche als „aktuell".

Das Skript legt Testdaten an (Aufgaben mit eigener Reihenfolge, drei
Abgabe-Versionen), spielt alle Dateien **dreimal** ein und vergleicht danach
eine Prüfsumme über **jede** Tabelle. Verändert irgendeine Datei irgendeine
Zeile, fällt es auf.

Es räumt seine Testdaten selbst wieder weg (Präfix `PRUEFLAUF`).

### Die Regel dahinter

Eine Datei in `migrationen.txt` darf beim zweiten Lauf **nichts** mehr tun.
Strukturen anlegen ist unkritisch (`create table if not exists`,
`alter table … add column if not exists`, `create or replace function`).

Vorsicht ist bei allem geboten, was **Daten** anfasst — `update`, `delete`,
`insert` außerhalb einer Funktion. Wenn so etwas nötig ist, gehört es in eine
Bedingung, die nur beim allerersten Mal zutrifft. Bewährt hat sich, an die
Existenz der Spalte zu knüpfen, die gerade angelegt wird:

```sql
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='…' and column_name='…') then
    execute 'alter table … add column … ';
    execute 'update … ';          -- läuft nur in diesem einen Moment
  end if;
end $$;
```

Eine Bedingung über die **Datenwerte** reicht nicht: Die erste Aufgabe einer
Klasse trägt regulär die Position 0 und sieht damit aus wie ein unbenutzter
Standardwert.
