-- A situação do colaborador passa a vir dos AFASTAMENTOS, e não de um cadastro
-- paralelo.
--
-- A migração 20261031120000 criou `colaborador_situacoes`, onde o DP marcava
-- "afastado" à mão. No mesmo dia, antes de publicar, o LUIZ decidiu pelo outro
-- caminho: o afastamento já mora em `employee_absences`, que a RV, as metas e os
-- treinamentos leem. Marcar a situação num lugar e lançar o afastamento em outro
-- era pedir para os dois divergirem (o painel diz "afastado" e a RV paga cheio).
-- Agora a situação é CALCULADA: afastamento ou licença em vigor hoje.
--
-- Duas coisas faltavam ao afastamento para isso funcionar:
--
-- 1. MOTIVO. O tipo só dizia "afastamento" ou "licença". Entram INSS, acidente
--    de trabalho, aposentadoria por invalidez (tipo afastamento) e
--    licença-maternidade (tipo licença). Sem motivo continua valendo, com o
--    rótulo do tipo.
--
-- 2. SEM DATA DE RETORNO. Aposentadoria por invalidez e INSS sem alta prevista
--    não têm fim. Fica gravado como 9999-12-31, e não como NULL, de propósito:
--    a RV (fatorRv, redutoresDoMes), as metas e os treinamentos comparam
--    `iso <= fim` como texto, e com NULL o dia de quem está afastado contaria
--    como TRABALHADO, sem erro nenhum (o aposentado receberia RV cheia). Com a
--    data distante, todo leitor que já existe recorta certo pelo mês. A tela
--    mostra "sem data de retorno".
--
-- Decisão do LUIZ (31/10/2026): DOMINGOS RAMOS PEREIRA e RICARDO PEREIRA DOS
-- SANTOS estão aposentados por invalidez.

-- ---------------------------------------------------------------------------
-- 1. Motivo e "sem data de retorno" no afastamento
-- ---------------------------------------------------------------------------
alter table public.employee_absences add column if not exists motivo text;

alter table public.employee_absences drop constraint if exists employee_absences_motivo;
alter table public.employee_absences add constraint employee_absences_motivo check (
  motivo is null
  or (kind = 'afastamento' and motivo in ('afastado_inss', 'acidente_trabalho', 'aposentadoria_invalidez'))
  or (kind = 'licenca' and motivo = 'licenca_maternidade'));

alter table public.employee_absences drop constraint if exists employee_absences_sem_retorno;
alter table public.employee_absences add constraint employee_absences_sem_retorno check (
  end_date <> date '9999-12-31' or kind in ('afastamento', 'licenca'));

comment on column public.employee_absences.motivo is
  'Detalhe do afastamento/licença: afastado_inss, acidente_trabalho, aposentadoria_invalidez (afastamento) ou licenca_maternidade (licença). Nulo = só o tipo.';
comment on column public.employee_absences.end_date is
  'Último dia de ausência (incluído). 9999-12-31 = sem data de retorno (só afastamento e licença): data distante, e não NULL, para os leitores que comparam iso <= fim recortarem certo.';

-- ---------------------------------------------------------------------------
-- 2. Painel de férias: a situação sai do afastamento em vigor na data
-- ---------------------------------------------------------------------------
do $migr$
declare
  v_def text;
  v_de text := $a$(select jsonb_build_object('situacao', cs.situacao, 'desde', cs.desde,
                                        'observacao', cs.observacao)
                from public.colaborador_situacoes cs
               where cs.tenant_id = p_tenant and cs.user_id = m.user_id) as status_colaborador$a$;
  v_para text := $a$(select jsonb_build_object('situacao', coalesce(ea.motivo, ea.kind::text),
                                        'desde', ea.start_date,
                                        'retorno', nullif(ea.end_date, date '9999-12-31'),
                                        'observacao', ea.note)
                from public.employee_absences ea
               where ea.tenant_id = p_tenant and ea.user_id = m.user_id
                 and ea.kind in ('afastamento', 'licenca')
                 and p_hoje between ea.start_date and ea.end_date
               order by ea.start_date desc
               limit 1) as status_colaborador$a$;
begin
  v_def := pg_get_functiondef('public.ferias_painel(uuid, date, uuid[])'::regprocedure);
  if (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 then
    raise exception 'ferias_painel: trecho da situação não encontrado uma única vez';
  end if;
  execute replace(v_def, v_de, v_para);
end
$migr$;

revoke execute on function public.ferias_painel(uuid, date, uuid[]) from public, anon;

-- ---------------------------------------------------------------------------
-- 3. Sai o cadastro paralelo
-- ---------------------------------------------------------------------------
drop function if exists public.colaborador_situacao_definir(uuid, uuid, text, date, text);
drop function if exists public.colaboradores_situacoes(uuid);
drop table if exists public.colaborador_situacoes;

-- ---------------------------------------------------------------------------
-- 4. Leitura da situação para a lista de Colaboradores
-- ---------------------------------------------------------------------------
-- `employee_absences` já é lida por DP e Gerencial; a RPC existe para o Gestor
-- ver a própria cadeia sem abrir a tabela inteira para ele, e para o "hoje" ser
-- o do Brasil e não o do servidor.
create or replace function public.colaboradores_situacoes(p_tenant uuid)
returns table (
  user_id uuid,
  situacao text,
  desde date,
  retorno date,
  observacao text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_todos boolean;
begin
  if not public.is_tenant_member(p_tenant) then
    raise exception 'Você não é membro desta empresa.';
  end if;

  v_todos := public.has_tenant_role(p_tenant, '{owner,admin,hr,manager}'::public.member_role[]);
  if not v_todos and not public.has_tenant_role(p_tenant, '{team_lead}'::public.member_role[]) then
    return; -- colaborador comum: nada
  end if;

  return query
    select distinct on (ea.user_id)
           ea.user_id,
           coalesce(ea.motivo, ea.kind::text),
           ea.start_date,
           nullif(ea.end_date, date '9999-12-31'),
           ea.note
      from public.employee_absences ea
     where ea.tenant_id = p_tenant
       and ea.kind in ('afastamento', 'licenca')
       and v_hoje between ea.start_date and ea.end_date
       and (v_todos or ea.user_id in (
             select mm.user_id from public.my_managed_memberships() mm
              where mm.tenant_id = p_tenant))
     order by ea.user_id, ea.start_date desc;
end;
$$;

revoke execute on function public.colaboradores_situacoes(uuid) from public, anon;

notify pgrst, 'reload schema';
