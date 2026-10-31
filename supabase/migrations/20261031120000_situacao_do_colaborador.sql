-- Situação do colaborador: afastado pelo INSS, licença-maternidade etc.
--
-- O vínculo só sabia "ativo" ou "desligado", e o Absenteísmo registra ausência
-- com data de fim (o afastamento pelo INSS não tem). Resultado: no painel de
-- férias, DOMINGOS e RICARDO apareciam como "Vencida" sem nada que explicasse
-- que estão afastados há anos. O DP passa a marcar a situação no cadastro, e
-- ela aparece no painel de férias e na lista de Colaboradores.
--
-- Decisão do LUIZ (31/10/2026): a situação mora no cadastro, e só o DP e os
-- gestores a veem. O motivo pode revelar dado de saúde (LGPD, dado sensível), e
-- por isso NÃO vai como coluna de `memberships`: a RLS não tem granularidade de
-- coluna, e a linha do vínculo é lida pela empresa inteira. Tabela própria,
-- fechada para a chave pública; leitura e escrita só por RPC com guarda.
--
-- Sem linha = trabalhando normalmente ("Ativo"). Voltar ao trabalho apaga a
-- linha; o histórico fica em `audit_logs` (que só owner e admin leem).

-- ---------------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------------
create table if not exists public.colaborador_situacoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  situacao text not null,
  -- início do afastamento; opcional porque há casos antigos sem a data à mão
  desde date,
  observacao text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint colaborador_situacoes_unica unique (tenant_id, user_id),
  constraint colaborador_situacoes_tipo check (situacao in (
    'afastado_inss', 'acidente_trabalho', 'licenca_maternidade',
    'aposentadoria_invalidez', 'outro')),
  -- "Outro" sem explicação não explica nada
  constraint colaborador_situacoes_outro check (
    situacao <> 'outro' or nullif(btrim(observacao), '') is not null),
  constraint colaborador_situacoes_obs check (char_length(observacao) <= 500)
);

comment on table public.colaborador_situacoes is
  'Situação do colaborador fora do trabalho normal (afastamento, licença). Sem linha = ativo. Leitura e escrita só por RPC: o motivo pode ser dado de saúde.';

alter table public.colaborador_situacoes enable row level security;
-- sem policy e sem grant: a chave pública não alcança a tabela de jeito nenhum
revoke all on table public.colaborador_situacoes from public, anon, authenticated;

create trigger audit_colaborador_situacoes
  after insert or update or delete on public.colaborador_situacoes
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- 2. Escrita: só o DP (owner, admin, RH)
-- ---------------------------------------------------------------------------
create or replace function public.colaborador_situacao_definir(
  p_tenant uuid,
  p_user uuid,
  p_situacao text,
  p_desde date default null,
  p_observacao text default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_obs text := nullif(btrim(coalesce(p_observacao, '')), '');
begin
  if not public.has_tenant_role(p_tenant, '{owner,admin,hr}'::public.member_role[]) then
    raise exception 'Apenas proprietário, administrador e RH podem alterar a situação do colaborador.';
  end if;

  if not exists (
    select 1 from public.memberships m
     where m.tenant_id = p_tenant and m.user_id = p_user
  ) then
    raise exception 'Colaborador não encontrado nesta empresa.';
  end if;

  -- voltou ao trabalho: some a linha
  if p_situacao is null or p_situacao = 'ativo' then
    delete from public.colaborador_situacoes
     where tenant_id = p_tenant and user_id = p_user;
    return;
  end if;

  if p_situacao not in ('afastado_inss', 'acidente_trabalho', 'licenca_maternidade',
                        'aposentadoria_invalidez', 'outro') then
    raise exception 'Situação inválida.';
  end if;
  if p_situacao = 'outro' and v_obs is null then
    raise exception 'Descreva a situação na observação.';
  end if;
  if p_desde is not null and p_desde > v_hoje then
    raise exception 'A data de início não pode ser depois de hoje.';
  end if;
  if char_length(v_obs) > 500 then
    raise exception 'A observação passa de 500 caracteres.';
  end if;

  insert into public.colaborador_situacoes as cs
         (tenant_id, user_id, situacao, desde, observacao, updated_by)
  values (p_tenant, p_user, p_situacao, p_desde, v_obs, auth.uid())
  on conflict (tenant_id, user_id) do update
     set situacao = excluded.situacao,
         desde = excluded.desde,
         observacao = excluded.observacao,
         updated_by = excluded.updated_by,
         updated_at = now();
end;
$$;

revoke execute on function public.colaborador_situacao_definir(uuid, uuid, text, date, text)
  from public, anon;

-- ---------------------------------------------------------------------------
-- 3. Leitura: DP e Gerencial a empresa inteira; Gestor a própria cadeia
-- ---------------------------------------------------------------------------
create or replace function public.colaboradores_situacoes(p_tenant uuid)
returns table (
  user_id uuid,
  situacao text,
  desde date,
  observacao text,
  atualizado_em timestamptz,
  atualizado_por text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.is_tenant_member(p_tenant) then
    raise exception 'Você não é membro desta empresa.';
  end if;

  if public.has_tenant_role(p_tenant, '{owner,admin,hr,manager}'::public.member_role[]) then
    return query
      select cs.user_id, cs.situacao, cs.desde, cs.observacao, cs.updated_at, p.full_name
        from public.colaborador_situacoes cs
        left join public.profiles p on p.id = cs.updated_by
       where cs.tenant_id = p_tenant;
  elsif public.has_tenant_role(p_tenant, '{team_lead}'::public.member_role[]) then
    return query
      select cs.user_id, cs.situacao, cs.desde, cs.observacao, cs.updated_at, p.full_name
        from public.colaborador_situacoes cs
        left join public.profiles p on p.id = cs.updated_by
       where cs.tenant_id = p_tenant
         and cs.user_id in (
           select mm.user_id from public.my_managed_memberships() mm
            where mm.tenant_id = p_tenant);
  end if;
  -- colaborador comum: nada
end;
$$;

revoke execute on function public.colaboradores_situacoes(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- 4. Painel de férias: cada saldo leva a situação do colaborador
-- ---------------------------------------------------------------------------
-- Troca cirúrgica: o painel já recorta o escopo (DP e Gerencial = empresa,
-- Gestor = cadeia), então a situação herda o mesmo recorte.
do $migr$
declare
  v_def text;
  v_novo text;
  v_de1 text := $a$'gozarAte', z.concessivo_fim, 'semFolha', z.sem_folha)$a$;
  v_para1 text := $a$'gozarAte', z.concessivo_fim, 'semFolha', z.sem_folha,
           'statusColaborador', z.status_colaborador)$a$;
  v_de2 text := $a$where a.tenant_id = p_tenant and a.user_id = m.user_id)) as sem_folha$a$;
  v_para2 text := $a$where a.tenant_id = p_tenant and a.user_id = m.user_id)) as sem_folha,
             (select jsonb_build_object('situacao', cs.situacao, 'desde', cs.desde,
                                        'observacao', cs.observacao)
                from public.colaborador_situacoes cs
               where cs.tenant_id = p_tenant and cs.user_id = m.user_id) as status_colaborador$a$;
begin
  v_def := pg_get_functiondef('public.ferias_painel(uuid, date, uuid[])'::regprocedure);

  if (length(v_def) - length(replace(v_def, v_de1, ''))) / length(v_de1) <> 1 then
    raise exception 'ferias_painel: trecho 1 não encontrado uma única vez';
  end if;
  if (length(v_def) - length(replace(v_def, v_de2, ''))) / length(v_de2) <> 1 then
    raise exception 'ferias_painel: trecho 2 não encontrado uma única vez';
  end if;

  v_novo := replace(replace(v_def, v_de1, v_para1), v_de2, v_para2);
  execute v_novo;
end
$migr$;

-- create or replace mantém os privilégios, mas a regra é explícita
revoke execute on function public.ferias_painel(uuid, date, uuid[]) from public, anon;

notify pgrst, 'reload schema';
