-- Blitz: primeira blitz educativa e tratativa por recorrência (LUIZ, 18/11/2026).
--
-- 1) Educativa. Parâmetro da empresa: a primeira blitz da vida de quem foi
--    contratado a partir de uma data é educativa. Ela aparece nos Registros,
--    mas fica fora de toda a conta: não abre tratativa, não avisa ninguém, não
--    entra na aderência ("passou"), na qualidade, nas principais falhas nem na
--    recorrência. A marca é CARIMBADA na blitz (`educativa`), como o
--    `conforme`: mudar o parâmetro depois não reescreve o passado.
--
-- 2) Recorrência. Abrir tratativa a cada blitz não conforme ficou massivo
--    (34 abertas, 1 tratada). Parâmetro da empresa: "a cada ocorrência" (como
--    era) ou "por recorrência", quando a pessoa chega a N blitz não conformes
--    em D dias. O bloqueio pode continuar abrindo na hora. A tratativa fica
--    ligada às blitz que contou (`seg_blitz_alerta_avaliacoes`); blitz já
--    ligada a uma tratativa não conta de novo, e por isso o contador zera
--    depois de cada uma.
--
-- A decisão de abrir tratativa mora em `seg_blitz_acionar`, e a validação da
-- blitz em `seg_blitz_validar`: a criação usa as duas hoje e a edição (próxima
-- migração) vai usar as mesmas.

-- ---------------------------------------------------------------------------
-- Parâmetros e colunas
-- ---------------------------------------------------------------------------

alter table public.seg_settings
  add column if not exists blitz_educativa_ativa boolean not null default false,
  add column if not exists blitz_educativa_desde date not null default date '2026-11-01',
  add column if not exists blitz_tratativa_modo text not null default 'ocorrencia',
  add column if not exists blitz_recorrencia_qtd integer not null default 3,
  add column if not exists blitz_recorrencia_dias integer not null default 180,
  add column if not exists blitz_bloqueio_imediato boolean not null default true;

alter table public.seg_settings
  add constraint seg_settings_blitz_modo check (blitz_tratativa_modo in ('ocorrencia', 'recorrencia')),
  add constraint seg_settings_blitz_qtd check (blitz_recorrencia_qtd between 2 and 20),
  add constraint seg_settings_blitz_dias check (blitz_recorrencia_dias between 7 and 730);

alter table public.seg_blitz_avaliacoes
  add column if not exists educativa boolean not null default false;

alter table public.seg_blitz_alertas
  add column if not exists tipo text not null default 'ocorrencia';
alter table public.seg_blitz_alertas
  add constraint seg_blitz_alertas_tipo check (tipo in ('ocorrencia', 'recorrencia'));

-- as blitz que cada tratativa cobre: uma na ocorrência, N na recorrência
create table if not exists public.seg_blitz_alerta_avaliacoes (
  alerta_id uuid not null references public.seg_blitz_alertas(id) on delete cascade,
  avaliacao_id uuid not null references public.seg_blitz_avaliacoes(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  primary key (alerta_id, avaliacao_id)
);
create index if not exists seg_blitz_alerta_avaliacoes_avaliacao on public.seg_blitz_alerta_avaliacoes (avaliacao_id);

alter table public.seg_blitz_alerta_avaliacoes enable row level security;
revoke all on table public.seg_blitz_alerta_avaliacoes from public, anon, authenticated;
grant select on table public.seg_blitz_alerta_avaliacoes to authenticated;
-- quem vê a tratativa vê as blitz dela (a RLS de seg_blitz_alertas vale na subconsulta)
create policy seg_blitz_alerta_avaliacoes_select on public.seg_blitz_alerta_avaliacoes
  for select to authenticated
  using (alerta_id in (select al.id from public.seg_blitz_alertas al));

-- as tratativas de hoje são todas de ocorrência: cada uma cobre a própria blitz
insert into public.seg_blitz_alerta_avaliacoes (alerta_id, avaliacao_id, tenant_id)
select al.id, al.avaliacao_id, al.tenant_id from public.seg_blitz_alertas al
on conflict do nothing;

create index if not exists seg_blitz_avaliacoes_pessoa on public.seg_blitz_avaliacoes (tenant_id, user_id, occurred_on);

-- ---------------------------------------------------------------------------
-- Helpers internos (só outras funções chamam)
-- ---------------------------------------------------------------------------

-- A primeira blitz da vida de quem entrou depois da data, com o parâmetro
-- ligado. `p_ignorar`: a própria blitz, na edição.
create or replace function public.seg_blitz_eh_primeira_educativa(p_tenant uuid, p_user uuid, p_ignorar uuid default null)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce((
    select s.blitz_educativa_ativa
       and m.admission_date is not null
       and m.admission_date >= s.blitz_educativa_desde
       and not exists (
         select 1 from public.seg_blitz_avaliacoes a
          where a.tenant_id = p_tenant and a.user_id = p_user
            and a.id is distinct from p_ignorar
       )
      from public.memberships m
      join public.seg_settings s on s.tenant_id = m.tenant_id
     where m.tenant_id = p_tenant and m.user_id = p_user
  ), false);
$function$;

-- Confere e normaliza os dados da blitz; devolve o que vai para a linha.
-- Na edição, `p_user_atual` e `p_meio_atual` são os da blitz: manter a mesma
-- pessoa passa mesmo se ela saiu depois, e o mesmo meio, mesmo se desativado.
create or replace function public.seg_blitz_validar(p_tenant uuid, p_data jsonb, p_user_atual uuid default null, p_meio_atual uuid default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_user     uuid := nullif(p_data->>'user_id', '')::uuid;
  v_meio     record;
  v_liberado boolean := coalesce((p_data->>'liberado')::boolean, true);
  v_motivo   uuid := nullif(p_data->>'motivo_bloqueio_id', '')::uuid;
  v_placa    text := upper(regexp_replace(coalesce(p_data->>'placa', ''), '[^A-Za-z0-9]', '', 'g'));
  v_tipo     text := nullif(btrim(coalesce(p_data->>'veiculo_tipo', '')), '');
  v_cor      text := nullif(lower(btrim(coalesce(p_data->>'cor', ''))), '');
  v_prop     public.seg_veiculo_propriedade;
begin
  if v_user is null
     or (v_user is distinct from p_user_atual and not exists (
           select 1 from public.memberships m
            where m.user_id = v_user and m.tenant_id = p_tenant and m.is_active
         )) then
    raise exception 'Escolha um colaborador válido.';
  end if;

  select m.* into v_meio
    from public.seg_blitz_meios m
   where m.id = nullif(p_data->>'meio_id', '')::uuid and m.tenant_id = p_tenant
     and (m.active or m.id = p_meio_atual);
  if v_meio.id is null then
    raise exception 'Escolha o meio de transporte.';
  end if;

  if not v_liberado and v_motivo is null then
    raise exception 'Bloqueio precisa de um motivo.';
  end if;
  if v_motivo is not null and not exists (
    select 1 from public.seg_blitz_motivos x where x.id = v_motivo and x.tenant_id = p_tenant
  ) then
    raise exception 'Motivo de bloqueio inválido.';
  end if;

  if v_meio.tem_veiculo then
    -- tudo obrigatório quando há veículo (LUIZ, 10/11/2026)
    if v_placa = '' then
      raise exception 'Informe a placa do veículo.';
    end if;
    if v_tipo is null then
      raise exception 'Informe o modelo do veículo.';
    end if;
    if nullif(p_data->>'propriedade', '') is null then
      raise exception 'Informe a propriedade do veículo.';
    end if;
    if v_cor is null or v_cor not in ('branco', 'preto', 'prata', 'cinza', 'vermelho', 'azul', 'outra') then
      raise exception 'Informe a cor do veículo.';
    end if;
    v_prop := (p_data->>'propriedade')::public.seg_veiculo_propriedade;
  else
    v_placa := null;
    v_tipo := null;
    v_prop := null;
    v_cor := null;
  end if;

  return jsonb_build_object(
    'user_id', v_user,
    'meio_id', v_meio.id,
    'tem_veiculo', v_meio.tem_veiculo,
    'liberado', v_liberado,
    'motivo_bloqueio_id', case when v_liberado then null else v_motivo end,
    'placa', v_placa,
    'veiculo_tipo', v_tipo,
    'propriedade', v_prop,
    'cor', v_cor,
    'observacao', nullif(btrim(coalesce(p_data->>'observacao', '')), ''),
    -- conforme: liberado e nenhuma resposta "não"
    'conforme', v_liberado and not exists (
      select 1 from jsonb_array_elements(coalesce(p_data->'respostas', '[]'::jsonb)) x
       where x->>'resposta' = 'nao'
    )
  );
end;
$function$;

-- O "lembrar da última blitz": o veículo vai para o cadastro (upsert pela placa).
create or replace function public.seg_blitz_gravar_veiculo(p_tenant uuid, p_v jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if not coalesce((p_v->>'tem_veiculo')::boolean, false) then
    return null;
  end if;
  insert into public.seg_veiculos (tenant_id, user_id, meio_id, placa, tipo_descricao, propriedade, cor)
  values (p_tenant, (p_v->>'user_id')::uuid, (p_v->>'meio_id')::uuid, p_v->>'placa', p_v->>'veiculo_tipo',
          (p_v->>'propriedade')::public.seg_veiculo_propriedade, p_v->>'cor')
  on conflict (tenant_id, placa) do update
    set user_id = excluded.user_id,
        meio_id = excluded.meio_id,
        tipo_descricao = excluded.tipo_descricao,
        propriedade = excluded.propriedade,
        cor = excluded.cor,
        active = true
  returning id into v_id;
  return v_id;
end;
$function$;

-- As respostas, com o texto da pergunta carimbado (`snap_pergunta`).
create or replace function public.seg_blitz_gravar_respostas(p_avaliacao uuid, p_tenant uuid, p_respostas jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r jsonb;
  v_pergunta record;
begin
  for r in select * from jsonb_array_elements(coalesce(p_respostas, '[]'::jsonb))
  loop
    select q.id, q.name into v_pergunta
      from public.seg_blitz_perguntas q
     where q.id = nullif(r->>'pergunta_id', '')::uuid and q.tenant_id = p_tenant;
    if v_pergunta.id is null then
      continue;
    end if;
    insert into public.seg_blitz_respostas (avaliacao_id, tenant_id, pergunta_id, snap_pergunta, resposta)
    values (p_avaliacao, p_tenant, v_pergunta.id, v_pergunta.name, (r->>'resposta')::public.seg_blitz_resposta)
    on conflict (avaliacao_id, pergunta_id) do nothing;
  end loop;
end;
$function$;

-- O fecho do ciclo: abre a tratativa da blitz não conforme pela regra da
-- empresa e avisa o gestor DA ÉPOCA. Educativa e conforme não acionam ninguém;
-- blitz já coberta por uma tratativa não abre outra; sem gestor, como sempre,
-- não há a quem acionar.
create or replace function public.seg_blitz_acionar(p_avaliacao uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_av     record;
  v_cfg    record;
  v_alerta uuid;
  v_ids    uuid[];
  v_datas  text;
  v_dias   integer;
begin
  select a.* into v_av from public.seg_blitz_avaliacoes a where a.id = p_avaliacao;
  if v_av.id is null or v_av.conforme or v_av.educativa or v_av.snap_manager_id is null then
    return;
  end if;
  if exists (select 1 from public.seg_blitz_alerta_avaliacoes l where l.avaliacao_id = p_avaliacao) then
    return;
  end if;

  select s.blitz_tratativa_modo, s.blitz_recorrencia_qtd, s.blitz_recorrencia_dias, s.blitz_bloqueio_imediato
    into v_cfg
    from public.seg_settings s where s.tenant_id = v_av.tenant_id;

  -- a cada ocorrência (o padrão), ou o bloqueio que abre na hora
  if coalesce(v_cfg.blitz_tratativa_modo, 'ocorrencia') = 'ocorrencia'
     or (not v_av.liberado and coalesce(v_cfg.blitz_bloqueio_imediato, true)) then
    insert into public.seg_blitz_alertas (tenant_id, avaliacao_id, gestor_id, tipo)
    values (v_av.tenant_id, p_avaliacao, v_av.snap_manager_id, 'ocorrencia')
    on conflict (avaliacao_id) do nothing
    returning id into v_alerta;
    if v_alerta is null then
      return;
    end if;
    insert into public.seg_blitz_alerta_avaliacoes (alerta_id, avaliacao_id, tenant_id)
    values (v_alerta, p_avaliacao, v_av.tenant_id);

    perform public.notify_users(
      v_av.tenant_id, array[v_av.snap_manager_id], 'seg_blitz_alerta',
      'Blitz de trajeto não conforme na sua equipe',
      coalesce(v_av.snap_full_name, 'Um colaborador') || ' saiu ' ||
      case when v_av.liberado then 'liberado com desvio' else 'bloqueado' end ||
      ' na blitz de ' || to_char(v_av.occurred_on, 'DD/MM/YYYY') ||
      '. Converse com a pessoa e registre a tratativa.',
      null
    );
    return;
  end if;

  -- por recorrência: as não conformes da pessoa na janela que ainda não estão
  -- em tratativa nenhuma
  v_dias := coalesce(v_cfg.blitz_recorrencia_dias, 180);
  select array_agg(a.id order by a.occurred_on, a.registrada_em),
         string_agg(to_char(a.occurred_on, 'DD/MM'), ', ' order by a.occurred_on, a.registrada_em)
    into v_ids, v_datas
    from public.seg_blitz_avaliacoes a
   where a.tenant_id = v_av.tenant_id and a.user_id = v_av.user_id
     and not a.conforme and not a.educativa
     and a.occurred_on > v_av.occurred_on - v_dias
     and not exists (select 1 from public.seg_blitz_alerta_avaliacoes l where l.avaliacao_id = a.id);

  if coalesce(array_length(v_ids, 1), 0) < coalesce(v_cfg.blitz_recorrencia_qtd, 3) then
    return;
  end if;

  insert into public.seg_blitz_alertas (tenant_id, avaliacao_id, gestor_id, tipo)
  values (v_av.tenant_id, p_avaliacao, v_av.snap_manager_id, 'recorrencia')
  on conflict (avaliacao_id) do nothing
  returning id into v_alerta;
  if v_alerta is null then
    return;
  end if;
  insert into public.seg_blitz_alerta_avaliacoes (alerta_id, avaliacao_id, tenant_id)
  select v_alerta, x, v_av.tenant_id from unnest(v_ids) x;

  perform public.notify_users(
    v_av.tenant_id, array[v_av.snap_manager_id], 'seg_blitz_alerta',
    'Recorrência na blitz de trajeto da sua equipe',
    coalesce(v_av.snap_full_name, 'Um colaborador') || ' chegou a ' || array_length(v_ids, 1) ||
    ' blitz não conformes em ' || v_dias || ' dias (' || v_datas ||
    '). Converse com a pessoa e registre a tratativa.',
    null
  );
end;
$function$;

-- As blitz que uma tratativa cobre, para a tela do gestor e a aba Alertas.
create or replace function public.seg_blitz_do_alerta(p_alerta uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id,
           'occurred_on', a.occurred_on,
           'liberado', a.liberado,
           'meio', m.name,
           'motivo', mo.name,
           'nao', (select coalesce(jsonb_agg(r.snap_pergunta order by r.snap_pergunta), '[]'::jsonb)
                     from public.seg_blitz_respostas r
                    where r.avaliacao_id = a.id and r.resposta = 'nao'))
           order by a.occurred_on, a.registrada_em), '[]'::jsonb)
    from public.seg_blitz_alerta_avaliacoes l
    join public.seg_blitz_avaliacoes a on a.id = l.avaliacao_id
    left join public.seg_blitz_meios m on m.id = a.meio_id
    left join public.seg_blitz_motivos mo on mo.id = a.motivo_bloqueio_id
   where l.alerta_id = p_alerta;
$function$;

-- ---------------------------------------------------------------------------
-- A criação, agora com a educativa e a regra de tratativa
-- ---------------------------------------------------------------------------

create or replace function public.seg_criar_blitz(p_data jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tenant    uuid := public.my_active_tenant();
  v_client    uuid := nullif(p_data->>'client_id', '')::uuid;
  v_ocorrido  date := nullif(p_data->>'occurred_on', '')::date;
  v_v         jsonb;
  v_user      uuid;
  v_veiculo   uuid;
  v_educativa boolean;
  v_id        uuid;
  v_existe    record;
  v_agora     timestamptz := now();
  v_registro  timestamptz;
  v_dia_reg   date;
  v_inicio    date;
begin
  if v_tenant is null then
    raise exception 'Você não tem acesso a esta empresa.';
  end if;
  if not public.pode_avaliar_blitz(v_tenant) then
    raise exception 'Só gestores e a equipe de segurança avaliam a blitz.';
  end if;

  -- o mesmo envio de novo: devolve a blitz gravada antes. Fica antes das
  -- conferências de propósito, porque a pessoa pode ter sido desligada entre
  -- o primeiro envio e o reenvio, e a blitz dela já está no sistema
  if v_client is not null then
    select a.id, a.tenant_id, a.created_by into v_existe
      from public.seg_blitz_avaliacoes a
     where a.client_id = v_client;
    if v_existe.id is not null then
      if v_existe.tenant_id <> v_tenant or v_existe.created_by is distinct from (select auth.uid()) then
        raise exception 'Este registro de blitz pertence a outra pessoa.';
      end if;
      return v_existe.id;
    end if;
  end if;

  if v_ocorrido is null then
    raise exception 'Informe a data da blitz.';
  end if;

  -- o momento do registro: o do aparelho, quando a blitz ficou guardada sem
  -- sinal, aceito até 3 dias para trás; fora disso (ou relógio adiantado), o
  -- do servidor
  begin
    v_registro := nullif(p_data->>'registrada_em', '')::timestamptz;
  exception when others then
    v_registro := null;
  end;
  if v_registro is null
     or v_registro < v_agora - interval '3 days'
     or v_registro > v_agora + interval '5 minutes' then
    v_registro := v_agora;
  end if;
  v_registro := least(v_registro, v_agora);
  v_dia_reg := (v_registro at time zone 'America/Sao_Paulo')::date;
  v_inicio := date_trunc('month', v_dia_reg)::date;

  if v_ocorrido > v_dia_reg then
    raise exception 'A data da blitz não pode ser depois de hoje.';
  end if;
  if v_ocorrido < v_inicio then
    raise exception 'A data da blitz precisa ser do mês do registro: de % até %.',
      to_char(v_inicio, 'DD/MM/YYYY'), to_char(v_dia_reg, 'DD/MM/YYYY');
  end if;

  v_v := public.seg_blitz_validar(v_tenant, p_data);
  v_user := (v_v->>'user_id')::uuid;

  -- uma blitz por vez por pessoa: a educativa (a primeira da vida) e a
  -- contagem da recorrência dependem das outras blitz dela
  perform pg_advisory_xact_lock(hashtextextended('seg_blitz:' || v_tenant::text || ':' || v_user::text, 0));
  v_educativa := public.seg_blitz_eh_primeira_educativa(v_tenant, v_user);

  v_veiculo := public.seg_blitz_gravar_veiculo(v_tenant, v_v);

  begin
    insert into public.seg_blitz_avaliacoes (
      tenant_id, occurred_on, user_id, meio_id, veiculo_id,
      placa, veiculo_tipo, propriedade, cor,
      liberado, motivo_bloqueio_id, observacao, conforme, educativa, created_by, client_id, registrada_em
    ) values (
      v_tenant, v_ocorrido, v_user, (v_v->>'meio_id')::uuid, v_veiculo,
      v_v->>'placa', v_v->>'veiculo_tipo', (v_v->>'propriedade')::public.seg_veiculo_propriedade, v_v->>'cor',
      (v_v->>'liberado')::boolean, (v_v->>'motivo_bloqueio_id')::uuid, v_v->>'observacao',
      (v_v->>'conforme')::boolean, v_educativa, (select auth.uid()), v_client, v_registro
    )
    returning id into v_id;
  exception when unique_violation then
    -- os dois envios chegaram juntos (o original lento e o reenvio): o outro
    -- gravou primeiro, com respostas e aviso ao gestor; este só devolve o id
    select a.id into v_id
      from public.seg_blitz_avaliacoes a
     where a.client_id = v_client and a.tenant_id = v_tenant and a.created_by = (select auth.uid());
    if v_id is null then
      raise;
    end if;
    return v_id;
  end;

  perform public.seg_blitz_gravar_respostas(v_id, v_tenant, p_data->'respostas');

  -- o fecho do ciclo, pela regra da empresa (a educativa não aciona ninguém)
  perform public.seg_blitz_acionar(v_id);

  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Leituras: a educativa fora da conta, o tipo e as blitz de cada tratativa
-- ---------------------------------------------------------------------------

-- Análises: a educativa sai de indicadores, aderência ("passou" e a última que
-- conta), qualidade, principais falhas e recorrência; vem à parte, em
-- `educativas`, para a tela dizer quantas ficaram de fora. As funções são
-- longas e mudam em trechos, então a troca é feita sobre a definição em
-- produção (e falha se algum trecho não estiver lá exatamente uma vez).
do $$
declare
  d text;
  troca record;
begin
  d := pg_get_functiondef('public.seg_blitz_analise(date,date,uuid[],boolean)'::regprocedure);
  for troca in select * from (values
    (E'  blitz as (\n    select a.*\n      from public.seg_blitz_avaliacoes a\n     where a.tenant_id = v_tenant\n',
     E'  educ as (\n    -- as educativas do recorte (LUIZ, 18/11/2026): fora de toda a conta\n    select a.*\n      from public.seg_blitz_avaliacoes a\n     where a.tenant_id = v_tenant\n       and a.educativa\n       and a.occurred_on between p_de and p_ate\n       and (p_unit_ids is null or a.snap_unit_id = any(p_unit_ids) or a.snap_unit_id is null)\n       and (v_amplo or a.user_id in (select user_id from equipe))\n       and (v_ve_topo or a.user_id not in (select user_id from topo))\n  ),\n  blitz as (\n    select a.*\n      from public.seg_blitz_avaliacoes a\n     where a.tenant_id = v_tenant\n       and not a.educativa\n'),
    (E'               and a.occurred_on between p_de and p_ate) as ultima_no_periodo,',
     E'               and a.occurred_on between p_de and p_ate and not a.educativa) as ultima_no_periodo,\n           (select max(a.occurred_on) from public.seg_blitz_avaliacoes a\n             where a.tenant_id = v_tenant and a.user_id = b.user_id\n               and a.occurred_on between p_de and p_ate and a.educativa) as educativa_no_periodo,'),
    (E'             where a.tenant_id = v_tenant and a.user_id = b.user_id) as ultima_geral',
     E'             where a.tenant_id = v_tenant and a.user_id = b.user_id and not a.educativa) as ultima_geral'),
    (E'''unidade'', unidade, ''ultima'', ultima_geral) order by nome), ''[]''::jsonb)\n                   from publico where',
     E'''unidade'', unidade, ''ultima'', ultima_geral, ''educativa'', educativa_no_periodo) order by nome), ''[]''::jsonb)\n                   from publico where'),
    (E'''passou'', ultima_no_periodo is not null, ''ultima'', ultima_geral) order by nome)',
     E'''passou'', ultima_no_periodo is not null, ''ultima'', ultima_geral, ''educativa'', educativa_no_periodo) order by nome)'),
    (E'      ''colaboradores'', (select count(distinct user_id) from blitz),\n',
     E'      ''colaboradores'', (select count(distinct user_id) from blitz),\n      ''educativas'', (select count(*) from educ),\n'),
    (E'    ''indicadores'', jsonb_build_object(\n',
     E'    -- as educativas, uma a uma, para o aviso de quantas ficaram de fora com o filtro da tela\n    ''educativas'', (select coalesce(jsonb_agg(jsonb_build_object(\n                ''id'', e.id, ''user_id'', e.user_id, ''occurred_on'', e.occurred_on, ''setor'', e.snap_department_name,\n                ''gestor'', e.snap_manager_name, ''unidade'', e.snap_unit_name, ''funcao'', e.snap_position_name)), ''[]''::jsonb)\n                from educ e),\n    ''indicadores'', jsonb_build_object(\n')
  ) t(de, para)
  loop
    if (length(d) - length(replace(d, troca.de, ''))) / length(troca.de) <> 1 then
      raise exception 'seg_blitz_analise: trecho não encontrado exatamente uma vez: %', left(troca.de, 60);
    end if;
    d := replace(d, troca.de, troca.para);
  end loop;
  execute d;

  d := pg_get_functiondef('public.seg_blitz_alertas_do_periodo(date,date,uuid[],boolean)'::regprocedure);
  if (length(d) - length(replace(d, E'             ''registrada_em'', al.registrada_em\n           ) order by', ''))) <> length(E'             ''registrada_em'', al.registrada_em\n           ) order by') then
    raise exception 'seg_blitz_alertas_do_periodo: trecho não encontrado exatamente uma vez';
  end if;
  d := replace(d,
    E'             ''registrada_em'', al.registrada_em\n           ) order by',
    E'             ''registrada_em'', al.registrada_em,\n             -- ocorrência ou recorrência, e as blitz que a tratativa cobre (LUIZ, 18/11/2026)\n             ''tipo'', al.tipo,\n             ''blitz'', public.seg_blitz_do_alerta(al.id)\n           ) order by');
  execute d;
end $$;

-- As tratativas do gestor logado, com o tipo e as blitz de cada uma.
create or replace function public.seg_blitz_meus_alertas()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(x order by x->>'enviado_em' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', al.id,
      'tipo', al.tipo,
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
      'blitz', public.seg_blitz_do_alerta(al.id),
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
$function$;

-- O aviso do formulário diz quando a última blitz foi a educativa.
create or replace function public.seg_blitz_ultima_com_nok()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.my_active_tenant();
begin
  if v_tenant is null or not public.pode_avaliar_blitz(v_tenant) then
    raise exception 'Só quem avalia a blitz vê a última blitz de cada colaborador.' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'user_id', u.user_id,
             'occurred_on', u.occurred_on,
             'liberado', u.liberado,
             'educativa', u.educativa,
             'motivo', mo.name,
             'nao', n.itens)), '[]'::jsonb)
      from (
        select distinct on (a.user_id)
               a.id, a.user_id, a.occurred_on, a.liberado, a.educativa, a.motivo_bloqueio_id
          from public.seg_blitz_avaliacoes a
         where a.tenant_id = v_tenant
         order by a.user_id, a.occurred_on desc, a.registrada_em desc, a.id
      ) u
      left join public.seg_blitz_motivos mo on mo.id = u.motivo_bloqueio_id
      cross join lateral (
        select coalesce(jsonb_agg(jsonb_build_object('pergunta_id', r.pergunta_id, 'pergunta', r.snap_pergunta)
                                  order by r.snap_pergunta), '[]'::jsonb) as itens
          from public.seg_blitz_respostas r
         where r.avaliacao_id = u.id and r.resposta = 'nao'
      ) n
     where not u.liberado or jsonb_array_length(n.itens) > 0
  );
end;
$function$;

-- Quem o formulário deve avisar que a blitz será educativa: contratados a
-- partir da data, com o parâmetro ligado, que nunca passaram pela blitz.
-- Vem com a página, para valer sem sinal. Só para quem avalia a blitz.
create or replace function public.seg_blitz_educativa_para()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.my_active_tenant();
begin
  if v_tenant is null or not public.pode_avaliar_blitz(v_tenant) then
    raise exception 'Só quem avalia a blitz vê quem terá a blitz educativa.' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(m.user_id), '[]'::jsonb)
      from public.memberships m
      join public.seg_settings s on s.tenant_id = m.tenant_id and s.blitz_educativa_ativa
     where m.tenant_id = v_tenant and m.is_active
       and m.admission_date >= s.blitz_educativa_desde
       and not exists (
         select 1 from public.seg_blitz_avaliacoes a
          where a.tenant_id = v_tenant and a.user_id = m.user_id
       )
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Alcance
-- ---------------------------------------------------------------------------

revoke execute on function public.seg_blitz_eh_primeira_educativa(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.seg_blitz_validar(uuid, jsonb, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.seg_blitz_gravar_veiculo(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.seg_blitz_gravar_respostas(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.seg_blitz_acionar(uuid) from public, anon, authenticated;
revoke execute on function public.seg_blitz_do_alerta(uuid) from public, anon, authenticated;

revoke execute on function public.seg_criar_blitz(jsonb) from public, anon;
revoke execute on function public.seg_blitz_meus_alertas() from public, anon;
revoke execute on function public.seg_blitz_ultima_com_nok() from public, anon;
revoke execute on function public.seg_blitz_educativa_para() from public, anon;
revoke execute on function public.seg_blitz_analise(date, date, uuid[], boolean) from public, anon;
revoke execute on function public.seg_blitz_alertas_do_periodo(date, date, uuid[], boolean) from public, anon;
grant execute on function public.seg_blitz_educativa_para() to authenticated;

notify pgrst, 'reload schema';
