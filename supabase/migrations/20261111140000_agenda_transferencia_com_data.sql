-- Transferência de agenda com data (LUIZ, 11/11/2026).
--
-- A agenda é da FUNÇÃO e passa para quem assume a função. Até aqui só existia
-- `agendas.responsible_id` (o responsável de AGORA), e diário, aderência e
-- Tempos e movimentos atribuíam a ele o passado inteiro: trocar o responsável
-- tirava o histórico de quem saiu e dava a quem entrou dias que ele não
-- trabalhou. Agora cada agenda guarda os períodos de cada responsável
-- (`de` incluso, `ate` exclusivo, como `membership_history`), e as telas
-- perguntam quem era o responsável NAQUELE dia.
--
-- Quem já foi responsável continua lendo a agenda e pode marcar os dias do
-- próprio período (e o gestor dele também); o resto das permissões segue o
-- responsável atual, como antes.

-- ---------- 1. os períodos ----------
create table public.agenda_responsaveis (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agenda_id uuid not null references public.agendas(id) on delete cascade,
  user_id uuid not null,
  de date not null,
  ate date,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint agenda_responsaveis_periodo check (ate is null or ate > de),
  constraint agenda_responsaveis_sem_sobreposicao
    exclude using gist (agenda_id with =, daterange(de, ate, '[)') with &&)
);
create unique index agenda_responsaveis_em_vigor on public.agenda_responsaveis (agenda_id) where ate is null;
create index agenda_responsaveis_user_idx on public.agenda_responsaveis (user_id);

alter table public.agenda_responsaveis enable row level security;
revoke all on table public.agenda_responsaveis from public, anon, authenticated;
grant select on table public.agenda_responsaveis to authenticated;
-- lê quem lê a agenda (a policy de agendas já decide); escrita só pelo gatilho
create policy agenda_responsaveis_select on public.agenda_responsaveis
  for select to authenticated
  using (exists (select 1 from public.agendas a where a.id = agenda_responsaveis.agenda_id));

-- o responsável de hoje vira o primeiro período, desde a criação da agenda
-- (mesma data que o app usa para "não cobra antes de existir")
insert into public.agenda_responsaveis (tenant_id, agenda_id, user_id, de, created_by)
select a.tenant_id, a.id, a.responsible_id, (a.created_at at time zone 'UTC')::date, a.created_by
  from public.agendas a;

-- ---------- 2. o gatilho mantém os períodos ----------
create or replace function public.agenda_registrar_responsavel()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_dia date;
  v_atual record;
  v_anterior record;
begin
  if tg_op = 'INSERT' then
    insert into public.agenda_responsaveis (tenant_id, agenda_id, user_id, de, created_by)
    values (new.tenant_id, new.id, new.responsible_id,
            (coalesce(new.created_at, now()) at time zone 'UTC')::date, auth.uid());
    return new;
  end if;

  if new.responsible_id is not distinct from old.responsible_id then
    return new;
  end if;

  -- a data vem de agenda_transferir; trocar pelo formulário vale a partir de hoje
  v_dia := coalesce(nullif(current_setting('agenda.transferir_em', true), '')::date,
                    (now() at time zone 'America/Sao_Paulo')::date);

  select * into v_atual from public.agenda_responsaveis
   where agenda_id = new.id and ate is null
   for update;

  if v_atual.id is null then
    insert into public.agenda_responsaveis (tenant_id, agenda_id, user_id, de, created_by)
    values (new.tenant_id, new.id, new.responsible_id, v_dia, auth.uid());
    return new;
  end if;

  if v_dia < v_atual.de then
    raise exception 'A transferência não pode ser anterior a %, quando o responsável atual assumiu a agenda.',
      to_char(v_atual.de, 'DD/MM/YYYY');
  end if;

  if v_dia = v_atual.de then
    -- troca no mesmo dia em que o atual assumiu: o período passa inteiro para o novo,
    -- e se o novo é quem tinha o período anterior, os dois se juntam
    select * into v_anterior from public.agenda_responsaveis
     where agenda_id = new.id and ate = v_atual.de;
    if v_anterior.id is not null and v_anterior.user_id = new.responsible_id then
      delete from public.agenda_responsaveis where id = v_atual.id;
      update public.agenda_responsaveis set ate = null where id = v_anterior.id;
    else
      update public.agenda_responsaveis set user_id = new.responsible_id, created_by = auth.uid()
       where id = v_atual.id;
    end if;
  else
    update public.agenda_responsaveis set ate = v_dia where id = v_atual.id;
    insert into public.agenda_responsaveis (tenant_id, agenda_id, user_id, de, created_by)
    values (new.tenant_id, new.id, new.responsible_id, v_dia, auth.uid());
  end if;
  return new;
end;
$$;
revoke execute on function public.agenda_registrar_responsavel() from public, anon, authenticated;

create trigger agenda_registrar_responsavel
  after insert or update of responsible_id on public.agendas
  for each row execute function public.agenda_registrar_responsavel();

-- ---------- 3. transferir com data ----------
create or replace function public.agenda_transferir(p_agenda uuid, p_novo uuid, p_data date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ag record;
  v_atual record;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into v_ag from public.agendas where id = p_agenda;
  if v_ag.id is null or not public.agenda_can_admin(v_ag.tenant_id, v_ag.owner_id) then
    raise exception 'Você não pode transferir esta agenda.' using errcode = '42501';
  end if;
  if v_ag.imprevistos then
    raise exception 'A agenda de demandas não previstas é da própria pessoa e não se transfere.';
  end if;
  if not v_ag.active then
    raise exception 'Reative a agenda antes de transferir.';
  end if;
  if p_novo is null or p_novo = v_ag.responsible_id then
    raise exception 'Escolha um responsável diferente do atual.';
  end if;
  if not exists (
    select 1 from public.memberships m
     where m.user_id = p_novo and m.tenant_id = v_ag.tenant_id and m.is_active
  ) then
    raise exception 'Escolha um colaborador ativo.';
  end if;
  if p_data is null then
    raise exception 'Informe a partir de quando a agenda passa para o novo responsável.';
  end if;
  if p_data > v_hoje then
    raise exception 'A transferência vale de hoje para trás: escolha hoje ou uma data passada.';
  end if;
  select * into v_atual from public.agenda_responsaveis where agenda_id = p_agenda and ate is null;
  if v_atual.id is not null and p_data < v_atual.de then
    raise exception 'A data não pode ser anterior a %, quando o responsável atual assumiu a agenda.',
      to_char(v_atual.de, 'DD/MM/YYYY');
  end if;

  perform set_config('agenda.transferir_em', p_data::text, true);
  -- a regra de uma agenda ativa por pessoa vale aqui também (gatilho próprio)
  update public.agendas
     set responsible_id = p_novo,
         can_responsible_edit = case when p_novo = owner_id then true else can_responsible_edit end,
         updated_at = now()
   where id = p_agenda;
  perform set_config('agenda.transferir_em', '', true);
end;
$$;
revoke execute on function public.agenda_transferir(uuid, uuid, date) from public, anon;

-- ---------- 4. quem já foi responsável (e o gestor dele) ----------
-- Usadas nas policies, por isso `authenticated` executa; só respondem sobre o
-- próprio usuário (auth.uid()) e a cadeia dele.
create or replace function public.agenda_ve_pelo_historico(p_agenda uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.agenda_responsaveis v
     where v.agenda_id = p_agenda
       and public.is_tenant_member(v.tenant_id)
       and (v.user_id = auth.uid() or public.manages_user(v.user_id, v.tenant_id))
  );
$$;
revoke execute on function public.agenda_ve_pelo_historico(uuid) from public, anon;

create or replace function public.agenda_preenche_no_dia(p_agenda uuid, p_dia date)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.agenda_responsaveis v
     where v.agenda_id = p_agenda
       and v.de <= p_dia and (v.ate is null or p_dia < v.ate)
       and public.is_tenant_member(v.tenant_id)
       and (v.user_id = auth.uid() or public.manages_user(v.user_id, v.tenant_id))
  );
$$;
revoke execute on function public.agenda_preenche_no_dia(uuid, date) from public, anon;

-- ---------- 5. policies: o mesmo de antes + o histórico ----------
drop policy ag_select on public.agendas;
create policy ag_select on public.agendas for select
  using (agenda_can_view(tenant_id, owner_id, responsible_id) or agenda_ve_pelo_historico(id));

drop policy ag_task_select on public.agenda_tasks;
create policy ag_task_select on public.agenda_tasks for select
  using (exists (select 1 from public.agendas a
                  where a.id = agenda_tasks.agenda_id
                    and (agenda_can_view(a.tenant_id, a.owner_id, a.responsible_id) or agenda_ve_pelo_historico(a.id))));

drop policy ag_log_select on public.agenda_logs;
create policy ag_log_select on public.agenda_logs for select
  using (exists (select 1 from public.agendas a
                  where a.id = agenda_logs.agenda_id
                    and (agenda_can_view(a.tenant_id, a.owner_id, a.responsible_id) or agenda_ve_pelo_historico(a.id))));

drop policy ag_log_write on public.agenda_logs;
create policy ag_log_write on public.agenda_logs for all
  using (exists (select 1 from public.agendas a
                  where a.id = agenda_logs.agenda_id
                    and agenda_can_fill(a.tenant_id, a.owner_id, a.responsible_id))
         or agenda_preenche_no_dia(agenda_logs.agenda_id, agenda_logs.log_date))
  with check (exists (select 1 from public.agendas a
                       where a.id = agenda_logs.agenda_id
                         and agenda_can_fill(a.tenant_id, a.owner_id, a.responsible_id))
              or agenda_preenche_no_dia(agenda_logs.agenda_id, agenda_logs.log_date));

drop policy ag_cmt_select on public.agenda_log_comments;
create policy ag_cmt_select on public.agenda_log_comments for select
  using (exists (select 1 from public.agenda_logs l join public.agendas a on a.id = l.agenda_id
                  where l.id = agenda_log_comments.log_id
                    and (agenda_can_view(a.tenant_id, a.owner_id, a.responsible_id) or agenda_ve_pelo_historico(a.id))));

drop policy ag_cmt_insert on public.agenda_log_comments;
create policy ag_cmt_insert on public.agenda_log_comments for insert
  with check (author_id = (select auth.uid())
              and exists (select 1 from public.agenda_logs l join public.agendas a on a.id = l.agenda_id
                           where l.id = agenda_log_comments.log_id
                             and (agenda_can_view(a.tenant_id, a.owner_id, a.responsible_id) or agenda_ve_pelo_historico(a.id))));

drop policy ag_att_select on public.agenda_log_attachments;
create policy ag_att_select on public.agenda_log_attachments for select
  using (exists (select 1 from public.agenda_logs l join public.agendas a on a.id = l.agenda_id
                  where l.id = agenda_log_attachments.log_id
                    and (agenda_can_view(a.tenant_id, a.owner_id, a.responsible_id) or agenda_ve_pelo_historico(a.id))));

drop policy ag_att_insert on public.agenda_log_attachments;
create policy ag_att_insert on public.agenda_log_attachments for insert
  with check (uploaded_by = (select auth.uid())
              and exists (select 1 from public.agenda_logs l join public.agendas a on a.id = l.agenda_id
                           where l.id = agenda_log_attachments.log_id
                             and (agenda_can_fill(a.tenant_id, a.owner_id, a.responsible_id)
                                  or agenda_preenche_no_dia(l.agenda_id, l.log_date))));

notify pgrst, 'reload schema';
