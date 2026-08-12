-- Lançamento de punição: o processo em volta do fato.
--
-- `employee_sanctions` guarda o FATO, e o fato reduz a remuneração variável.
-- Até aqui não havia processo: alguém digitava quatro campos e o desconto
-- acontecia. Agora o gestor preenche, imprime, colhe assinatura, anexa o papel
-- assinado e o RH decide. Só a APROVAÇÃO cria a linha em `employee_sanctions`.
--
-- POR QUE UMA TABELA NOVA, e não um `status` na tabela do fato. Aquela tabela é
-- lida por dois caminhos que não passam pela RLS (a tela de Metas usa service
-- client para o Gestor ter o fator sem poder ler a punição, e o congelamento da
-- competência grava um retrato dela). Um status ali obrigaria a mexer nos dois,
-- no cálculo e na importação em lote, e um `rv_period_snapshots` já gravado
-- passaria a significar outra coisa. Além disso, punição reprovada não pode
-- existir naquela tabela nem por um instante.
--
-- O VÍNCULO é `sanction_id` aqui, e não `lancamento_id` lá: a tabela do fato
-- mantém o shape exato que o service client já seleciona. `on delete restrict`
-- faz o banco recusar a exclusão da sanção pela tela antiga; desfazer é
-- `punicao_cancelar`, que apaga as duas pontas na ordem certa.
--
-- CPF NÃO É CARIMBADO AQUI. Esta tabela é legível pelo gestor de equipe, e uma
-- coluna `cpf` entregaria CPF a dezenas de gestores pelo PostgREST, desfazendo
-- o que o AGENTS.md protege em `profiles`. O documento lê o CPF por
-- `punicao_documento`, uma linha por vez, para quem já pode ver o lançamento.
--
-- O CARIMBO DO RESTO existe porque o papel assinado precisa continuar batendo
-- com o registro: se a pessoa mudar de setor depois, a advertência de março
-- continua dizendo o setor de março. Mesmo motivo dos `snap_*` das matrículas
-- de treinamento e do fechamento de RV.

create type public.punicao_status as enum
  ('rascunho', 'pendente', 'aprovada', 'reprovada', 'cancelada');

create table public.punicao_lancamentos (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  status    public.punicao_status not null default 'rascunho',
  applied_on date,

  -- a infração, carimbada do catálogo
  infraction_type_id     uuid references public.infraction_types(id) on delete restrict,
  infraction_code        text,
  infraction_name        text,
  infraction_description text,
  severity               public.infraction_severity,

  -- a punição aplicada, carimbada do catálogo
  sanction_type_id uuid references public.sanction_types(id) on delete restrict,
  sanction_name    text,
  extra_info       text,

  -- o vínculo da época
  snap_full_name          text,
  snap_employee_code      text,
  snap_department_id      uuid,
  snap_department_name    text,
  snap_subdepartment_id   uuid,
  snap_subdepartment_name text,
  snap_position_id        uuid,
  snap_position_name      text,
  snap_manager_id         uuid,
  snap_manager_name       text,
  snap_unit_id            uuid,
  snap_unit_name          text,

  -- o documento assinado
  signed_path         text,
  signed_filename     text,
  signed_size         bigint,
  signed_content_type text,
  signed_uploaded_at  timestamptz,
  signed_uploaded_by  uuid references public.profiles(id) on delete set null,

  created_by    uuid not null references public.profiles(id) on delete restrict,
  submitted_at  timestamptz,
  decided_at    timestamptz,
  decided_by    uuid references public.profiles(id) on delete set null,
  decision_note text,
  cancelled_at  timestamptz,
  cancelled_by  uuid references public.profiles(id) on delete set null,
  cancel_note   text,

  sanction_id uuid references public.employee_sanctions(id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Regras de tabela, e não validação de tela: o anexo assinado é a condição
  -- que o cliente pediu para o lançamento sair do rascunho, e condição que só
  -- existe em React some no primeiro POST fora da tela.
  constraint punicao_anexo_para_sair_do_rascunho
    check (status = 'rascunho' or signed_path is not null),
  constraint punicao_campos_para_sair_do_rascunho
    check (status = 'rascunho' or (
      applied_on is not null and infraction_type_id is not null
      and sanction_type_id is not null and severity is not null)),
  constraint punicao_decidida_tem_carimbo
    check ((status in ('aprovada', 'reprovada'))
           = (decided_at is not null and decided_by is not null)),
  constraint punicao_reprovada_tem_nota
    check (status <> 'reprovada' or coalesce(btrim(decision_note), '') <> ''),
  constraint punicao_aprovada_tem_sancao
    check (status <> 'aprovada' or sanction_id is not null),
  constraint punicao_cancelada_tem_carimbo
    check ((status = 'cancelada') = (cancelled_at is not null))
);

create index punicao_lancamentos_fila_idx   on public.punicao_lancamentos (tenant_id, status, submitted_at desc);
create index punicao_lancamentos_pessoa_idx on public.punicao_lancamentos (tenant_id, user_id, applied_on desc);
create index punicao_lancamentos_autor_idx  on public.punicao_lancamentos (tenant_id, created_by, created_at desc);
-- 1:1 com a sanção: duas punições reais para o mesmo lançamento seria duplicar
-- o desconto do mês
create unique index punicao_lancamentos_sancao_uk
  on public.punicao_lancamentos (sanction_id) where sanction_id is not null;

create trigger trg_punicao_lancamentos_updated
  before update on public.punicao_lancamentos
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------- quem vê
-- Uma função só, usada pela policy E pelas RPCs, para as duas não divergirem.
-- Recebe os VALORES e não o id: dentro da policy de `punicao_lancamentos`, uma
-- função que consultasse a própria tabela entraria em recursão.
create or replace function public.pode_ver_punicao(
  p_tenant uuid, p_user uuid, p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_created_by = (select auth.uid())
      or public.manages_user(p_user, p_tenant)
      or public.has_tenant_role(p_tenant, '{owner,admin,hr}'::public.member_role[]);
$$;

revoke execute on function public.pode_ver_punicao(uuid, uuid, uuid) from public, anon;
grant execute on function public.pode_ver_punicao(uuid, uuid, uuid) to authenticated;

alter table public.punicao_lancamentos enable row level security;

-- O PUNIDO NÃO SE VÊ AQUI, e isso é decisão e não esquecimento: o documento é
-- entregue em papel, assinado. Se um dia o cliente quiser a consulta pelo
-- próprio colaborador, é uma linha nesta policy.
create policy punicao_select on public.punicao_lancamentos
  for select using (public.pode_ver_punicao(tenant_id, user_id, created_by));

create policy punicao_insert on public.punicao_lancamentos
  for insert with check (
    public.is_tenant_member(tenant_id)
    and created_by = (select auth.uid())
    and status = 'rascunho'
    and (public.manages_user(user_id, tenant_id)
         or public.has_tenant_role(tenant_id, '{owner,admin,hr}'::public.member_role[]))
  );

-- Update largo de propósito: quem estreita é o TRIGGER, que enxerga o de/para e
-- sabe dizer "isto já foi submetido". Uma policy não vê o valor antigo.
create policy punicao_update on public.punicao_lancamentos
  for update using (public.pode_ver_punicao(tenant_id, user_id, created_by))
  with check (public.pode_ver_punicao(tenant_id, user_id, created_by));

create policy punicao_delete on public.punicao_lancamentos
  for delete using (
    (status = 'rascunho' and created_by = (select auth.uid()))
    or public.has_tenant_role(tenant_id, '{owner,admin}'::public.member_role[])
  );

revoke all on table public.punicao_lancamentos from public, anon;

drop trigger if exists audit_punicao_lancamentos on public.punicao_lancamentos;
create trigger audit_punicao_lancamentos
  after insert or update or delete on public.punicao_lancamentos
  for each row execute function public.audit_trigger();

-- ------------------------------------------------------------- a trava
/**
 * O que pode mudar, quando, e por quem.
 *
 * Três coisas moram aqui porque nenhuma delas cabe numa policy:
 *
 * 1. Congelamento do carimbo. Depois de submetido, o conteúdo do lançamento é o
 *    que está no papel que a pessoa assinou. Deixar editar depois seria assinar
 *    um documento e guardar outro.
 * 2. Transições. Só o caminho previsto: rascunho vira pendente, pendente vira
 *    decidida, reprovada volta para pendente no reenvio, aprovada só pode ser
 *    cancelada.
 * 3. Quem decide. A RPC já confere, mas ela não é o único caminho até a linha.
 */
create or replace function public.guard_punicao_lancamento()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_adm boolean;
begin
  v_adm := public.has_tenant_role(old.tenant_id, '{owner,admin,hr}'::public.member_role[]);

  if old.status <> 'rascunho' and (
       new.user_id is distinct from old.user_id
       or new.applied_on is distinct from old.applied_on
       or new.infraction_type_id is distinct from old.infraction_type_id
       or new.infraction_code is distinct from old.infraction_code
       or new.infraction_name is distinct from old.infraction_name
       or new.infraction_description is distinct from old.infraction_description
       or new.severity is distinct from old.severity
       or new.sanction_type_id is distinct from old.sanction_type_id
       or new.sanction_name is distinct from old.sanction_name
       or new.extra_info is distinct from old.extra_info
       or new.snap_full_name is distinct from old.snap_full_name
       or new.snap_department_name is distinct from old.snap_department_name
       or new.snap_position_name is distinct from old.snap_position_name
       or new.snap_manager_name is distinct from old.snap_manager_name)
  then
    raise exception 'Este lançamento já foi enviado ao RH. Peça a reprovação para corrigir.';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'rascunho'  and new.status = 'pendente')
      or (old.status = 'reprovada' and new.status = 'pendente')
      or (old.status = 'pendente'  and new.status in ('aprovada', 'reprovada') and v_adm)
      or (old.status = 'aprovada'  and new.status = 'cancelada'
          and public.has_tenant_role(old.tenant_id, '{owner,admin}'::public.member_role[]))
    ) then
      raise exception 'Transição de status inválida.';
    end if;
  elsif old.status in ('aprovada', 'cancelada') then
    -- decidida e sem troca de status: nada muda além do carimbo de tempo
    raise exception 'Lançamento já encerrado. Não é possível alterá-lo.';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_punicao_lancamento() from public, anon, authenticated;

create trigger trg_guard_punicao_lancamento
  before update on public.punicao_lancamentos
  for each row execute function public.guard_punicao_lancamento();

-- ---------------------------------------------------------------- storage
-- Só PDF e imagem: o que volta é o documento ASSINADO, digitalizado. Aceitar
-- .docx convidaria a anexar o editável no lugar do papel.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('punicao-documentos', 'punicao-documentos', false, 10485760,
        array['application/pdf','image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- tenant no primeiro segmento do caminho, como em todos os buckets privados. O
-- recorte fino (quem vê AQUELE lançamento) é feito na server action, que só
-- assina a URL depois de conferir `pode_ver_punicao`.
create policy punicao_doc_all on storage.objects for all
  using (bucket_id = 'punicao-documentos'
         and public.is_tenant_member(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'punicao-documentos'
              and public.is_tenant_member(((storage.foldername(name))[1])::uuid));

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
