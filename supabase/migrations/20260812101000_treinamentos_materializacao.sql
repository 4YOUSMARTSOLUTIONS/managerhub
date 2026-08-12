-- Treinamentos: a matriz vira matrícula, e continua verdadeira quando a pessoa
-- se move.
--
-- Atribuição ESTÁTICA é a armadilha clássica de LMS: a pessoa muda de cargo e
-- continua devendo o treinamento antigo, sem receber o novo. Aqui a matriz é
-- reavaliada em três momentos: ao salvar o curso ou as regras, quando o vínculo
-- do colaborador muda (trigger) e no fechamento diário (leva 5).
--
-- Duas invariantes que o corpo respeita:
--
--   1. Quem SAI do escopo nunca perde histórico. A matrícula ainda não iniciada
--      vira `nao_aplicavel`; a que já começou ou concluiu fica intocada, porque
--      apagar o que a pessoa fez é o oposto de guardar evidência.
--   2. Quem ENTRA no escopo ganha matrícula com o vínculo CARIMBADO (cargo,
--      setor, subsetor, unidade). O relatório de um ciclo antigo mostra o que
--      valia na época, e não o organograma de hoje.
--
-- A função de trabalho não tem guarda e é revogada de `authenticated`: quem a
-- chama é a RPC pública (com guarda), o trigger e o cron. A guarda mora na
-- porta, não na engrenagem.

create or replace function public.training_materialize_exec(
  p_tenant uuid,
  p_training uuid default null,
  p_user uuid default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_criadas integer := 0;
begin
  if p_tenant is null then return 0; end if;

  -- (1) quem está no escopo agora, por regra ativa de curso ativo
  with alvo as (
    select distinct
      t.id as training_id,
      m.user_id,
      r.mandatory,
      t.prazo_dias,
      m.position_id, m.department_id, m.subdepartment_id,
      (select mu.unit_id from public.membership_units mu
        where mu.membership_id = m.id order by mu.unit_id limit 1) as unit_id
    from public.training_assignment_rules r
    join public.trainings t on t.id = r.training_id
    join public.memberships m on m.tenant_id = t.tenant_id
    where t.tenant_id = p_tenant
      and t.active and t.deleted_at is null
      and r.active
      and (p_training is null or t.id = p_training)
      and (p_user is null or m.user_id = p_user)
      -- desligado não recebe treinamento novo
      and m.is_active and m.dismissed_at is null
      and (
        (r.kind = 'user' and r.ref_id = m.user_id)
        or (r.kind = 'position' and r.ref_id = m.position_id)
        or (r.kind = 'department' and r.ref_id = m.department_id)
        or (r.kind = 'subdepartment' and r.ref_id = m.subdepartment_id)
        or (r.kind = 'unit' and exists (
              select 1 from public.membership_units mu
               where mu.membership_id = m.id and mu.unit_id = r.ref_id))
      )
  ),
  nova as (
    insert into public.training_enrollments (
      tenant_id, training_id, user_id, cycle_no, origin, status, mandatory, due_at,
      snap_position_id, snap_department_id, snap_subdepartment_id, snap_unit_id
    )
    select
      p_tenant, a.training_id, a.user_id, 1, 'regra', 'nao_iniciado', a.mandatory,
      case when a.prazo_dias is not null then (current_date + a.prazo_dias) end,
      a.position_id, a.department_id, a.subdepartment_id, a.unit_id
    from alvo a
    -- só entra quem não tem NENHUMA matrícula viva deste curso: o ciclo seguinte
    -- é assunto da recertificação, não desta rotina
    where not exists (
      select 1 from public.training_enrollments e
       where e.training_id = a.training_id
         and e.user_id = a.user_id
         and e.status not in ('cancelado', 'nao_aplicavel')
    )
    returning 1
  )
  select count(*) into v_criadas from nova;

  -- (2) quem saiu do escopo (mudou de cargo/setor, saiu da unidade ou foi
  -- desligado) e ainda não começou: a cobrança para de existir, o registro não.
  update public.training_enrollments e
     set status = 'nao_aplicavel', applicable = false, updated_at = now()
   from public.trainings t
  where t.id = e.training_id
    and e.tenant_id = p_tenant
    and t.tenant_id = p_tenant
    and e.status = 'nao_iniciado'
    and e.origin = 'regra'
    and (p_training is null or e.training_id = p_training)
    and (p_user is null or e.user_id = p_user)
    and not exists (
      select 1
        from public.training_assignment_rules r
        join public.memberships m on m.tenant_id = t.tenant_id and m.user_id = e.user_id
       where r.training_id = e.training_id
         and r.active
         and t.active and t.deleted_at is null
         and m.is_active and m.dismissed_at is null
         and (
           (r.kind = 'user' and r.ref_id = m.user_id)
           or (r.kind = 'position' and r.ref_id = m.position_id)
           or (r.kind = 'department' and r.ref_id = m.department_id)
           or (r.kind = 'subdepartment' and r.ref_id = m.subdepartment_id)
           or (r.kind = 'unit' and exists (
                 select 1 from public.membership_units mu
                  where mu.membership_id = m.id and mu.unit_id = r.ref_id))
         )
    );

  return v_criadas;
end;
$$;

-- engrenagem interna: nem o app nem a chave pública alcançam
revoke execute on function public.training_materialize_exec(uuid, uuid, uuid) from public, anon, authenticated;

-- Porta do app: recalcula o curso inteiro, com guarda de quem pode geri-lo.
create or replace function public.training_materialize(p_training uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.trainings where id = p_training;
  if v_tenant is null then raise exception 'Treinamento não encontrado'; end if;
  if not public.pode_gerir_treinamento(p_training) then
    raise exception 'Sem permissão para gerir este treinamento';
  end if;
  return public.training_materialize_exec(v_tenant, p_training, null);
end;
$$;

revoke execute on function public.training_materialize(uuid) from public, anon;
grant execute on function public.training_materialize(uuid) to authenticated;

-- Mudou o vínculo, muda o que a pessoa deve.
--
-- CONSTRAINT TRIGGER DIFERIDO pelo mesmo motivo do `membership_history`: o
-- `admin_update_employee` faz UPDATE em memberships e logo depois DELETE+INSERT
-- das unidades, na mesma transação. Rodando no COMMIT, a materialização enxerga
-- o estado final uma única vez, em vez de recalcular três vezes sobre estados
-- intermediários (e criar matrícula para uma unidade que já saiu).
create or replace function public.training_on_membership_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid;
  v_user uuid;
begin
  if tg_table_name = 'memberships' then
    v_tenant := new.tenant_id; v_user := new.user_id;
  else
    select m.tenant_id, m.user_id into v_tenant, v_user
      from public.memberships m
     where m.id = coalesce(new.membership_id, old.membership_id);
  end if;
  if v_tenant is null then return null; end if;
  perform public.training_materialize_exec(v_tenant, null, v_user);
  return null;
end;
$$;

revoke execute on function public.training_on_membership_change() from public, anon, authenticated;

create constraint trigger training_membership_sync
  after insert or update on public.memberships
  deferrable initially deferred
  for each row execute function public.training_on_membership_change();

create constraint trigger training_membership_units_sync
  after insert or delete on public.membership_units
  deferrable initially deferred
  for each row execute function public.training_on_membership_change();

notify pgrst, 'reload schema';

do $$
declare n int;
begin
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if n <> 0 then raise exception 'secdef executável por anon: %', n; end if;
end $$;
