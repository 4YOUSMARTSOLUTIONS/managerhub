-- O alerta periódico de férias a vencer e vencidas.
--
-- O período concessivo (12 meses após o aquisitivo) é o prazo em que a empresa
-- PRECISA conceder as férias; estourou, paga em dobro (art. 137). Ninguém abre
-- o painel todo dia para vigiar isso, então um job semanal varre os vínculos e
-- avisa o DP e o gestor de cada colaborador com aquisitivo a 90 dias do
-- estouro ('a_vencer') ou já estourado ('vencida').
--
-- A tabela de dedup existe porque o cron roda toda semana e o sino não pode
-- virar martelo: cada (pessoa, aquisitivo, tipo) avisa UMA vez. Quando o
-- 'a_vencer' vira 'vencida', o tipo muda e o aviso sai de novo, de propósito.

create table public.ferias_alertas_enviados (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  aquisitivo_inicio date not null,
  tipo text not null check (tipo in ('a_vencer', 'vencida')),
  sent_at timestamptz not null default now(),
  primary key (tenant_id, user_id, aquisitivo_inicio, tipo)
);

alter table public.ferias_alertas_enviados enable row level security;

-- só o DP lê (é telemetria do módulo); a escrita é exclusiva da função do cron
create policy ferias_alertas_enviados_select on public.ferias_alertas_enviados
  for select using (public.has_tenant_role(tenant_id, '{owner,admin,hr}'::public.member_role[]));

revoke all on table public.ferias_alertas_enviados from public, anon, authenticated;
grant select on table public.ferias_alertas_enviados to authenticated;

-- Roda como postgres pelo pg_cron (sem sessão), por isso o revoke inclui
-- authenticated: ninguém dispara o varredor pelo PostgREST. As notificações
-- usam notify_users_sistema, que valida o DESTINATÁRIO e não o chamador.
create or replace function public.ferias_alertas_vencimento()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  m record;
  a record;
  v_dp uuid[];
  v_avisar uuid[];
  v_titulo text;
  v_corpo text;
  v_tipo text;
  v_n integer := 0;
begin
  for m in
    select ms.tenant_id, ms.user_id, ms.manager_id, p.full_name
      from public.memberships ms
      join public.profiles p on p.id = ms.user_id
     where ms.is_active and ms.admission_date is not null
  loop
    for a in
      -- Vencida só se o estouro é RECENTE (último ano): sem o corte, quem foi
      -- admitido anos antes do sistema dispararia um alerta por aquisitivo
      -- antigo, que é ruído de histórico não importado, não pendência real.
      select * from public.ferias_periodos_aquisitivos(m.tenant_id, m.user_id, current_date)
       where saldo > 0
         and (situacao = 'a_vencer'
              or (situacao = 'vencida' and concessivo_fim >= current_date - 365))
    loop
      v_tipo := a.situacao;
      if exists (
        select 1 from public.ferias_alertas_enviados f
         where f.tenant_id = m.tenant_id and f.user_id = m.user_id
           and f.aquisitivo_inicio = a.aq_inicio and f.tipo = v_tipo) then
        continue;
      end if;

      if v_tipo = 'a_vencer' then
        v_titulo := 'Férias a vencer';
        v_corpo := coalesce(m.full_name, 'Colaborador') || ': o período concessivo do aquisitivo ' ||
          to_char(a.aq_inicio, 'YYYY') || '/' || to_char(a.aq_fim, 'YYYY') ||
          ' termina em ' || to_char(a.concessivo_fim, 'DD/MM/YYYY') ||
          ', com ' || a.saldo || ' dia(s) de saldo. Programe as férias antes do prazo.';
      else
        v_titulo := 'Férias vencidas';
        v_corpo := coalesce(m.full_name, 'Colaborador') || ': o período concessivo do aquisitivo ' ||
          to_char(a.aq_inicio, 'YYYY') || '/' || to_char(a.aq_fim, 'YYYY') ||
          ' terminou em ' || to_char(a.concessivo_fim, 'DD/MM/YYYY') ||
          ' com ' || a.saldo || ' dia(s) de saldo. A concessão agora é em dobro (art. 137).';
      end if;

      v_dp := public.ferias_destinatarios_dp(m.tenant_id);
      v_avisar := coalesce(v_dp, '{}');
      if m.manager_id is not null then
        v_avisar := v_avisar || m.manager_id;
      end if;
      if array_length(v_avisar, 1) > 0 then
        perform public.notify_users_sistema(
          m.tenant_id, v_avisar,
          'ferias_' || v_tipo, v_titulo, v_corpo);
      end if;

      insert into public.ferias_alertas_enviados (tenant_id, user_id, aquisitivo_inicio, tipo)
      values (m.tenant_id, m.user_id, a.aq_inicio, v_tipo)
      on conflict do nothing;
      v_n := v_n + 1;
    end loop;
  end loop;

  return v_n;
end;
$$;

revoke execute on function public.ferias_alertas_vencimento() from public, anon, authenticated;

create extension if not exists pg_cron;

-- segunda-feira, 9h UTC (6h em Brasília): o aviso espera o DP chegar
select cron.unschedule(jobid) from cron.job where jobname = 'ferias-alertas-vencimento';
select cron.schedule('ferias-alertas-vencimento', '0 9 * * 1',
  $$select public.ferias_alertas_vencimento();$$);

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
