-- Triagem: o que a equipe de segurança faz com o relato que chegou.
--
-- Três verbos, e cada um é uma RPC porque cada um tem uma regra que a tela não
-- pode decidir:
--
--   seg_triar_relato    valida a TRANSIÇÃO (não se trata o que nem foi triado,
--                       não se retria o que já acabou) e avisa o relator do
--                       desfecho, que é o que faz alguém relatar de novo.
--   seg_alertar_gestor  descobre o gestor de cada envolvido pelo CARIMBO do
--                       relato, não pelo vínculo de hoje, e manda o aviso sem
--                       o nome de quem relatou.
--   seg_vincular_acao   amarra a ação de tratamento ao relato e o dá por
--                       tratado.
--
-- O vínculo com a ação mora numa tabela própria de propósito. Acrescentar
-- coluna em `actions` obrigaria a remendar a `create_action`, que já é mantida
-- por replace() sobre pg_get_functiondef desde a 20260811150000; uma tabela de
-- ligação faz o mesmo trabalho sem tocar naquele nó.

create table public.seg_relato_acoes (
  id         uuid primary key default gen_random_uuid(),
  relato_id  uuid not null references public.seg_relatos(id) on delete cascade,
  action_id  uuid not null references public.actions(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint seg_relato_acao_unica unique (relato_id, action_id)
);
create index seg_relato_acoes_relato_idx on public.seg_relato_acoes (relato_id);
create index seg_relato_acoes_action_idx on public.seg_relato_acoes (action_id);

alter table public.seg_relato_acoes enable row level security;

create policy seg_relato_acoes_select on public.seg_relato_acoes
  for select using (
    exists (
      select 1 from public.seg_relatos r
       where r.id = seg_relato_acoes.relato_id
         and public.pode_ver_relato(r.tenant_id, r.created_by)
    )
  );

create policy seg_relato_acoes_write on public.seg_relato_acoes
  for all
  using      (public.pode_tratar_seguranca(tenant_id))
  with check (public.pode_tratar_seguranca(tenant_id));

revoke all on table public.seg_relato_acoes from public, anon;

drop trigger if exists audit_seg_relato_acoes on public.seg_relato_acoes;
create trigger audit_seg_relato_acoes after insert or update or delete on public.seg_relato_acoes
  for each row execute function public.audit_trigger();

/** Guarda comum das três: equipe de segurança ou administração da empresa. */
create or replace function public.seg_exige_tratativa(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.pode_tratar_seguranca(p_tenant) then
    raise exception 'Só a equipe de segurança pode fazer isso.';
  end if;
end;
$$;

revoke execute on function public.seg_exige_tratativa(uuid) from public, anon, authenticated;

/**
 * Move o relato de estado. `p_duplicado_de` só faz sentido com status
 * 'duplicado', e é o que evita cinco relatos do mesmo buraco virarem cinco
 * desvios na base da pirâmide.
 */
create or replace function public.seg_triar_relato(
  p_id uuid,
  p_status public.seg_relato_status,
  p_nota text default null,
  p_duplicado_de uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_r record;
  v_dup uuid := p_duplicado_de;
begin
  select r.* into v_r from public.seg_relatos r where r.id = p_id;
  if v_r.id is null then
    raise exception 'Relato não encontrado.';
  end if;
  perform public.seg_exige_tratativa(v_r.tenant_id);

  if p_status = 'aberto' then
    raise exception 'Um relato não volta para a fila de triagem.';
  end if;
  if v_r.status in ('tratado', 'improcedente', 'duplicado') then
    raise exception 'Este relato já foi encerrado como %.', v_r.status;
  end if;
  if v_r.status = 'triado' and p_status = 'duplicado' then
    raise exception 'Marque como duplicado antes de iniciar a tratativa.';
  end if;

  if p_status = 'duplicado' then
    if v_dup is null then
      raise exception 'Aponte de qual relato este é duplicado.';
    end if;
    if v_dup = p_id then
      raise exception 'Um relato não é duplicado de si mesmo.';
    end if;
    if not exists (
      select 1 from public.seg_relatos o where o.id = v_dup and o.tenant_id = v_r.tenant_id
    ) then
      raise exception 'O relato apontado como original não existe.';
    end if;
  else
    v_dup := null;
  end if;

  update public.seg_relatos
     set status = p_status,
         nota_triagem = coalesce(nullif(btrim(coalesce(p_nota, '')), ''), nota_triagem),
         duplicado_de = v_dup,
         triado_por = coalesce(triado_por, (select auth.uid())),
         triado_em = coalesce(triado_em, now())
   where id = p_id;

  -- o relator merece saber no que deu; sem isso ele relata uma vez e desiste
  if p_status in ('tratado', 'improcedente', 'duplicado') and v_r.created_by is not null then
    perform public.notify_users(
      v_r.tenant_id, array[v_r.created_by], 'seg_relato_desfecho',
      case p_status
        when 'tratado' then 'Seu relato foi tratado'
        when 'improcedente' then 'Seu relato foi analisado'
        else 'Seu relato já havia sido registrado'
      end,
      case p_status
        when 'tratado' then 'A equipe de segurança encaminhou o tratamento do que você apontou. Obrigado por relatar.'
        when 'improcedente' then 'A equipe analisou e concluiu que não era uma ocorrência de segurança. Continue relatando.'
        else 'Outra pessoa já havia relatado o mesmo fato, e ele está sendo tratado. Continue relatando.'
      end,
      null
    );
  end if;
end;
$$;

revoke execute on function public.seg_triar_relato(uuid, public.seg_relato_status, text, uuid) from public, anon;
grant  execute on function public.seg_triar_relato(uuid, public.seg_relato_status, text, uuid) to authenticated;

/**
 * Avisa o gestor de cada envolvido. Devolve quantos foram notificados.
 *
 * O gestor sai do CARIMBO do relato (`snap_manager_id`), não do vínculo atual:
 * quem tinha que conversar com a pessoa é quem era gestor dela no dia do fato.
 * E o texto não cita o relator, nem por aproximação.
 */
create or replace function public.seg_alertar_gestor(p_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_r      record;
  v_tipo   text;
  v_onde   text;
  v_gestores uuid[];
begin
  select r.* into v_r from public.seg_relatos r where r.id = p_id;
  if v_r.id is null then
    raise exception 'Relato não encontrado.';
  end if;
  perform public.seg_exige_tratativa(v_r.tenant_id);

  select array_agg(distinct e.snap_manager_id) into v_gestores
    from public.seg_relato_envolvidos e
   where e.relato_id = p_id and e.snap_manager_id is not null;

  if v_gestores is null then
    return 0;
  end if;

  select t.name into v_tipo from public.seg_tipos_relato t where t.id = v_r.tipo_id;

  select coalesce(
    nullif(concat_ws(' · ', l.name, a.name), ''),
    'local não informado'
  ) into v_onde
    from (select 1) x
    left join public.seg_locais l on l.id = v_r.local_id
    left join public.seg_areas  a on a.id = v_r.area_id;

  perform public.notify_users(
    v_r.tenant_id, v_gestores, 'seg_relato_alerta',
    'Relato de segurança na sua equipe',
    coalesce(v_tipo, 'Relato') || ' em ' || to_char(v_r.occurred_on, 'DD/MM/YYYY')
      || ' (' || v_onde || '). ' || v_r.descricao
      || ' Converse com a equipe e registre o que foi feito.',
    null
  );

  return array_length(v_gestores, 1);
end;
$$;

revoke execute on function public.seg_alertar_gestor(uuid) from public, anon;
grant  execute on function public.seg_alertar_gestor(uuid) to authenticated;

/** Amarra a ação de tratamento ao relato e o dá por tratado. */
create or replace function public.seg_vincular_acao(p_relato_id uuid, p_action_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_r record;
begin
  select r.* into v_r from public.seg_relatos r where r.id = p_relato_id;
  if v_r.id is null then
    raise exception 'Relato não encontrado.';
  end if;
  perform public.seg_exige_tratativa(v_r.tenant_id);

  if not exists (
    select 1 from public.actions a where a.id = p_action_id and a.tenant_id = v_r.tenant_id
  ) then
    raise exception 'Ação não encontrada nesta empresa.';
  end if;

  insert into public.seg_relato_acoes (relato_id, action_id, tenant_id, created_by)
  values (p_relato_id, p_action_id, v_r.tenant_id, (select auth.uid()))
  on conflict (relato_id, action_id) do nothing;

  -- abrir ação É o tratamento; o relato não fica esperando um segundo clique
  if v_r.status in ('aberto', 'triado') then
    update public.seg_relatos
       set status = 'tratado',
           triado_por = coalesce(triado_por, (select auth.uid())),
           triado_em = coalesce(triado_em, now())
     where id = p_relato_id;

    if v_r.created_by is not null then
      perform public.notify_users(
        v_r.tenant_id, array[v_r.created_by], 'seg_relato_desfecho',
        'Seu relato virou ação',
        'A equipe de segurança abriu uma ação para tratar o que você apontou. Obrigado por relatar.',
        null
      );
    end if;
  end if;
end;
$$;

revoke execute on function public.seg_vincular_acao(uuid, uuid) from public, anon;
grant  execute on function public.seg_vincular_acao(uuid, uuid) to authenticated;

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
