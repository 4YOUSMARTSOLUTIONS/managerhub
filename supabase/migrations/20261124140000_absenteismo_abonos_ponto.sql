-- Abonos no ponto (LUIZ, 24/11/2026).
--
-- A falta abonada ("Abonar a falta" no Efetivar) e aprovada pelo DP precisa ser
-- lançada pelo time responsável no sistema de ponto. A aba "Abonos no ponto" de
-- /absenteismos lista esses casos, e cada um ganha a marca "Lançado no ponto":
-- quem marcou e quando.
--
-- Decisões do LUIZ: só falta abonada (waived), só depois de aprovada, e a aba é
-- de quem já vê a fila do DP: Proprietário, Administrador, DP e a marca Área de
-- Gente. A Área de Gente, que no resto do módulo só lê, AQUI marca: lançar no
-- ponto é a tarefa desse time, e a marca não muda nada do lançamento.
--
-- A marca mora numa tabela à parte de propósito: o lançamento aprovado é
-- congelado pela guarda (guard_absenteismo_lancamento), e a marca não é dado
-- dele. Se o lançamento for cancelado DEPOIS de lançado no ponto, a marca fica e
-- a tela pede para retirar do ponto; "Retirado do ponto" apaga a marca.

create table public.absenteismo_ponto (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lancamento_id uuid not null unique references public.absenteismo_lancamentos(id) on delete cascade,
  lancado_por uuid references public.profiles(id) on delete set null,
  lancado_em timestamptz not null default now()
);

create index absenteismo_ponto_tenant_idx on public.absenteismo_ponto (tenant_id);

alter table public.absenteismo_ponto enable row level security;

-- o ACL padrão do Supabase dá tudo a anon e authenticated: só a leitura volta
revoke all on table public.absenteismo_ponto from public, anon, authenticated;
grant select on table public.absenteismo_ponto to authenticated;

-- lê quem vê a fila do DP (o mesmo alcance de empresa da RLS dos lançamentos)
create policy absenteismo_ponto_ler on public.absenteismo_ponto
  for select to authenticated
  using (
    tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::public.member_role[]))
    or tenant_id in (select public.my_gente_tenant_ids())
  );

create trigger audit_absenteismo_ponto
  after insert or delete or update on public.absenteismo_ponto
  for each row execute function public.audit_trigger();

/**
 * Marca (p_lancado = true) ou desfaz (false) o "Lançado no ponto".
 * Marcar exige falta abonada e aprovada; desfazer vale sempre, inclusive para o
 * lançamento cancelado depois de lançado ("Retirado do ponto").
 */
create or replace function public.absenteismo_marcar_ponto(p_id uuid, p_lancado boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  l record;
begin
  select a.id, a.tenant_id, a.status, a.waived into l
    from public.absenteismo_lancamentos a
   where a.id = p_id;
  if l.id is null then
    raise exception 'Lançamento não encontrado.';
  end if;

  if not (
    public.has_tenant_role(l.tenant_id, '{owner,admin,hr}'::public.member_role[])
    or l.tenant_id in (select public.my_gente_tenant_ids())
  ) then
    raise exception 'Só o DP e a Área de Gente marcam o lançamento no ponto.' using errcode = '42501';
  end if;

  if coalesce(p_lancado, false) then
    if l.status <> 'aprovado' or not l.waived then
      raise exception 'Só falta abonada e aprovada pelo DP vai para o ponto.';
    end if;
    insert into public.absenteismo_ponto (tenant_id, lancamento_id, lancado_por)
    values (l.tenant_id, l.id, (select auth.uid()))
    on conflict (lancamento_id) do nothing;
  else
    delete from public.absenteismo_ponto where lancamento_id = l.id;
  end if;
end;
$function$;

revoke execute on function public.absenteismo_marcar_ponto(uuid, boolean) from public, anon;
grant execute on function public.absenteismo_marcar_ponto(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
