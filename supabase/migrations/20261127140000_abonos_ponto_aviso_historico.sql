-- Abonos e compensações no ponto: aviso, histórico e log legível (LUIZ, 27/11/2026)
--
-- 1. Aviso no sino (e no celular) para a Área de Gente quando o DP aprova um
--    abono ou uma compensação ("para lançar no ponto") e quando um já lançado é
--    cancelado ("retirar do ponto"). Sem ninguém com a marca, vai ao DP.
--    Importação de histórico entra aprovada por INSERT e segue sem aviso.
-- 2. Histórico da marca, sem apagar: cada lançado, desfeito e retirado, com quem
--    e quando. `absenteismo_ponto` continua sendo o estado atual (a aba lê dele).
-- 3. O registro em Logs do sistema cita o colaborador, o tipo e o período (antes
--    o rótulo vinha vazio e a busca pelo nome não achava).

-- ---------------------------------------------------------------------------
-- Rótulo de um abono/compensação: "Compensação de FULANO (902, MATRIZ),
-- 17/11/2026 (1 dia)". Helper interno: a auditoria e o aviso usam.
-- ---------------------------------------------------------------------------
create or replace function public.absenteismo_rotulo_ponto(p_lancamento uuid)
returns text
language sql
stable
set search_path to 'public'
as $$
  select case when l.tratamento = 'compensacao' then 'Compensação' else 'Abono' end
         || ' de ' || coalesce(l.snap_full_name, 'colaborador')
         || case when l.snap_employee_code is not null or l.snap_unit_name is not null
                 then ' (' || concat_ws(', ', l.snap_employee_code, l.snap_unit_name) || ')' else '' end
         || ', '
         || case
              when l.partial_day and l.hours_start is not null and l.hours_end is not null then
                to_char(coalesce(l.start_date, l.occurred_on), 'DD/MM/YYYY')
                || ' das ' || to_char(l.hours_start, 'HH24:MI') || ' às ' || to_char(l.hours_end, 'HH24:MI')
              when l.end_date = '9999-12-31'::date then
                'desde ' || to_char(coalesce(l.start_date, l.occurred_on), 'DD/MM/YYYY') || ', sem data de término'
              when coalesce(l.start_date, l.occurred_on) = coalesce(l.end_date, l.start_date, l.occurred_on) then
                to_char(coalesce(l.start_date, l.occurred_on), 'DD/MM/YYYY') || ' (1 dia)'
              else
                to_char(l.start_date, 'DD/MM/YYYY') || ' a ' || to_char(l.end_date, 'DD/MM/YYYY')
                || ' (' || (l.end_date - l.start_date + 1) || ' dias)'
            end
    from public.absenteismo_lancamentos l
   where l.id = p_lancamento;
$$;
revoke execute on function public.absenteismo_rotulo_ponto(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Histórico da marca no ponto
-- ---------------------------------------------------------------------------
create table if not exists public.absenteismo_ponto_historico (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lancamento_id uuid not null references public.absenteismo_lancamentos(id) on delete cascade,
  acao text not null check (acao in ('lancado', 'desfeito', 'retirado')),
  por uuid references public.profiles(id) on delete set null,
  -- o relógio, não o início da transação: dois passos na mesma transação ficam em ordem
  em timestamptz not null default clock_timestamp()
);
comment on table public.absenteismo_ponto_historico is
  'Cada marca no ponto de um abono/compensação: lancado, desfeito (aprovado, a marca foi tirada) ou retirado (cancelado depois de lançado). Escrita só por absenteismo_marcar_ponto.';
create index if not exists absenteismo_ponto_historico_lanc_idx
  on public.absenteismo_ponto_historico (tenant_id, lancamento_id, em);

alter table public.absenteismo_ponto_historico enable row level security;
revoke all on table public.absenteismo_ponto_historico from public, anon, authenticated;
grant select on table public.absenteismo_ponto_historico to authenticated;

drop policy if exists absenteismo_ponto_historico_ler on public.absenteismo_ponto_historico;
create policy absenteismo_ponto_historico_ler on public.absenteismo_ponto_historico
  for select to authenticated
  using (
    tenant_id in (select public.my_role_tenant_ids('{owner,admin,hr}'::public.member_role[]))
    or tenant_id in (select public.my_gente_tenant_ids())
  );

-- a marca: estado atual em absenteismo_ponto, cada passo no histórico
create or replace function public.absenteismo_marcar_ponto(p_id uuid, p_lancado boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  l record;
  v_n int;
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
      raise exception 'Só abono ou compensação aprovados pelo DP vão para o ponto.';
    end if;
    insert into public.absenteismo_ponto (tenant_id, lancamento_id, lancado_por)
    values (l.tenant_id, l.id, (select auth.uid()))
    on conflict (lancamento_id) do nothing;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      insert into public.absenteismo_ponto_historico (tenant_id, lancamento_id, acao, por)
      values (l.tenant_id, l.id, 'lancado', (select auth.uid()));
    end if;
  else
    delete from public.absenteismo_ponto where lancamento_id = l.id;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      -- aprovado: desfez a marca por engano; cancelado: tirou do ponto de verdade
      insert into public.absenteismo_ponto_historico (tenant_id, lancamento_id, acao, por)
      values (l.tenant_id, l.id, case when l.status = 'aprovado' then 'desfeito' else 'retirado' end, (select auth.uid()));
    end if;
  end if;
end;
$function$;
revoke execute on function public.absenteismo_marcar_ponto(uuid, boolean) from public, anon;

-- ---------------------------------------------------------------------------
-- 1. Aviso à Área de Gente
-- ---------------------------------------------------------------------------
create or replace function public.absenteismo_avisar_ponto()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_acao text;
  v_dest uuid[];
  v_rotulo text;
  v_tipo text;
begin
  if not new.waived then
    return null;
  end if;
  if new.status = 'aprovado' and old.status is distinct from 'aprovado' then
    v_acao := 'lancar';
  elsif new.status = 'cancelado' and old.status = 'aprovado'
        and exists (select 1 from public.absenteismo_ponto p where p.lancamento_id = new.id) then
    v_acao := 'retirar';
  else
    return null;
  end if;

  select array_agg(m.user_id) into v_dest
    from public.memberships m
   where m.tenant_id = new.tenant_id and m.is_active and m.is_gente;
  if v_dest is null then
    select array_agg(m.user_id) into v_dest
      from public.memberships m
     where m.tenant_id = new.tenant_id and m.is_active and m.is_hr;
  end if;
  if v_dest is null then
    return null;
  end if;

  v_rotulo := public.absenteismo_rotulo_ponto(new.id);
  v_tipo := case when new.tratamento = 'compensacao' then 'Compensação' else 'Abono' end;

  if v_acao = 'lancar' then
    perform public.notify_users_sistema(
      new.tenant_id, v_dest, 'absenteismo_ponto',
      v_tipo || ' para lançar no ponto',
      v_rotulo || '. '
        || case when new.tratamento = 'compensacao'
                then 'Lance como débito no banco de horas'
                else 'Lance como abono no sistema de ponto' end
        || ' e marque em Abonos e compensações.');
  else
    perform public.notify_users_sistema(
      new.tenant_id, v_dest, 'absenteismo_ponto',
      'Retirar do ponto',
      v_rotulo || ' foi cancelado depois de lançado no ponto. Retire do sistema de ponto e confirme em Abonos e compensações.');
  end if;
  return null;
end;
$function$;
revoke execute on function public.absenteismo_avisar_ponto() from public, anon, authenticated;

drop trigger if exists trg_absenteismo_avisar_ponto on public.absenteismo_lancamentos;
create trigger trg_absenteismo_avisar_ponto
  after update of status on public.absenteismo_lancamentos
  for each row execute function public.absenteismo_avisar_ponto();

-- ---------------------------------------------------------------------------
-- 3. Log legível: o rótulo do registro de absenteismo_ponto
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  a text := $q$  v_label := coalesce(v_row->>'name', v_row->>'title', v_row->>'full_name', v_row->>'code', v_row->>'label', v_row->>'display_name');$q$;
begin
  v_def := pg_get_functiondef('public.audit_trigger()'::regprocedure);
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then
    raise exception 'audit_trigger mudou: âncora do rótulo não confere';
  end if;
  execute replace(v_def, a, a || $q$
  -- abono/compensação no ponto (LUIZ, 27/11/2026): de quem, qual e de quando
  if tg_table_name = 'absenteismo_ponto' then
    v_label := public.absenteismo_rotulo_ponto((v_row->>'lancamento_id')::uuid);
  end if;$q$);
end $$;
revoke execute on function public.audit_trigger() from public, anon, authenticated;

notify pgrst, 'reload schema';
