-- O acidente também vira ação de tratamento.
--
-- O relato já tinha esse caminho: a equipe tria, abre a ação, e ela cai em
-- /acoes com responsável, prazo e cobrança como qualquer outra. O acidente
-- ficava sem: era registrado, investigado, encerrado, e o que a empresa
-- decidiu fazer para não repetir morava fora do sistema.
--
-- A ação continua vivendo no módulo de Ações. Aqui entra só o VÍNCULO, numa
-- tabela de ligação, pela mesma razão de `seg_relato_acoes`: acrescentar coluna
-- em `actions` obrigaria a remendar a `create_action`, que é mantida por
-- replace() sobre pg_get_functiondef desde a 20260811150000.
--
-- UMA DIFERENÇA DELIBERADA em relação ao relato: concluir a ação NÃO encerra o
-- acidente. No relato faz sentido (o relato existe para ser tratado); aqui,
-- encerrar é sobre o caso clínico e legal, o retorno ao trabalho, enquanto a
-- ação corretiva pode levar meses (comprar equipamento, refazer layout).
-- Travar um no outro distorceria os dois. Por isso não há equivalente do
-- gatilho `seg_relato_fecha_com_acao`; a tela avisa e deixa encerrar.

create table public.seg_acidente_acoes (
  id          uuid primary key default gen_random_uuid(),
  acidente_id uuid not null references public.seg_acidentes(id) on delete cascade,
  action_id   uuid not null references public.actions(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint seg_acidente_acao_unica unique (acidente_id, action_id)
);
create index seg_acidente_acoes_acidente_idx on public.seg_acidente_acoes (acidente_id);
create index seg_acidente_acoes_action_idx   on public.seg_acidente_acoes (action_id);

alter table public.seg_acidente_acoes enable row level security;

-- quem enxerga o acidente enxerga o vínculo, e o acidente já é restrito à
-- equipe de segurança e à administração
create policy seg_acidente_acoes_select on public.seg_acidente_acoes
  for select using (public.pode_tratar_seguranca(tenant_id));

create policy seg_acidente_acoes_write on public.seg_acidente_acoes
  for all
  using      (public.pode_tratar_seguranca(tenant_id))
  with check (public.pode_tratar_seguranca(tenant_id));

revoke all on table public.seg_acidente_acoes from public, anon;

drop trigger if exists audit_seg_acidente_acoes on public.seg_acidente_acoes;
create trigger audit_seg_acidente_acoes after insert or update or delete on public.seg_acidente_acoes
  for each row execute function public.audit_trigger();

/** Amarra a ação ao acidente. Não mexe no status: encerrar o caso é outra decisão. */
create or replace function public.seg_vincular_acao_acidente(p_acidente_id uuid, p_action_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_a record;
begin
  select a.* into v_a from public.seg_acidentes a where a.id = p_acidente_id;
  if v_a.id is null then
    raise exception 'Acidente não encontrado.';
  end if;
  perform public.seg_exige_tratativa(v_a.tenant_id);

  if not exists (
    select 1 from public.actions x where x.id = p_action_id and x.tenant_id = v_a.tenant_id
  ) then
    raise exception 'Ação não encontrada nesta empresa.';
  end if;

  insert into public.seg_acidente_acoes (acidente_id, action_id, tenant_id, created_by)
  values (p_acidente_id, p_action_id, v_a.tenant_id, (select auth.uid()))
  on conflict (acidente_id, action_id) do nothing;
end;
$$;

revoke execute on function public.seg_vincular_acao_acidente(uuid, uuid) from public, anon;
grant  execute on function public.seg_vincular_acao_acidente(uuid, uuid) to authenticated;

-- ============================================================================
-- Item do Programa: agora são dois
-- ============================================================================
--
-- Ação de relato vai para 1.2 (Relatos de Incidentes, Atos e Condições
-- Inseguras); ação de acidente vai para 1.1 (Notificação, Investigação e
-- Tratativa de Acidentes). São itens vizinhos no mesmo bloco, e mandar os dois
-- para o mesmo lugar sujaria a pontuação dos dois.

alter table public.seg_settings
  add column acidente_item_id uuid references public.sdpo_itens(id) on delete set null;

-- `%acidente%` casa com "Notificação, Investigação e Tratativa de Acidentes" e
-- NÃO casa com "Relatos de Incidentes...", que fala de incidente
update public.seg_settings st
   set acidente_item_id = (
     select i.id
       from public.sdpo_itens i
       join public.sdpo_blocos b on b.id = i.bloco_id
       join public.sdpo_pilares p on p.id = b.pilar_id
      where i.tenant_id = st.tenant_id
        and p.name ilike '%seguran%'
        and i.name ilike '%acidente%'
      order by i.code
      limit 1
   )
 where st.acidente_item_id is null;

/**
 * O item configurado, do relato ou do acidente.
 *
 * `drop` antes do `create`: parâmetro novo com default criaria uma SEGUNDA
 * assinatura, e o Postgres passaria a ver duas candidatas na mesma chamada.
 * Mesma lição de `seg_triar_relato`. O default 'relato' preserva quem já
 * chama sem argumento.
 */
drop function if exists public.seg_item_do_programa();

create function public.seg_item_do_programa(p_para text default 'relato')
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'item_id', i.id, 'item', i.code || ' ' || i.name,
    'bloco_id', b.id, 'bloco', b.name,
    'secao_id', b.secao_id, 'secao', s.name,
    'pilar_id', b.pilar_id, 'pilar', p.name
  )
    from public.seg_settings st
    join public.sdpo_itens i
      on i.id = case when p_para = 'acidente' then st.acidente_item_id else st.relato_item_id end
    join public.sdpo_blocos b on b.id = i.bloco_id
    left join public.sdpo_secoes s on s.id = b.secao_id
    left join public.sdpo_pilares p on p.id = b.pilar_id
   where st.tenant_id = public.my_active_tenant()
     and public.is_tenant_member(st.tenant_id);
$$;

revoke execute on function public.seg_item_do_programa(text) from public, anon;
grant  execute on function public.seg_item_do_programa(text) to authenticated;

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
