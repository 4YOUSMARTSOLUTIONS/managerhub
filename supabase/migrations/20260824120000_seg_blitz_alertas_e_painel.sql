-- O ciclo da não conformidade e o painel da blitz.
--
-- ALERTA AUTOMÁTICO: blitz não conforme cria a linha do alerta e notifica o
-- gestor DA ÉPOCA (snap_manager_id) na mesma transação da RPC de criar. É a
-- "sinalização automática" pedida: nenhum clique extra da segurança.
--
-- TRATATIVA: só o gestor alertado registra (justificativa, orientação,
-- diálogo). Preencher no lugar dele transformaria o indicador em ficção.
-- Mesmo desenho de seg_alertas/seg_abordagens.
--
-- PAINEL: uma RPC só (molde seg_dashboard), incluindo a RECORRÊNCIA por
-- colaborador, que era o indicador pedido: quantas vezes cada um saiu não
-- conforme no ano. A recorrência nominal sai completa para gerência, admin,
-- owner e segurança; para team_lead a própria RPC recorta pela cadeia
-- (my_managed_memberships), então o gestor vê a recorrência DA EQUIPE DELE
-- sem enxergar o resto da empresa.

create table public.seg_blitz_alertas (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  avaliacao_id     uuid not null references public.seg_blitz_avaliacoes(id) on delete cascade,
  gestor_id        uuid not null references public.profiles(id) on delete cascade,
  enviado_em       timestamptz not null default now(),
  tratativa_em     date,
  tratativa_resumo text,
  tratativa_acordo text,
  registrada_em    timestamptz,
  constraint seg_blitz_alerta_unico unique (avaliacao_id),
  constraint seg_blitz_alerta_completo check ((registrada_em is null) = (tratativa_em is null))
);
create index seg_blitz_alertas_gestor_idx on public.seg_blitz_alertas (gestor_id, enviado_em desc);
create index seg_blitz_alertas_tenant_idx on public.seg_blitz_alertas (tenant_id, enviado_em desc);

alter table public.seg_blitz_alertas enable row level security;

-- o gestor lê o próprio alerta; quem trata segurança lê todos, para cobrar
create policy seg_blitz_alertas_select on public.seg_blitz_alertas
  for select using (
    gestor_id = (select auth.uid())
    or public.pode_tratar_seguranca(tenant_id)
  );

-- escrita só por RPC: sem policy de insert/update, o PostgREST não alcança
revoke all on table public.seg_blitz_alertas from public, anon, authenticated;
grant  select on table public.seg_blitz_alertas to authenticated;

drop trigger if exists audit_seg_blitz_alertas on public.seg_blitz_alertas;
create trigger audit_seg_blitz_alertas after insert or update or delete on public.seg_blitz_alertas
  for each row execute function public.audit_trigger();

/**
 * seg_criar_blitz ganha o fecho do ciclo: não conforme cria alerta + notifica.
 * Recriada por replace da definição no catálogo? Não: o corpo é curto e o
 * arquivo carrega a versão completa. A mudança está no bloco final.
 */
create or replace function public.seg_criar_blitz(p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant   uuid := public.my_active_tenant();
  v_user     uuid := nullif(p_data->>'user_id', '')::uuid;
  v_meio     record;
  v_ocorrido date := nullif(p_data->>'occurred_on', '')::date;
  v_liberado boolean := coalesce((p_data->>'liberado')::boolean, true);
  v_motivo   uuid := nullif(p_data->>'motivo_bloqueio_id', '')::uuid;
  v_placa    text := upper(regexp_replace(coalesce(p_data->>'placa', ''), '[^A-Za-z0-9]', '', 'g'));
  v_tipo     text := nullif(btrim(coalesce(p_data->>'veiculo_tipo', '')), '');
  v_prop     public.seg_veiculo_propriedade;
  v_veiculo  uuid;
  v_conforme boolean;
  v_id       uuid;
  v_av       record;
  r          jsonb;
  v_pergunta record;
begin
  if v_tenant is null then
    raise exception 'Você não tem acesso a esta empresa.';
  end if;
  if not public.pode_avaliar_blitz(v_tenant) then
    raise exception 'Só gestores e a equipe de segurança avaliam a blitz.';
  end if;

  if v_ocorrido is null then
    raise exception 'Informe a data da blitz.';
  end if;
  if not exists (
    select 1 from public.memberships m
     where m.user_id = v_user and m.tenant_id = v_tenant and m.is_active
  ) then
    raise exception 'Escolha um colaborador válido.';
  end if;

  select m.* into v_meio
    from public.seg_blitz_meios m
   where m.id = nullif(p_data->>'meio_id', '')::uuid and m.tenant_id = v_tenant and m.active;
  if v_meio.id is null then
    raise exception 'Escolha o meio de transporte.';
  end if;

  if not v_liberado and v_motivo is null then
    raise exception 'Bloqueio precisa de um motivo.';
  end if;
  if v_motivo is not null and not exists (
    select 1 from public.seg_blitz_motivos x where x.id = v_motivo and x.tenant_id = v_tenant
  ) then
    raise exception 'Motivo de bloqueio inválido.';
  end if;

  v_conforme := v_liberado and not exists (
    select 1 from jsonb_array_elements(coalesce(p_data->'respostas', '[]'::jsonb)) x
     where x->>'resposta' = 'nao'
  );

  if v_meio.tem_veiculo and v_placa <> '' then
    v_prop := coalesce(nullif(p_data->>'propriedade', ''), 'proprio')::public.seg_veiculo_propriedade;
    insert into public.seg_veiculos (tenant_id, user_id, meio_id, placa, tipo_descricao, propriedade)
    values (v_tenant, v_user, v_meio.id, v_placa, v_tipo, v_prop)
    on conflict (tenant_id, placa) do update
      set user_id = excluded.user_id,
          meio_id = excluded.meio_id,
          tipo_descricao = coalesce(excluded.tipo_descricao, seg_veiculos.tipo_descricao),
          propriedade = excluded.propriedade,
          active = true
    returning id into v_veiculo;
  else
    v_placa := null;
    v_tipo := null;
    v_prop := null;
  end if;

  insert into public.seg_blitz_avaliacoes (
    tenant_id, occurred_on, user_id, meio_id, veiculo_id,
    placa, veiculo_tipo, propriedade,
    liberado, motivo_bloqueio_id, observacao, conforme, created_by
  ) values (
    v_tenant, v_ocorrido, v_user, v_meio.id, v_veiculo,
    v_placa, v_tipo, v_prop,
    v_liberado, case when v_liberado then null else v_motivo end,
    nullif(btrim(coalesce(p_data->>'observacao', '')), ''),
    v_conforme, (select auth.uid())
  )
  returning * into v_av;
  v_id := v_av.id;

  for r in select * from jsonb_array_elements(coalesce(p_data->'respostas', '[]'::jsonb))
  loop
    select q.id, q.name into v_pergunta
      from public.seg_blitz_perguntas q
     where q.id = nullif(r->>'pergunta_id', '')::uuid and q.tenant_id = v_tenant;
    if v_pergunta.id is null then
      continue;
    end if;
    insert into public.seg_blitz_respostas (avaliacao_id, tenant_id, pergunta_id, snap_pergunta, resposta)
    values (v_id, v_tenant, v_pergunta.id, v_pergunta.name, (r->>'resposta')::public.seg_blitz_resposta)
    on conflict (avaliacao_id, pergunta_id) do nothing;
  end loop;

  -- o fecho do ciclo: não conforme aciona o gestor DA ÉPOCA automaticamente
  if not v_conforme and v_av.snap_manager_id is not null then
    insert into public.seg_blitz_alertas (tenant_id, avaliacao_id, gestor_id)
    values (v_tenant, v_id, v_av.snap_manager_id)
    on conflict (avaliacao_id) do nothing;

    perform public.notify_users(
      v_tenant, array[v_av.snap_manager_id], 'seg_blitz_alerta',
      'Blitz de trajeto não conforme na sua equipe',
      coalesce(v_av.snap_full_name, 'Um colaborador') || ' saiu ' ||
      case when v_liberado then 'liberado com desvio' else 'bloqueado' end ||
      ' na blitz de ' || to_char(v_ocorrido, 'DD/MM/YYYY') ||
      '. Converse com a pessoa e registre a tratativa.',
      null
    );
  end if;

  return v_id;
end;
$$;

revoke execute on function public.seg_criar_blitz(jsonb) from public, anon;
grant  execute on function public.seg_criar_blitz(jsonb) to authenticated;

/** Os alertas do gestor logado, com os dados da blitz projetados coluna a coluna. */
create or replace function public.seg_blitz_meus_alertas()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(x order by x->>'enviado_em' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', al.id,
      'enviado_em', al.enviado_em,
      'colaborador', a.snap_full_name,
      'occurred_on', a.occurred_on,
      'meio', m.name,
      'liberado', a.liberado,
      'motivo', mo.name,
      'observacao', a.observacao,
      'respostas_nao', (
        select coalesce(jsonb_agg(r.snap_pergunta), '[]'::jsonb)
          from public.seg_blitz_respostas r
         where r.avaliacao_id = a.id and r.resposta = 'nao'
      ),
      'tratativa_em', al.tratativa_em,
      'tratativa_resumo', al.tratativa_resumo,
      'tratativa_acordo', al.tratativa_acordo
    ) as x
    from public.seg_blitz_alertas al
    join public.seg_blitz_avaliacoes a on a.id = al.avaliacao_id
    left join public.seg_blitz_meios m on m.id = a.meio_id
    left join public.seg_blitz_motivos mo on mo.id = a.motivo_bloqueio_id
    where al.gestor_id = (select auth.uid())
    order by al.enviado_em desc
    limit 200
  ) s;
$$;

revoke execute on function public.seg_blitz_meus_alertas() from public, anon;
grant  execute on function public.seg_blitz_meus_alertas() to authenticated;

/** O gestor registra a tratativa; a segurança é avisada do fecho. */
create or replace function public.seg_blitz_registrar_tratativa(
  p_alerta uuid,
  p_em date,
  p_resumo text,
  p_acordo text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_a      record;
  v_resumo text := btrim(coalesce(p_resumo, ''));
  v_avisar uuid[];
begin
  select al.* into v_a from public.seg_blitz_alertas al where al.id = p_alerta;
  if v_a.id is null then
    raise exception 'Alerta não encontrado.';
  end if;
  if v_a.gestor_id <> (select auth.uid()) then
    raise exception 'Só o gestor que recebeu o alerta registra a tratativa.';
  end if;
  if p_em is null then
    raise exception 'Informe a data da conversa.';
  end if;
  if p_em > current_date then
    raise exception 'A data da conversa não pode estar no futuro.';
  end if;
  if v_resumo = '' then
    raise exception 'Escreva o que foi tratado.';
  end if;

  update public.seg_blitz_alertas
     set tratativa_em = p_em,
         tratativa_resumo = v_resumo,
         tratativa_acordo = nullif(btrim(coalesce(p_acordo, '')), ''),
         registrada_em = now()
   where id = p_alerta;

  select array_agg(distinct uid) into v_avisar from (
    select e.user_id as uid from public.seg_equipe e where e.tenant_id = v_a.tenant_id
    union
    select m.user_id from public.memberships m
     where m.tenant_id = v_a.tenant_id and m.role in ('owner', 'admin') and m.is_active
  ) todos;

  if v_avisar is not null then
    perform public.notify_users(
      v_a.tenant_id, v_avisar, 'seg_blitz_tratativa',
      'Tratativa de blitz registrada',
      'O gestor alertado registrou a tratativa da blitz em ' || to_char(p_em, 'DD/MM/YYYY') || '.',
      null
    );
  end if;
end;
$$;

revoke execute on function public.seg_blitz_registrar_tratativa(uuid, date, text, text) from public, anon;
grant  execute on function public.seg_blitz_registrar_tratativa(uuid, date, text, text) to authenticated;

/**
 * O painel da blitz, agregado numa RPC só (molde seg_dashboard).
 *
 * A recorrência nominal: completa para gerência/admin/owner/segurança; para
 * team_lead, recortada pela cadeia via my_managed_memberships. Para quem não é
 * nada disso, vazia.
 */
create or replace function public.seg_blitz_painel(p_ano integer, p_unit_ids uuid[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := public.my_active_tenant();
  v_de   date;
  v_ate  date;
  v_out  jsonb;
  v_amplo boolean;
  v_lider boolean;
begin
  if v_tenant is null or not public.is_tenant_member(v_tenant) then
    raise exception 'Você não tem acesso a esta empresa.';
  end if;

  v_de  := make_date(p_ano, 1, 1);
  v_ate := make_date(p_ano, 12, 31);
  v_amplo := public.has_tenant_role(v_tenant, '{owner,admin,manager}'::public.member_role[])
          or public.pode_tratar_seguranca(v_tenant);
  v_lider := public.has_tenant_role(v_tenant, '{team_lead}'::public.member_role[]);

  with blitz as (
    select a.*
      from public.seg_blitz_avaliacoes a
     where a.tenant_id = v_tenant
       and a.occurred_on between v_de and v_ate
       and (p_unit_ids is null or a.snap_unit_id = any(p_unit_ids) or a.snap_unit_id is null)
  )
  select jsonb_build_object(
    'ano', p_ano,
    'total',         (select count(*) from blitz),
    'conformes',     (select count(*) from blitz where conforme),
    'com_desvio',    (select count(*) from blitz where liberado and not conforme),
    'bloqueios',     (select count(*) from blitz where not liberado),
    'colaboradores', (select count(distinct user_id) from blitz),
    'mensal', (
      select jsonb_agg(jsonb_build_object(
        'mes', m,
        'total',        (select count(*) from blitz b where extract(month from b.occurred_on) = m),
        'nao_conformes',(select count(*) from blitz b where extract(month from b.occurred_on) = m and not b.conforme)
      ) order by m)
      from generate_series(1, 12) as m
    ),
    'por_meio', (
      select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'total', n, 'nao_conformes', nc) order by n desc), '[]'::jsonb)
      from (
        select coalesce(mm.name, 'Sem meio') as nome, count(*) as n,
               count(*) filter (where not b.conforme) as nc
          from blitz b
          left join public.seg_blitz_meios mm on mm.id = b.meio_id
         group by 1
      ) x
    ),
    'por_motivo', (
      select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'total', n) order by n desc), '[]'::jsonb)
      from (
        select mo.name as nome, count(*) as n
          from blitz b
          join public.seg_blitz_motivos mo on mo.id = b.motivo_bloqueio_id
         group by 1
      ) x
    ),
    'alertas', (
      select jsonb_build_object(
        'enviados', count(*),
        'com_tratativa', count(*) filter (where al.registrada_em is not null)
      )
      from public.seg_blitz_alertas al
      join blitz b on b.id = al.avaliacao_id
    ),
    'recorrencia', (
      case
        when v_amplo then (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'user_id', user_id, 'nome', nome, 'setor', setor,
                   'nao_conformes', nc, 'total', n) order by nc desc, nome), '[]'::jsonb)
          from (
            select b.user_id, max(b.snap_full_name) as nome, max(b.snap_department_name) as setor,
                   count(*) filter (where not b.conforme) as nc, count(*) as n
              from blitz b
             group by b.user_id
            having count(*) filter (where not b.conforme) > 0
             order by nc desc
             limit 20
          ) x
        )
        when v_lider then (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'user_id', user_id, 'nome', nome, 'setor', setor,
                   'nao_conformes', nc, 'total', n) order by nc desc, nome), '[]'::jsonb)
          from (
            select b.user_id, max(b.snap_full_name) as nome, max(b.snap_department_name) as setor,
                   count(*) filter (where not b.conforme) as nc, count(*) as n
              from blitz b
              join public.my_managed_memberships() eq
                on eq.user_id = b.user_id and eq.tenant_id = v_tenant
             group by b.user_id
            having count(*) filter (where not b.conforme) > 0
             order by nc desc
             limit 20
          ) x
        )
        else '[]'::jsonb
      end
    )
  ) into v_out;

  return v_out;
end;
$$;

revoke execute on function public.seg_blitz_painel(integer, uuid[]) from public, anon;
grant  execute on function public.seg_blitz_painel(integer, uuid[]) to authenticated;

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
