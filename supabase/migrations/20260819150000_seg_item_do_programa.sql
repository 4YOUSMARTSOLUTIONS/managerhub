-- Relato é evidência do Programa de Excelência, e a ação nasce sabendo disso.
--
-- O item "1.2 Relatos de Incidentes, Atos e Condições Inseguras", no pilar
-- Segurança, cobra exatamente o que este módulo faz: registro digital de atos e
-- condições inseguras COM ações corretivas e preventivas definidas, gestão
-- dessas ações evidenciada e prevenção de reincidência. Se a ação de tratamento
-- nasce solta, na hora da auditoria alguém precisa garimpar em /acoes quais
-- delas eram de segurança. Nascendo amarrada ao item, a evidência se monta
-- sozinha.
--
-- O ID do item NÃO pode ser fixado no código: o catálogo do Programa é de cada
-- empresa, e mesmo o texto do item pode mudar de versão para versão. Então vira
-- configuração, com um palpite inicial: na criação, procura-se o item de nome
-- parecido dentro do pilar Segurança. Se a empresa não usa o Programa, o campo
-- fica nulo e a ação nasce solta, como antes.

-- `id` existe por causa do `audit_trigger()`, que lê `new.id` para carimbar a
-- entidade alterada e morre em tabela que não tem essa coluna (mesma pedra do
-- `seg_equipe`). A chave de negócio é o tenant, e ela vira constraint própria.
create table public.seg_settings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  -- item do Programa ao qual as ações de tratamento de RELATO são vinculadas
  relato_item_id  uuid references public.sdpo_itens(id) on delete set null,
  updated_at      timestamptz not null default now(),
  constraint seg_settings_por_empresa unique (tenant_id)
);

create trigger trg_seg_settings_updated before update on public.seg_settings
  for each row execute function public.set_updated_at();

alter table public.seg_settings enable row level security;

-- leitura de qualquer membro: a tela do relato precisa saber se há vínculo
create policy seg_settings_select on public.seg_settings
  for select using (tenant_id in (select public.my_tenant_ids()));

create policy seg_settings_write on public.seg_settings
  for all
  using      (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])));

revoke all on table public.seg_settings from public, anon;

drop trigger if exists audit_seg_settings on public.seg_settings;
create trigger audit_seg_settings after insert or update or delete on public.seg_settings
  for each row execute function public.audit_trigger();

-- Palpite inicial por empresa: o item de relatos dentro do pilar Segurança.
-- `on conflict do nothing` porque isto é sugestão, não decisão: quem manda é a
-- tela de Configurações.
insert into public.seg_settings (tenant_id, relato_item_id)
select t.id, (
  select i.id
    from public.sdpo_itens i
    join public.sdpo_blocos b on b.id = i.bloco_id
    join public.sdpo_pilares p on p.id = b.pilar_id
   where i.tenant_id = t.id
     and p.name ilike '%seguran%'
     and i.name ilike '%relato%'
   order by i.code
   limit 1
)
from public.tenants t
on conflict (tenant_id) do nothing;

/**
 * O vínculo de Programa das ações de relato, já resolvido.
 *
 * Devolve item, bloco, seção e pilar num objeto só, porque a `create_action`
 * pede os três ids e a tela precisa do texto para mostrar a que o vínculo se
 * refere. Null quando a empresa não configurou (ou não usa o Programa).
 */
create or replace function public.seg_item_do_programa()
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
    join public.sdpo_itens i on i.id = st.relato_item_id
    join public.sdpo_blocos b on b.id = i.bloco_id
    left join public.sdpo_secoes s on s.id = b.secao_id
    left join public.sdpo_pilares p on p.id = b.pilar_id
   where st.tenant_id = public.my_active_tenant()
     and public.is_tenant_member(st.tenant_id);
$$;

revoke execute on function public.seg_item_do_programa() from public, anon;
grant  execute on function public.seg_item_do_programa() to authenticated;

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
