# Hamster-Klassenzimmer — Supabase einrichten (einmalig, ~5 Min)

1. **Projekt anlegen**
   - Auf <https://supabase.com> → **Sign in** → **Continue with GitHub**.
   - **New project** → Name z. B. `hamster-klassenzimmer`,
     Region **Central EU (Frankfurt)** (DSGVO-freundlich für deutsche Schüler),
     ein **Datenbank-Passwort** vergeben (irgendwo notieren).
   - „Create new project" → ~2 Min warten, bis es bereit ist.

2. **E-Mail-Bestätigung ausschalten** (wir nutzen Username-Login ohne echte Mails)
   - Links **Authentication** → **Sign In / Providers** (bzw. „Providers") → **Email**.
   - **„Confirm email" ausschalten** → speichern.

3. **Schema einspielen**
   - Links **SQL Editor** → **New query**.
   - Inhalt von [`schema.sql`](schema.sql) komplett einfügen → **Run**.
   - Sollte „Success. No rows returned" zeigen.

4. **Zugangsdaten kopieren** (diese sind öffentlich/unbedenklich)
   - Links **Project Settings** (Zahnrad) → **API**.
   - Kopiere **Project URL** (z. B. `https://abcd1234.supabase.co`)
   - und **Project API keys → `anon` `public`** (langer Schlüssel).

5. **Beides an Claude geben** → ich baue Logins, Lehrer-/Schüler-Oberfläche,
   Aufgaben, Abgaben und die Matrix und veröffentliche es.

> Der `anon`-Schlüssel darf öffentlich sein – der Zugriff ist über die
> Row-Level-Security-Regeln in `schema.sql` abgesichert. Den **`service_role`**-
> Schlüssel brauche ich **nicht** – bitte niemals teilen.
