-- Causa-raiz: o "por que" que faltava no relato.
--
-- Sem ela o painel só sabe dizer "o picking teve 30 desvios". Com ela diz "o
-- picking teve 30 desvios e 18 são pressa por produtividade", que é uma
-- conversa completamente diferente com o gestor da área. É o que o item 1.2 do
-- pilar Segurança chama de acompanhamento de tendência baseada na causa-raiz.
--
-- A causa é escolhida na TRIAGEM, não no relato. Quem relata viu o fato; dizer
-- por que ele aconteceu é análise, e análise é da equipe de segurança. Pedir
-- isso ao relator só produziria "distração" e "descuido" em 90% das linhas.
--
-- O acidente também ganha a coluna: ele já tinha `analise_causa` em texto
-- livre, que serve para o laudo mas não empilha em gráfico nenhum. Os dois
-- apontando para o mesmo catálogo é o que permite ver a mesma causa gerando
-- desvio hoje e acidente amanhã.
--
-- COM seed, ao contrário do catálogo de infrações: causa-raiz de segurança é
-- vocabulário técnico e razoavelmente universal, então a lista abaixo é um
-- ponto de partida que o cliente ajusta, não um chute sobre o regulamento dele.

create table public.seg_causas (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  description text,
  active      boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint seg_causas_nome_unico     unique (tenant_id, name),
  constraint seg_causas_nome_nao_vazio check (btrim(name) <> '')
);
create index seg_causas_tenant_idx on public.seg_causas (tenant_id, sort, name);

create trigger trg_seg_causas_updated before update on public.seg_causas
  for each row execute function public.set_updated_at();

alter table public.seg_causas enable row level security;

create policy seg_causas_select on public.seg_causas
  for select using (tenant_id in (select public.my_tenant_ids()));

create policy seg_causas_write on public.seg_causas
  for all
  using      (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])));

revoke all on table public.seg_causas from public, anon;

drop trigger if exists audit_seg_causas on public.seg_causas;
create trigger audit_seg_causas after insert or update or delete on public.seg_causas
  for each row execute function public.audit_trigger();

alter table public.seg_relatos
  add column causa_id uuid references public.seg_causas(id) on delete restrict;
create index seg_relatos_causa_idx on public.seg_relatos (tenant_id, causa_id);

alter table public.seg_acidentes
  add column causa_id uuid references public.seg_causas(id) on delete restrict;
create index seg_acidentes_causa_idx on public.seg_acidentes (tenant_id, causa_id);

insert into public.seg_causas (tenant_id, name, description, sort)
select t.id, v.name, v.descricao, v.sort
  from public.tenants t
 cross join (values
   ('Procedimento inexistente ou desatualizado', 'Não há padrão escrito, ou o que existe não reflete a operação real.', 10),
   ('Falta de treinamento',                      'A pessoa não foi capacitada para a tarefa ou para o risco dela.',      20),
   ('Pressa por produtividade',                  'O jeito seguro foi trocado pelo jeito rápido por causa da meta ou da fila.', 30),
   ('Ferramenta ou equipamento inadequado',      'A ferramenta certa não existe, não está disponível ou não serve para a tarefa.', 40),
   ('Falta de manutenção',                       'Equipamento, veículo ou instalação em condição degradada.',            50),
   ('EPI indisponível ou inadequado',            'Falta o EPI, ele está vencido, danificado ou não é o certo para o risco.', 60),
   ('Layout ou ambiente',                        'Espaço, circulação, piso, iluminação ou sinalização criam o risco.',   70),
   ('Atalho consciente',                         'A regra é conhecida e disponível, e ainda assim foi contornada.',      80)
 ) as v(name, descricao, sort)
on conflict (tenant_id, name) do nothing;

/**
 * Triagem com causa-raiz.
 *
 * `drop` antes do `create`: acrescentar um parâmetro com default criaria uma
 * SEGUNDA assinatura e o Postgres passaria a ver duas candidatas na mesma
 * chamada.
 */
drop function if exists public.seg_triar_relato(uuid, public.seg_relato_status, text, uuid);

create or replace function public.seg_triar_relato(
  p_id uuid,
  p_status public.seg_relato_status,
  p_nota text default null,
  p_duplicado_de uuid default null,
  p_causa_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_r record;
  v_dup uuid := p_duplicado_de;
  v_causa uuid := p_causa_id;
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

  -- causa de outra empresa vira nulo em silêncio, como nos demais catálogos
  if v_causa is not null and not exists (
    select 1 from public.seg_causas c where c.id = v_causa and c.tenant_id = v_r.tenant_id
  ) then
    v_causa := null;
  end if;

  update public.seg_relatos
     set status = p_status,
         nota_triagem = coalesce(nullif(btrim(coalesce(p_nota, '')), ''), nota_triagem),
         duplicado_de = v_dup,
         -- a causa só é sobrescrita quando vem preenchida: reclassificar não é
         -- obrigação de todo clique da triagem
         causa_id = coalesce(v_causa, causa_id),
         triado_por = coalesce(triado_por, (select auth.uid())),
         triado_em = coalesce(triado_em, now())
   where id = p_id;

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

revoke execute on function public.seg_triar_relato(uuid, public.seg_relato_status, text, uuid, uuid) from public, anon;
grant  execute on function public.seg_triar_relato(uuid, public.seg_relato_status, text, uuid, uuid) to authenticated;

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
