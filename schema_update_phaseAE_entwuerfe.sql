-- ============================================================================
--  Informatik am Gymnasium Wesermünde · Schema-Update Phase AE
--  Entwürfe für Lehrkräfte sichtbar machen
-- ----------------------------------------------------------------------------
--  Die Tabellen hamster_drafts / sql_drafts / filius_drafts gibt es seit
--  Phase AB - bisher durfte sie nur die Schülerin / der Schüler selbst lesen.
--
--  Neu: Die Lehrkräfte der Klasse dürfen die Entwürfe LESEN (nicht ändern).
--  Damit zeigt die Abgabe-Matrix schon an, wer eine Aufgabe angefangen hat,
--  und die Lehrkraft kann den Zwischenstand ansehen, bevor abgegeben wurde.
--
--  Dieses Skript ist beliebig oft ausführbar und fasst KEINE Daten an -
--  es legt ausschließlich Leserechte an.
-- ============================================================================

-- Lehrkräfte der Klasse (Eigentümer und Co-Lehrkräfte über is_class_teacher)
drop policy if exists hamsterdraft_teacher_read on public.hamster_drafts;
create policy hamsterdraft_teacher_read on public.hamster_drafts for select
  using (exists (select 1 from public.assignments a
                  where a.id = assignment_id
                    and public.is_class_teacher(a.class_id)));

drop policy if exists sqldraft_teacher_read on public.sql_drafts;
create policy sqldraft_teacher_read on public.sql_drafts for select
  using (exists (select 1 from public.sql_assignments a
                  where a.id = assignment_id
                    and public.is_class_teacher(a.class_id)));

drop policy if exists filiusdraft_teacher_read on public.filius_drafts;
create policy filiusdraft_teacher_read on public.filius_drafts for select
  using (exists (select 1 from public.filius_assignments a
                  where a.id = assignment_id
                    and public.is_class_teacher(a.class_id)));

-- ============================================================================
--  Selbstprüfung
-- ============================================================================
do $$
declare fehlt text := '';
begin
  if not exists (select 1 from pg_policies where schemaname='public'
                  and tablename='hamster_drafts' and policyname='hamsterdraft_teacher_read')
    then fehlt := fehlt || ' hamsterdraft_teacher_read'; end if;
  if not exists (select 1 from pg_policies where schemaname='public'
                  and tablename='sql_drafts' and policyname='sqldraft_teacher_read')
    then fehlt := fehlt || ' sqldraft_teacher_read'; end if;
  if not exists (select 1 from pg_policies where schemaname='public'
                  and tablename='filius_drafts' and policyname='filiusdraft_teacher_read')
    then fehlt := fehlt || ' filiusdraft_teacher_read'; end if;
  if fehlt <> '' then
    raise exception 'Phase AE unvollstaendig, es fehlt:%', fehlt;
  end if;
  raise notice 'Phase AE vollstaendig: Lehrkraefte koennen Entwuerfe ihrer Klassen lesen.';
end $$;
