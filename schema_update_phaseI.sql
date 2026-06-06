-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase I
--  (1) Lehrer-Sandbox: eigene Projekte OHNE Klasse  (class_id darf NULL sein)
--  (2) Co-Lehrkraft darf sich SELBST aus einer Klasse entfernen
--  (3) Klasse an andere Lehrkraft ÜBERGEBEN (Eigentümer-Wechsel) per RPC
--  -> Im Supabase-SQL-Editor einfügen und "Run". (re-runnable / idempotent)
-- ============================================================================

-- 1) Persönliche Lehrer-Sandbox: Projekte ohne Klasse -------------------------
--    class_id wird optional; die owner-only-RLS (sbx_owner_all aus Phase D,
--    "owner_id = auth.uid()") gilt unverändert weiter, auch für class_id IS NULL.
alter table public.sandbox_projects alter column class_id drop not null;

-- 2) Co-Lehrkraft entfernt sich selbst aus einer Klasse -----------------------
--    Zusätzlich (OR) zur Owner/Admin-Verwaltung via class_teachers_write.
drop policy if exists class_teachers_self_leave on public.class_teachers;
create policy class_teachers_self_leave on public.class_teachers for delete
  using (teacher_id = auth.uid());

-- 3) Klasse übergeben: neue Lehrkraft wird Eigentümer, alte wird Co-Lehrkraft --
--    Nur die aktuelle Eigentümer-Lehrkraft (oder ein Admin) darf übergeben.
create or replace function public.transfer_class(p_class uuid, p_new_owner uuid)
returns void language plpgsql security definer set search_path = public as $$
declare old_owner uuid;
begin
  if not public.is_class_owner(p_class) then
    raise exception 'Nur die Eigentuemer-Lehrkraft (oder Admin) darf eine Klasse uebergeben';
  end if;
  if not exists (select 1 from public.profiles where id = p_new_owner and role = 'teacher') then
    raise exception 'Eine Klasse kann nur an eine Lehrkraft uebergeben werden';
  end if;
  select teacher_id into old_owner from public.classes where id = p_class;
  if old_owner is null then raise exception 'Klasse nicht gefunden'; end if;
  if old_owner = p_new_owner then return; end if;          -- bereits Eigentümer
  -- Eigentümer wechseln
  update public.classes set teacher_id = p_new_owner where id = p_class;
  -- die neue Eigentümer-Lehrkraft ist keine Co-Lehrkraft mehr
  delete from public.class_teachers where class_id = p_class and teacher_id = p_new_owner;
  -- die bisherige Eigentümer-Lehrkraft wird Co-Lehrkraft
  insert into public.class_teachers (class_id, teacher_id)
       values (p_class, old_owner)
  on conflict (class_id, teacher_id) do nothing;
end $$;
grant execute on function public.transfer_class(uuid, uuid) to authenticated;

-- Fertig ✅  (Phase I – Lehrer-Sandbox, Co-Lehrer-Austritt, Klassen-Übergabe)
