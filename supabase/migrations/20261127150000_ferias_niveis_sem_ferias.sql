-- Regime de férias por nível (LUIZ, 27/11/2026).
--
-- Aprendiz: o contrato (12 meses na Cervantes) termina junto com o primeiro
-- período aquisitivo; as férias são pagas na rescisão e nunca tiradas. Hoje o
-- nível estava em "programado pelo gestor", então cada aprendiz aparecia no
-- painel de férias e era cobrado da escolha do 13º.
-- Estagiário: não tem 13º por lei, mas usa o módulo para o recesso. Saía como
-- pendente no painel do 13º, e a efetivação do recesso esperava essa escolha.
--
-- Cada nível passa a ter um de quatro regimes (Configurações > Férias):
--   solicita as próprias férias          (fora das duas tabelas)
--   programado pelo gestor, escolhe o 13º (ferias_niveis_bloqueados)
--   programado pelo gestor, sem 13º       (ferias_niveis_bloqueados.sem_decimo)
--   não tira férias                       (ferias_niveis_sem_ferias)
-- "Não tira férias" sai do painel, do alerta semanal, do modelo do lançamento
-- em lote, do 13º e de qualquer pedido ou lançamento (o mesmo efeito do "Fora
-- da folha", só nas férias).

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
alter table public.ferias_niveis_bloqueados add column if not exists sem_decimo boolean not null default false;
comment on column public.ferias_niveis_bloqueados.sem_decimo is
  'O nível não escolhe o adiantamento do 13º (ex.: estagiário, que não tem 13º).';

create table if not exists public.ferias_niveis_sem_ferias (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  hierarchy_level_id uuid not null references public.hierarchy_levels(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tenant_id, hierarchy_level_id)
);
comment on table public.ferias_niveis_sem_ferias is
  'Níveis que não tiram férias (contrato termina antes de completar o período aquisitivo, ex.: aprendiz). Fora de todo o módulo Férias.';
create index if not exists idx_ferias_niveis_sem_ferias_nivel on public.ferias_niveis_sem_ferias (hierarchy_level_id);

alter table public.ferias_niveis_sem_ferias enable row level security;
revoke all on table public.ferias_niveis_sem_ferias from public, anon, authenticated;
grant select, insert, delete on table public.ferias_niveis_sem_ferias to authenticated;

drop policy if exists ferias_niveis_sem_ferias_select on public.ferias_niveis_sem_ferias;
create policy ferias_niveis_sem_ferias_select on public.ferias_niveis_sem_ferias
  for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists ferias_niveis_sem_ferias_write on public.ferias_niveis_sem_ferias;
create policy ferias_niveis_sem_ferias_write on public.ferias_niveis_sem_ferias
  for all to authenticated
  using (public.has_tenant_role(tenant_id, '{owner,admin,hr}'::public.member_role[]))
  with check (public.has_tenant_role(tenant_id, '{owner,admin,hr}'::public.member_role[]));

-- ---------------------------------------------------------------------------
-- Helpers internos
-- ---------------------------------------------------------------------------
-- fora do módulo Férias: fora da folha ou nível que não tira férias
create or replace function public.ferias_sem_ferias(p_tenant uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.memberships m
     where m.tenant_id = p_tenant and m.user_id = p_user
       and (m.fora_da_folha
            or exists (select 1 from public.ferias_niveis_sem_ferias s
                        where s.tenant_id = m.tenant_id and s.hierarchy_level_id = m.hierarchy_level_id)));
$$;
revoke execute on function public.ferias_sem_ferias(uuid, uuid) from public, anon, authenticated;

-- escolhe, por ano, o adiantamento do 13º: programado pelo gestor e com 13º
create or replace function public.ferias_escolhe_decimo(p_tenant uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.ferias_niveis_bloqueados b
      join public.memberships m on m.tenant_id = b.tenant_id and m.hierarchy_level_id = b.hierarchy_level_id
     where b.tenant_id = p_tenant and m.user_id = p_user and not b.sem_decimo);
$$;
revoke execute on function public.ferias_escolhe_decimo(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Patches pela âncora (o corpo vivo tem patches que um recopiado perderia)
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  a text;
begin
  -- painel: o conjunto de pessoas perde também quem está num nível sem férias
  v_def := pg_get_functiondef('public.ferias_painel(uuid,date,uuid[])'::regprocedure);
  a := 'and mf.user_id = x and mf.fora_da_folha));';
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'ferias_painel: âncora'; end if;
  execute replace(v_def, a, 'and mf.user_id = x and public.ferias_sem_ferias(p_tenant, x)));');

  -- alerta semanal de vencimento
  v_def := pg_get_functiondef('public.ferias_alertas_vencimento()'::regprocedure);
  a := 'and not ms.fora_da_folha';
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'ferias_alertas_vencimento: âncora'; end if;
  execute replace(v_def, a, 'and not public.ferias_sem_ferias(ms.tenant_id, ms.user_id)');

  -- modelo do lançamento em lote
  v_def := pg_get_functiondef('public.ferias_modelo_lancamento(uuid,date)'::regprocedure);
  a := 'and not m.fora_da_folha and m.user_id';
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'ferias_modelo_lancamento: âncora'; end if;
  execute replace(v_def, a, 'and not public.ferias_sem_ferias(m.tenant_id, m.user_id) and m.user_id');

  -- painel do 13º: só quem escolhe o 13º (o nível sem férias já não está entre os programados)
  v_def := pg_get_functiondef('public.ferias_painel_decimo(uuid,integer,uuid[])'::regprocedure);
  a := 'join public.ferias_niveis_bloqueados b on b.tenant_id = m.tenant_id and b.hierarchy_level_id = m.hierarchy_level_id';
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'ferias_painel_decimo: âncora'; end if;
  execute replace(v_def, a, a || ' and not b.sem_decimo');

  -- a efetivação espera a escolha do 13º só de quem escolhe
  v_def := pg_get_functiondef('public.ferias_decimo_pendente_ate(uuid,uuid,date)'::regprocedure);
  a := 'public.ferias_nivel_bloqueado(p_tenant, p_user)';
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'ferias_decimo_pendente_ate: âncora'; end if;
  execute replace(v_def, a, 'public.ferias_escolhe_decimo(p_tenant, p_user)');

  -- a escolha só para quem escolhe
  v_def := pg_get_functiondef('public.ferias_escolher_decimo'::regproc::regprocedure);
  a := 'if not public.ferias_nivel_bloqueado(p_tenant, v_uid) then';
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'ferias_escolher_decimo: âncora'; end if;
  execute replace(v_def, a, 'if not public.ferias_escolhe_decimo(p_tenant, v_uid) then');

  -- a leitura das escolhas diz à tela se a pessoa escolhe o 13º
  v_def := pg_get_functiondef('public.ferias_escolhas_decimo(uuid,uuid)'::regprocedure);
  a := $q$'bloqueado', public.ferias_nivel_bloqueado(p_tenant, p_user),$q$;
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'ferias_escolhas_decimo: âncora'; end if;
  execute replace(v_def, a, a || $q$
    'escolheDecimo', public.ferias_escolhe_decimo(p_tenant, p_user),
    'semFerias', public.ferias_sem_ferias(p_tenant, p_user),$q$);

  -- nenhum pedido ou lançamento para quem não tira férias (todos passam aqui)
  v_def := pg_get_functiondef('public.ferias_validar_periodos'::regproc::regprocedure);
  a := E'    raise exception ''As férias podem ser divididas em no máximo 3 períodos (art. 134).'';\n  end if;\n';
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'ferias_validar_periodos: âncora'; end if;
  execute replace(v_def, a, a || $q$
  -- fora da folha ou nível que não tira férias (LUIZ, 27/11/2026)
  if public.ferias_sem_ferias(p_tenant, p_user) then
    raise exception 'Este colaborador não tira férias pelo sistema: o nível dele está como "Não tira férias" em Configurações > Férias, ou o cadastro está fora da folha.';
  end if;
$q$);
end $$;

-- a regra da casa: fechar de novo o que foi recriado
revoke execute on function public.ferias_painel(uuid, date, uuid[]) from public, anon;
revoke execute on function public.ferias_alertas_vencimento() from public, anon, authenticated;
revoke execute on function public.ferias_modelo_lancamento(uuid, date) from public, anon;
revoke execute on function public.ferias_painel_decimo(uuid, integer, uuid[]) from public, anon;
revoke execute on function public.ferias_decimo_pendente_ate(uuid, uuid, date) from public, anon;
do $$
begin
  execute format('revoke execute on function %s from public, anon', 'public.ferias_escolher_decimo'::regproc::regprocedure);
  execute format('revoke execute on function %s from public, anon', 'public.ferias_validar_periodos'::regproc::regprocedure);
end $$;
revoke execute on function public.ferias_escolhas_decimo(uuid, uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Cervantes (decisão do LUIZ): Aprendiz não tira férias; Estagiário sem 13º
-- ---------------------------------------------------------------------------
insert into public.ferias_niveis_sem_ferias (tenant_id, hierarchy_level_id)
select h.tenant_id, h.id from public.hierarchy_levels h
 where h.name = 'Aprendiz'
on conflict do nothing;
delete from public.ferias_niveis_bloqueados b
 using public.ferias_niveis_sem_ferias s
 where s.tenant_id = b.tenant_id and s.hierarchy_level_id = b.hierarchy_level_id;
update public.ferias_niveis_bloqueados b
   set sem_decimo = true
  from public.hierarchy_levels h
 where h.id = b.hierarchy_level_id and h.name = 'Estagiário';

notify pgrst, 'reload schema';
