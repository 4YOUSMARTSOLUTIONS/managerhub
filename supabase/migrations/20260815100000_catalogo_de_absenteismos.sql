-- Catálogo de tipos de absenteísmo e a lista de quem recebe o comunicado.
--
-- O ENUM `absence_kind` continua sendo o que a remuneração variável observa:
-- `rv_reducer_rules.absence_kind` aponta para ele, e `src/lib/rv-redutores.ts`
-- casa a regra pelo valor. Se o catálogo virasse a chave, as faixas de redutor
-- de todos os clientes ficariam órfãs no dia da migração.
--
-- Então o catálogo é uma camada de NOME e de POLÍTICA DE COLETA sobre cinco
-- comportamentos fixos: "Atestado médico" e "Atestado odontológico" podem
-- coexistir, os dois com `kind = 'atestado'`, e os dois contam dias na mesma
-- faixa. Quem inventa comportamento novo é uma migração de enum, sozinha no
-- arquivo (a lição de 20260807120000), e aí os `Record` exaustivos de
-- src/lib/constants.ts quebram a compilação até serem atualizados, que é o
-- efeito desejado.
--
-- COM SEED, ao contrário do catálogo de infrações. Infração é o regulamento de
-- cada empresa e chutar uma lista seria cadastro para alguém apagar. Aqui os
-- cinco tipos já existem no enum e já aparecem na tela de Férias e afastamentos:
-- sem o seed, o cliente atual abriria a tela nova sem nenhuma opção.

create table public.absence_types (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  description text,
  -- a amarra com a remuneração variável
  kind        public.absence_kind not null,
  -- exige o documento digitalizado para sair do lançamento aberto
  requires_document boolean not null default false,
  -- abre o bloco de CID, médico e local na confirmação
  requires_medical  boolean not null default false,
  -- palpite inicial de `employee_absences.discounts_rv` ao aprovar
  discounts_rv_default boolean not null default true,
  -- férias não é absenteísmo: entra na base de ausências, mas fica fora do
  -- indicador. A coluna existe desde já para o cálculo não precisar de uma
  -- lista de exceções escrita no código.
  counts_as_absenteeism boolean not null default true,
  active boolean not null default true,
  sort   int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint absence_types_nome_unico unique (tenant_id, name),
  constraint absence_types_nome_nao_vazio check (btrim(name) <> ''),
  -- quem pede CID pede o papel junto: sem o atestado anexado, o dado médico
  -- digitado não tem como ser conferido pelo RH
  constraint absence_types_medico_pede_documento
    check (not requires_medical or requires_document)
);
create index absence_types_tenant_idx on public.absence_types (tenant_id, sort, name);

create trigger trg_absence_types_updated
  before update on public.absence_types
  for each row execute function public.set_updated_at();

-- Uma linha por valor do enum, para cada empresa. Os nomes e os padrões são os
-- mesmos que a tela de Férias e afastamentos já usa (src/lib/constants.ts):
-- `atestado` e `falta` nascem SEM desconto proporcional porque quem cuida deles
-- é o redutor por faixa, e descontar os dias além da faixa puniria duas vezes o
-- mesmo dia.
insert into public.absence_types
  (tenant_id, name, kind, requires_document, requires_medical,
   discounts_rv_default, counts_as_absenteeism, sort)
select t.id, x.name, x.kind, x.req_doc, x.req_med, x.desconta, x.conta, x.sort
from public.tenants t
cross join (values
  ('Férias',                   'ferias'::public.absence_kind, false, false, true,  false, 10),
  ('Licença',                  'licenca',                     false, false, true,  true,  20),
  ('Afastamento',              'afastamento',                 true,  false, true,  true,  30),
  ('Atestado',                 'atestado',                    true,  true,  false, true,  40),
  ('Falta sem justificativa',  'falta',                       false, false, false, true,  50)
) as x(name, kind, req_doc, req_med, desconta, conta, sort)
on conflict (tenant_id, name) do nothing;

alter table public.absence_types enable row level security;

-- Leitura de qualquer membro: o gestor precisa do catálogo para confirmar o
-- lançamento, e é o catálogo que diz se aquele tipo pede atestado.
create policy absence_types_select on public.absence_types
  for select using (tenant_id in (select public.my_tenant_ids()));

-- Escrita do departamento pessoal, mesmo grupo de `sanction_types` e
-- `infraction_types`.
create policy absence_types_write on public.absence_types
  for all
  using (tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::member_role[])));

revoke all on table public.absence_types from public, anon;

drop trigger if exists audit_absence_types on public.absence_types;
create trigger audit_absence_types
  after insert or update or delete on public.absence_types
  for each row execute function public.audit_trigger();

-- ============================================================================
-- Quem recebe o comunicado de não comparecimento
-- ============================================================================
--
-- Lista própria, e não "os gestores" ou "quem tem papel X": quem precisa saber
-- que alguém não apareceu costuma ser gente de fora do organograma do sistema,
-- como a portaria, a contabilidade ou a empresa de transporte. É por isso que a
-- coluna guarda e-mail, e não `user_id`.
--
-- `unit_id` nulo quer dizer "recebe de todas as unidades". Com unidade, recebe
-- só dos lançamentos cuja unidade CARIMBADA bate, que é o mesmo recorte do
-- seletor do topo.
create table public.absenteismo_email_recipients (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  unit_id   uuid references public.units(id) on delete cascade,
  email     text not null,
  name      text,
  active    boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Não há fila nem retorno de bounce: um e-mail digitado errado falharia em
  -- silêncio para sempre. O formato é conferido na entrada.
  constraint absenteismo_dest_email_valido
    check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

-- Dois índices parciais porque NULL não deduplica num unique comum: sem o
-- primeiro, o mesmo e-mail geral entraria duas vezes e a pessoa receberia o
-- comunicado em dobro.
create unique index absenteismo_dest_geral_uk
  on public.absenteismo_email_recipients (tenant_id, lower(email))
  where unit_id is null;
create unique index absenteismo_dest_unidade_uk
  on public.absenteismo_email_recipients (tenant_id, unit_id, lower(email))
  where unit_id is not null;

create trigger trg_absenteismo_dest_updated
  before update on public.absenteismo_email_recipients
  for each row execute function public.set_updated_at();

alter table public.absenteismo_email_recipients enable row level security;

-- Leitura E escrita só do departamento pessoal. É lista de contato de terceiros,
-- e o gestor não precisa dela: a tela dele diz "a comunicação vai para os
-- e-mails definidos em Configurações", sem mostrar quais.
create policy absenteismo_dest_dp on public.absenteismo_email_recipients
  for all
  using (tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::member_role[])));

revoke all on table public.absenteismo_email_recipients from public, anon;

drop trigger if exists audit_absenteismo_dest on public.absenteismo_email_recipients;
create trigger audit_absenteismo_dest
  after insert or update or delete on public.absenteismo_email_recipients
  for each row execute function public.audit_trigger();

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
