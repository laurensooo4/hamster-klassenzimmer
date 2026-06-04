-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase D
--  Lösungscode-Vergleich (Auto-Check) + freier Sandbox-Modus je Klasse
--  -> Im Supabase SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

-- 1) Lösungscode je Aufgabe — NUR Lehrkraft -----------------------------------
--    Treibt den Auto-Check "Mit Musterlösung vergleichen". Bewusst eigene
--    Tabelle OHNE Schüler-Policy: der Lösungscode ist für Schüler:innen nie
--    lesbar (nur der daraus berechnete Soll-Zustand steht in assignments.goal).
create table if not exists public.assignment_solutions (
  assignment_id uuid primary key references public.assignments(id) on delete cascade,
  author_id     uuid not null references public.profiles(id) on delete cascade,
  code          text not null,
  match_hamster boolean not null default false,
  updated_at    timestamptz not null default now()
);
alter table public.assignment_solutions enable row level security;
drop policy if exists asol_teacher_all on public.assignment_solutions;
create policy asol_teacher_all on public.assignment_solutions for all
  using (public.is_assignment_teacher(assignment_id))
  with check (public.is_assignment_teacher(assignment_id));

-- Vorlagen dürfen Lösungscode mitführen (Vorlagen sind ohnehin nur für die
-- Lehrkraft sichtbar -> templates_owner_all).
alter table public.templates add column if not exists solution_code text;
alter table public.templates add column if not exists match_hamster boolean;

-- 2) Sandbox je Klasse aktivierbar -------------------------------------------
alter table public.classes add column if not exists sandbox_enabled boolean not null default false;

-- 3) Sandbox-Projekte der Schüler:innen (frei: Welt + Code) -------------------
create table if not exists public.sandbox_projects (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  class_id   uuid not null references public.classes(id) on delete cascade,
  title      text not null default 'Mein Projekt',
  territory  jsonb,
  code       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sandbox_projects enable row level security;
drop policy if exists sbx_owner_all on public.sandbox_projects;
create policy sbx_owner_all on public.sandbox_projects for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Fertig ✅  (Phase D)
