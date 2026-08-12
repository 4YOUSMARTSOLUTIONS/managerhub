-- A trilha vira matrícula, e continua verdadeira quando a pessoa se move.
--
-- Função SEPARADA da materialização do curso, e não um remendo dentro dela: a
-- pergunta "quem saiu do escopo" tem respostas diferentes. No curso, saiu quem
-- a matriz do curso não alcança mais. Na trilha, saiu também quem continua no
-- alcance mas cujo programa foi desativado, cujo passo foi removido da trilha,
-- ou cujo curso saiu do ar. Misturar as duas obrigaria cada cláusula a saber da
-- outra.
--
-- CRIA TODAS AS MATRÍCULAS DE UMA VEZ, e não uma por vez conforme a pessoa
-- avança. Com todas criadas, a pendência do programa inteiro existe e é
-- auditável desde o dia da atribuição, o colaborador vê o caminho completo, e
-- nenhum job precisa "abrir o próximo passo" quando alguém conclui. O bloqueio
-- do que ainda não pode ser feito é DERIVADO na leitura (leva seguinte), no
-- mesmo espírito de `atrasado`/`a_vencer`/`vencido`: estado que um job precisa
-- manter é estado que uma falha do job deixa mentindo.
--
-- PRAZO ÚNICO: todos os passos herdam `prazo_dias` da trilha, contado da
-- atribuição. A data que a empresa cobra é a do programa ("integração completa
-- em 30 dias"); fatiar por passo criaria atraso intermediário mesmo quando o
-- total ainda cabe. Sem prazo na trilha, cada passo cai no prazo do curso.

create or replace function public.trilha_materialize_exec(
  p_tenant uuid,
  p_path uuid default null,
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

  -- (1) quem está no alcance de uma trilha ativa, passo a passo
  with alvo as (
    select distinct
      s.training_id,
      s.path_id,
      m.user_id,
      r.mandatory,
      coalesce(p.prazo_dias, t.prazo_dias) as prazo_dias,
      m.position_id, m.department_id, m.subdepartment_id,
      (select mu.unit_id from public.membership_units mu
        where mu.membership_id = m.id order by mu.unit_id limit 1) as unit_id
    from public.training_path_rules r
    join public.training_paths p on p.id = r.path_id
    join public.training_path_steps s on s.path_id = p.id
    join public.trainings t on t.id = s.training_id
    join public.memberships m on m.tenant_id = p.tenant_id
    where p.tenant_id = p_tenant
      and p.active and p.deleted_at is null
      and t.active and t.deleted_at is null
      and r.active
      and (p_path is null or p.id = p_path)
      and (p_user is null or m.user_id = p_user)
      -- desligado não recebe programa novo
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
      tenant_id, training_id, user_id, path_id, cycle_no, origin, status, mandatory, due_at,
      snap_position_id, snap_department_id, snap_subdepartment_id, snap_unit_id
    )
    select
      p_tenant, a.training_id, a.user_id, a.path_id, 1, 'trilha', 'nao_iniciado', a.mandatory,
      case when a.prazo_dias is not null then (current_date + a.prazo_dias) end,
      a.position_id, a.department_id, a.subdepartment_id, a.unit_id
    from alvo a
    -- Quem já tem matrícula viva DAQUELE CURSO não ganha outra, venha ela de
    -- onde vier. É isto que faz o curso já concluído avulso valer como passo
    -- cumprido, e o que evita duplicata quando o curso também tem regra própria.
    where not exists (
      select 1 from public.training_enrollments e
       where e.training_id = a.training_id
         and e.user_id = a.user_id
         and e.status not in ('cancelado', 'nao_aplicavel')
    )
    returning 1
  )
  select count(*) into v_criadas from nova;

  -- (2) o que deixou de ser devido: a pessoa saiu do alcance das regras, ou a
  -- trilha foi desativada, ou o passo saiu dela, ou o curso saiu do ar. Só
  -- alcança o que ainda NÃO foi iniciado: quem já começou ou concluiu guarda o
  -- registro, porque apagar o que a pessoa fez é o oposto de guardar evidência.
  update public.training_enrollments e
     set status = 'nao_aplicavel', applicable = false, updated_at = now()
   where e.tenant_id = p_tenant
     and e.status = 'nao_iniciado'
     and e.origin = 'trilha'
     and e.path_id is not null
     and (p_path is null or e.path_id = p_path)
     and (p_user is null or e.user_id = p_user)
     and not exists (
       select 1
         from public.training_path_rules r
         join public.training_paths p on p.id = r.path_id
         join public.training_path_steps s on s.path_id = p.id and s.training_id = e.training_id
         join public.trainings t on t.id = s.training_id
         join public.memberships m on m.tenant_id = p.tenant_id and m.user_id = e.user_id
        where r.path_id = e.path_id
          and r.active
          and p.active and p.deleted_at is null
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

revoke execute on function public.trilha_materialize_exec(uuid, uuid, uuid) from public, anon, authenticated;

/**
 * Porta do app.
 *
 * Aceita trilha já excluída de propósito: `deleteTrilha` marca o soft delete e
 * chama isto em seguida, e é essa chamada que recolhe as matrículas não
 * iniciadas do programa que deixou de existir.
 */
create or replace function public.trilha_materialize(p_path uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.training_paths where id = p_path;
  if v_tenant is null then raise exception 'Trilha não encontrada'; end if;
  if not public.pode_gerir_trilha(p_path) then
    raise exception 'Sem permissão para gerir esta trilha';
  end if;
  return public.trilha_materialize_exec(v_tenant, p_path, null);
end;
$$;

revoke execute on function public.trilha_materialize(uuid) from public, anon;
grant execute on function public.trilha_materialize(uuid) to authenticated;

-- Mudou o vínculo, muda também o que o PROGRAMA cobra. Mesmo trigger diferido
-- que já existe: só somamos a chamada da trilha ao corpo.
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
  perform public.trilha_materialize_exec(v_tenant, null, v_user);
  return null;
end;
$$;

revoke execute on function public.training_on_membership_change() from public, anon, authenticated;

-- Fechamento diário: a trilha entra no mesmo laço por empresa, dentro do mesmo
-- begin/exception, para um dado ruim de um cliente não derrubar o fechamento
-- dos outros.
create or replace function public.training_fechamento_diario()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_total integer := 0;
  t record;
begin
  for t in select id from public.tenants where status = 'active' loop
    begin
      v_total := v_total + coalesce(public.training_materialize_exec(t.id), 0);
      v_total := v_total + coalesce(public.trilha_materialize_exec(t.id), 0);
    exception when others then
      raise warning 'materializacao de treinamentos falhou no tenant %: %', t.id, sqlerrm;
    end;
  end loop;

  v_total := v_total + coalesce(public.training_recertificar(), 0);
  perform public.training_avisos();
  return v_total;
end;
$$;

revoke execute on function public.training_fechamento_diario() from public, anon, authenticated;

do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_n <> 0 then
    raise exception 'ha % funcoes SECURITY DEFINER alcancaveis por anon', v_n;
  end if;
end $$;

notify pgrst, 'reload schema';
