-- A blitz de um colaborador: o registro que o avaliador preenche na portaria.
--
-- CONFORME é calculado e carimbado no insert: liberado E nenhuma resposta
-- "não". A regra veio do LUIZ: bloqueio OU resposta negativa conta como não
-- conformidade, aciona o gestor e entra na recorrência. Carimbar (em vez de
-- derivar a cada consulta) segue a filosofia do módulo: o painel lê um
-- boolean indexado, e reclassificar pergunta amanhã não reescreve o histórico.
--
-- A RESPOSTA CARIMBA O TEXTO da pergunta (`snap_pergunta`): as perguntas
-- "podem mudar com o tempo", e a resposta de março não pode mudar de sentido
-- quando a pergunta for reescrita em julho. Mesma lição do snap_natureza.
--
-- Os SNAPS do colaborador (setor, função, gestor, unidade) são por trigger,
-- como nos acidentes: o alerta vai para o gestor DA ÉPOCA, e a estatística
-- conta o setor do dia da blitz, não o de depois da promoção.

create table public.seg_blitz_avaliacoes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  unit_id       uuid references public.units(id) on delete set null,
  occurred_on   date not null,
  user_id       uuid not null references public.profiles(id) on delete restrict,

  -- vínculo da época, preenchido por trigger
  snap_full_name          text,
  snap_department_id      uuid,
  snap_department_name    text,
  snap_position_name      text,
  snap_manager_id         uuid,
  snap_manager_name       text,
  snap_unit_id            uuid,
  snap_unit_name          text,

  meio_id       uuid not null references public.seg_blitz_meios(id) on delete restrict,
  veiculo_id    uuid references public.seg_veiculos(id) on delete set null,
  placa         text,
  veiculo_tipo  text,
  propriedade   public.seg_veiculo_propriedade,

  liberado      boolean not null,
  motivo_bloqueio_id uuid references public.seg_blitz_motivos(id) on delete restrict,
  observacao    text,
  conforme      boolean not null,

  created_by    uuid not null default auth.uid() references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),

  -- bloqueio sem motivo não conta história
  constraint seg_blitz_bloqueio_tem_motivo check (liberado or motivo_bloqueio_id is not null),
  -- bloqueado nunca é conforme, não importa o que as respostas digam
  constraint seg_blitz_bloqueado_nao_conforme check (liberado or conforme = false)
);
create index seg_blitz_av_data_idx     on public.seg_blitz_avaliacoes (tenant_id, occurred_on desc);
create index seg_blitz_av_pessoa_idx   on public.seg_blitz_avaliacoes (tenant_id, user_id, occurred_on desc);
create index seg_blitz_av_conforme_idx on public.seg_blitz_avaliacoes (tenant_id, conforme);

create table public.seg_blitz_respostas (
  id            uuid primary key default gen_random_uuid(),
  avaliacao_id  uuid not null references public.seg_blitz_avaliacoes(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  pergunta_id   uuid references public.seg_blitz_perguntas(id) on delete set null,
  snap_pergunta text not null,
  resposta      public.seg_blitz_resposta not null,
  constraint seg_blitz_resposta_unica unique (avaliacao_id, pergunta_id)
);
create index seg_blitz_respostas_av_idx on public.seg_blitz_respostas (avaliacao_id);

/** Carimbo do vínculo da época, como nos acidentes. */
create or replace function public.stamp_seg_blitz()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.snap_full_name is null then
    select p.full_name, m.department_id, d.name, pos.name, m.manager_id, mg.full_name
      into new.snap_full_name, new.snap_department_id, new.snap_department_name,
           new.snap_position_name, new.snap_manager_id, new.snap_manager_name
    from public.memberships m
    join public.profiles p on p.id = m.user_id
    left join public.departments d on d.id = m.department_id
    left join public.positions pos on pos.id = m.position_id
    left join public.profiles mg on mg.id = m.manager_id
    where m.user_id = new.user_id and m.tenant_id = new.tenant_id;

    select u.id, u.name
      into new.snap_unit_id, new.snap_unit_name
    from public.memberships m
    join public.membership_units mu on mu.membership_id = m.id
    join public.units u on u.id = mu.unit_id
    where m.user_id = new.user_id and m.tenant_id = new.tenant_id
    order by u.name
    limit 1;

    new.unit_id := coalesce(new.unit_id, new.snap_unit_id);
  end if;

  -- blitz não acontece amanhã, mesma regra do acidente
  if new.occurred_on > current_date then
    raise exception 'A data da blitz não pode estar no futuro.';
  end if;
  return new;
end;
$$;

revoke execute on function public.stamp_seg_blitz() from public, anon, authenticated;

create trigger seg_blitz_avaliacoes_stamp
  before insert on public.seg_blitz_avaliacoes
  for each row execute function public.stamp_seg_blitz();

alter table public.seg_blitz_avaliacoes enable row level security;
alter table public.seg_blitz_respostas  enable row level security;

create policy seg_blitz_av_select on public.seg_blitz_avaliacoes
  for select using (public.pode_ver_blitz(tenant_id, user_id));

-- escrita só pela RPC (validação + upsert do veículo + alerta na mesma
-- transação); delete é do proprietário, como acidentes
create policy seg_blitz_av_delete on public.seg_blitz_avaliacoes
  for delete using (tenant_id in (select public.my_role_tenant_ids('{owner}'::member_role[])));

create policy seg_blitz_respostas_select on public.seg_blitz_respostas
  for select using (
    exists (
      select 1 from public.seg_blitz_avaliacoes a
       where a.id = seg_blitz_respostas.avaliacao_id
         and public.pode_ver_blitz(a.tenant_id, a.user_id)
    )
  );

revoke all on table public.seg_blitz_avaliacoes from public, anon;
revoke all on table public.seg_blitz_respostas  from public, anon;
-- sem policy de insert/update, o PostgREST não escreve nem para authenticated

drop trigger if exists audit_seg_blitz_avaliacoes on public.seg_blitz_avaliacoes;
create trigger audit_seg_blitz_avaliacoes after insert or update or delete on public.seg_blitz_avaliacoes
  for each row execute function public.audit_trigger();

/**
 * Cria a blitz completa: avaliação + respostas carimbadas + upsert do veículo,
 * numa transação só. Se sair não conforme, o alerta ao gestor nasce na L3.
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

  -- conforme = liberado E nenhuma resposta 'nao'
  v_conforme := v_liberado and not exists (
    select 1 from jsonb_array_elements(coalesce(p_data->'respostas', '[]'::jsonb)) x
     where x->>'resposta' = 'nao'
  );

  -- veículo: só quando o meio tem, e a placa veio preenchida. Upsert por placa
  -- é o "lembrar da última blitz": o cadastro se alimenta sozinho.
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
  returning id into v_id;

  -- respostas com o texto da época carimbado; pergunta de outra empresa é
  -- descartada em silêncio, como nos demais catálogos
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

  return v_id;
end;
$$;

revoke execute on function public.seg_criar_blitz(jsonb) from public, anon;
grant  execute on function public.seg_criar_blitz(jsonb) to authenticated;

/** Excluir é do proprietário, como acidente: lançamento errado se apaga com rastro no audit. */
create or replace function public.seg_excluir_blitz(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_tenant uuid;
begin
  select a.tenant_id into v_tenant from public.seg_blitz_avaliacoes a where a.id = p_id;
  if v_tenant is null then
    raise exception 'Blitz não encontrada.';
  end if;
  perform public.seg_exige_proprietario(v_tenant);
  delete from public.seg_blitz_avaliacoes where id = p_id;
end;
$$;

revoke execute on function public.seg_excluir_blitz(uuid) from public, anon;
grant  execute on function public.seg_excluir_blitz(uuid) to authenticated;

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
