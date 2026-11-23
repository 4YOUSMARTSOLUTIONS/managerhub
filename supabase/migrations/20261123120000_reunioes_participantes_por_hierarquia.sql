-- Participantes de reunião por hierarquia (LUIZ, 23/11/2026).
--
-- A reunião pode ficar ligada a níveis de hierarquia (ex.: Gerência, Supervisão).
-- A lista se atualiza sozinha: quem entra no nível entra na reunião, quem sai ou é
-- desligado sai. Vale só para as unidades marcadas na reunião.
--
-- `meeting_series_participants` continua sendo a lista efetiva, então visibilidade,
-- presença, salas e convites não mudam. `via_nivel` marca quem está lá só pelo nível.
-- Quem foi tirado à mão de um nível ligado fica em `meeting_series_fora`, senão
-- voltaria na próxima atualização.

alter table public.meeting_series_participants
  add column if not exists via_nivel boolean not null default false;

create table public.meeting_series_niveis (
  series_id uuid not null references public.meeting_series(id) on delete cascade,
  hierarchy_level_id uuid not null references public.hierarchy_levels(id) on delete cascade,
  primary key (series_id, hierarchy_level_id)
);
create index meeting_series_niveis_nivel_idx on public.meeting_series_niveis (hierarchy_level_id);

create table public.meeting_series_fora (
  series_id uuid not null references public.meeting_series(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (series_id, user_id)
);
create index meeting_series_fora_user_idx on public.meeting_series_fora (user_id);

-- convites a enviar a quem entrou ou saiu sozinho da lista
create table public.meeting_series_convites_fila (
  series_id uuid not null references public.meeting_series(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  metodo text not null check (metodo in ('REQUEST', 'CANCEL')),
  tentativas int not null default 0,
  criado_em timestamptz not null default now(),
  primary key (series_id, user_id)
);
create index meeting_series_convites_fila_user_idx on public.meeting_series_convites_fila (user_id);

alter table public.meeting_series_niveis enable row level security;
alter table public.meeting_series_fora enable row level security;
alter table public.meeting_series_convites_fila enable row level security;

revoke all on table public.meeting_series_niveis from public, anon, authenticated;
revoke all on table public.meeting_series_fora from public, anon, authenticated;
revoke all on table public.meeting_series_convites_fila from public, anon, authenticated;
grant select on table public.meeting_series_niveis to authenticated;
grant select on table public.meeting_series_fora to authenticated;

create policy meeting_series_niveis_select on public.meeting_series_niveis
  for select to authenticated
  using (exists (select 1 from public.meeting_series s where s.id = series_id and public.can_view_series(s.*)));

create policy meeting_series_fora_select on public.meeting_series_fora
  for select to authenticated
  using (exists (select 1 from public.meeting_series s where s.id = series_id and public.can_view_series(s.*)));

-- participantes e unidades só mudam por save_meeting_series: gravar direto furaria
-- a regra de edição e deixaria a lista fora de sincronia com os níveis
drop policy msp_rw on public.meeting_series_participants;
create policy msp_select on public.meeting_series_participants
  for select to authenticated
  using (exists (select 1 from public.meeting_series s where s.id = series_id and public.can_view_series(s.*)));

drop policy msu_rw on public.meeting_series_units;
create policy msu_select on public.meeting_series_units
  for select to authenticated
  using (exists (select 1 from public.meeting_series s where s.id = series_id and public.can_view_series(s.*)));

revoke all on table public.meeting_series_participants from anon;
revoke all on table public.meeting_series_units from anon;
revoke insert, update, delete, truncate on table public.meeting_series_participants from authenticated;
revoke insert, update, delete, truncate on table public.meeting_series_units from authenticated;

-- reservas futuras e fila de convites acompanham quem entrou e saiu
create or replace function public.reuniao_aplicar_participantes(
  p_series uuid, p_entram uuid[], p_saem uuid[], p_convidar_entram boolean
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_auto boolean;
begin
  select s.auto_book into v_auto from public.meeting_series s where s.id = p_series;

  if cardinality(p_saem) > 0 then
    delete from public.meeting_participants mp
     using public.meetings m
     where mp.meeting_id = m.id and m.series_id = p_series
       and m.status = 'scheduled' and m.starts_at >= now()
       and not coalesce(m.series_detached, false)
       and mp.user_id = any(p_saem);
  end if;

  if cardinality(p_entram) > 0 then
    insert into public.meeting_participants (meeting_id, user_id)
    select m.id, u
      from public.meetings m
      cross join unnest(p_entram) u
     where m.series_id = p_series
       and m.status = 'scheduled' and m.starts_at >= now()
       and not coalesce(m.series_detached, false)
    on conflict do nothing;
  end if;

  if not coalesce(v_auto, false) then
    return;
  end if;

  -- saiu antes de o convite sair: não há o que cancelar
  if cardinality(p_saem) > 0 then
    with pendente as (
      delete from public.meeting_series_convites_fila f
       where f.series_id = p_series and f.user_id = any(p_saem) and f.metodo = 'REQUEST'
      returning f.user_id
    )
    insert into public.meeting_series_convites_fila (series_id, user_id, metodo)
    select p_series, u, 'CANCEL'
      from unnest(p_saem) u
     where u not in (select p.user_id from pendente p)
    on conflict (series_id, user_id) do update
      set metodo = 'CANCEL', tentativas = 0, criado_em = now();
  end if;

  -- voltou antes de o cancelamento sair: o convite dele continua valendo
  if cardinality(p_entram) > 0 then
    if p_convidar_entram then
      with pendente as (
        delete from public.meeting_series_convites_fila f
         where f.series_id = p_series and f.user_id = any(p_entram) and f.metodo = 'CANCEL'
        returning f.user_id
      )
      insert into public.meeting_series_convites_fila (series_id, user_id, metodo)
      select p_series, u, 'REQUEST'
        from unnest(p_entram) u
       where u not in (select p.user_id from pendente p)
      on conflict (series_id, user_id) do update
        set metodo = 'REQUEST', tentativas = 0, criado_em = now();
    else
      -- ao salvar a reunião, o convite já vai para a lista inteira
      delete from public.meeting_series_convites_fila f
       where f.series_id = p_series and f.user_id = any(p_entram);
    end if;
  end if;
end;
$function$;

revoke execute on function public.reuniao_aplicar_participantes(uuid, uuid[], uuid[], boolean) from public, anon, authenticated;

create or replace function public.sincronizar_participantes_nivel(p_series uuid, p_aplicar boolean default true)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_entram uuid[];
  v_saem uuid[];
begin
  select s.tenant_id into v_tenant
    from public.meeting_series s
   where s.id = p_series and s.deleted_at is null;
  if v_tenant is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('series_participantes:' || p_series::text));

  with devem as (
    select distinct m.user_id
      from public.memberships m
      join public.meeting_series_niveis n
        on n.series_id = p_series and n.hierarchy_level_id = m.hierarchy_level_id
     where m.tenant_id = v_tenant
       and m.is_active
       and (m.dismissed_at is null or m.dismissed_at > v_hoje)
       and exists (
         select 1
           from public.membership_units mu
           join public.meeting_series_units su on su.unit_id = mu.unit_id and su.series_id = p_series
          where mu.membership_id = m.id
       )
       and not exists (
         select 1 from public.meeting_series_fora f
          where f.series_id = p_series and f.user_id = m.user_id
       )
  ),
  saem as (
    delete from public.meeting_series_participants p
     where p.series_id = p_series and p.via_nivel
       and p.user_id not in (select d.user_id from devem d)
    returning p.user_id
  ),
  entram as (
    insert into public.meeting_series_participants (series_id, user_id, via_nivel)
    select p_series, d.user_id, true from devem d
    on conflict do nothing
    returning user_id
  )
  select coalesce((select array_agg(e.user_id) from entram e), '{}'::uuid[]),
         coalesce((select array_agg(s.user_id) from saem s), '{}'::uuid[])
    into v_entram, v_saem;

  if p_aplicar and (cardinality(v_entram) > 0 or cardinality(v_saem) > 0) then
    perform public.reuniao_aplicar_participantes(p_series, v_entram, v_saem, true);
  end if;
end;
$function$;

revoke execute on function public.sincronizar_participantes_nivel(uuid, boolean) from public, anon, authenticated;

-- rede de segurança diária: desligamento com data futura não mexe na linha no dia
create or replace function public.reunioes_sincronizar_niveis()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
begin
  for r in select distinct n.series_id from public.meeting_series_niveis n loop
    perform public.sincronizar_participantes_nivel(r.series_id);
  end loop;
end;
$function$;

revoke execute on function public.reunioes_sincronizar_niveis() from public, anon, authenticated;

create or replace function public.trg_participantes_por_membership()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid;
  v_niveis uuid[];
  r record;
begin
  if tg_op = 'INSERT' then
    v_tenant := new.tenant_id; v_niveis := array[new.hierarchy_level_id];
  elsif tg_op = 'DELETE' then
    v_tenant := old.tenant_id; v_niveis := array[old.hierarchy_level_id];
  else
    v_tenant := new.tenant_id; v_niveis := array[old.hierarchy_level_id, new.hierarchy_level_id];
  end if;

  for r in
    select distinct n.series_id
      from public.meeting_series_niveis n
      join public.meeting_series s on s.id = n.series_id
     where s.tenant_id = v_tenant and s.deleted_at is null
       and n.hierarchy_level_id = any(v_niveis)
  loop
    perform public.sincronizar_participantes_nivel(r.series_id);
  end loop;
  return null;
exception when others then
  -- salvar um colaborador nunca pode falhar por causa da lista de uma reunião;
  -- a rotina diária acerta o que ficar para trás
  raise warning 'trg_participantes_por_membership: %', sqlerrm;
  return null;
end;
$function$;

revoke execute on function public.trg_participantes_por_membership() from public, anon, authenticated;

create or replace function public.trg_participantes_por_unidade()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_membership uuid;
  v_tenant uuid;
  v_nivel uuid;
  r record;
begin
  v_membership := case when tg_op = 'DELETE' then old.membership_id else new.membership_id end;
  select m.tenant_id, m.hierarchy_level_id into v_tenant, v_nivel
    from public.memberships m where m.id = v_membership;
  if v_nivel is null then
    return null;
  end if;

  for r in
    select distinct n.series_id
      from public.meeting_series_niveis n
      join public.meeting_series s on s.id = n.series_id
     where s.tenant_id = v_tenant and s.deleted_at is null
       and n.hierarchy_level_id = v_nivel
  loop
    perform public.sincronizar_participantes_nivel(r.series_id);
  end loop;
  return null;
exception when others then
  raise warning 'trg_participantes_por_unidade: %', sqlerrm;
  return null;
end;
$function$;

revoke execute on function public.trg_participantes_por_unidade() from public, anon, authenticated;

create trigger participantes_por_nivel_ins
  after insert on public.memberships
  for each row when (new.hierarchy_level_id is not null)
  execute function public.trg_participantes_por_membership();

create trigger participantes_por_nivel_upd
  after update of hierarchy_level_id, is_active, dismissed_at on public.memberships
  for each row when (
    old.hierarchy_level_id is distinct from new.hierarchy_level_id
    or old.is_active is distinct from new.is_active
    or old.dismissed_at is distinct from new.dismissed_at
  )
  execute function public.trg_participantes_por_membership();

create trigger participantes_por_nivel_del
  after delete on public.memberships
  for each row when (old.hierarchy_level_id is not null)
  execute function public.trg_participantes_por_membership();

create trigger participantes_por_unidade
  after insert or delete on public.membership_units
  for each row execute function public.trg_participantes_por_unidade();

-- salvar a reunião grava também os níveis e quem foi tirado à mão
do $migracao$
declare
  v_def text := replace(pg_get_functiondef('public.save_meeting_series(jsonb)'::regprocedure), E'\r\n', E'\n');
  v_decl text := E'  v_uid uuid := auth.uid();\nbegin';
  v_decl_novo text := E'  v_uid uuid := auth.uid();\n  v_antes uuid[];\n  v_depois uuid[];\nbegin';
  v_fim text := $a$  delete from public.meeting_series_participants where series_id = v_id;
  insert into public.meeting_series_participants (series_id, user_id)
  select v_id, x::uuid from jsonb_array_elements_text(coalesce(p_data->'participants','[]'::jsonb)) x
  on conflict do nothing;

  delete from public.meeting_series_units where series_id = v_id;
  insert into public.meeting_series_units (series_id, unit_id)
  select v_id, x::uuid from jsonb_array_elements_text(coalesce(p_data->'units','[]'::jsonb)) x
  on conflict do nothing;

  return v_id;$a$;
  v_fim_novo text := $b$  select s.tenant_id into v_tenant from public.meeting_series s where s.id = v_id;
  v_antes := array(select p.user_id from public.meeting_series_participants p where p.series_id = v_id);

  delete from public.meeting_series_units where series_id = v_id;
  insert into public.meeting_series_units (series_id, unit_id)
  select v_id, x::uuid from jsonb_array_elements_text(coalesce(p_data->'units','[]'::jsonb)) x
  on conflict do nothing;

  if p_data ? 'hierarquias' then
    delete from public.meeting_series_niveis where series_id = v_id;
    insert into public.meeting_series_niveis (series_id, hierarchy_level_id)
    select v_id, h.id
      from public.hierarchy_levels h
     where h.tenant_id = v_tenant
       and h.id::text in (select jsonb_array_elements_text(coalesce(p_data->'hierarquias','[]'::jsonb)));

    -- `participants` são os escolhidos um a um; os do nível vêm da sincronização
    delete from public.meeting_series_participants where series_id = v_id;
    insert into public.meeting_series_participants (series_id, user_id, via_nivel)
    select v_id, m.user_id, false
      from public.memberships m
     where m.tenant_id = v_tenant
       and m.user_id::text in (select jsonb_array_elements_text(coalesce(p_data->'participants','[]'::jsonb)))
    on conflict do nothing;

    delete from public.meeting_series_fora where series_id = v_id;
    insert into public.meeting_series_fora (series_id, user_id)
    select v_id, m.user_id
      from public.memberships m
     where m.tenant_id = v_tenant
       and m.user_id::text in (select jsonb_array_elements_text(coalesce(p_data->'fora','[]'::jsonb)))
       and not exists (
         select 1 from public.meeting_series_participants p
          where p.series_id = v_id and p.user_id = m.user_id
       );
  else
    -- formulário aberto antes desta versão: manda a lista inteira e não conhece
    -- os níveis, então quem veio por nível continua marcado como tal
    delete from public.meeting_series_participants p
     where p.series_id = v_id
       and p.user_id::text not in (select jsonb_array_elements_text(coalesce(p_data->'participants','[]'::jsonb)));
    insert into public.meeting_series_participants (series_id, user_id, via_nivel)
    select v_id, m.user_id, false
      from public.memberships m
     where m.tenant_id = v_tenant
       and m.user_id::text in (select jsonb_array_elements_text(coalesce(p_data->'participants','[]'::jsonb)))
    on conflict do nothing;
  end if;

  perform public.sincronizar_participantes_nivel(v_id, false);

  v_depois := array(select p.user_id from public.meeting_series_participants p where p.series_id = v_id);
  if cardinality(v_depois) = 0 then
    raise exception 'Selecione ao menos um usuário participante';
  end if;
  perform public.reuniao_aplicar_participantes(
    v_id,
    array(select u from unnest(v_depois) u where not (u = any(v_antes))),
    array(select u from unnest(v_antes) u where not (u = any(v_depois))),
    false
  );

  return v_id;$b$;
begin
  if position(v_decl in v_def) = 0 or position(v_fim in v_def) = 0 then
    raise exception 'save_meeting_series: trecho esperado não encontrado';
  end if;
  execute replace(replace(v_def, v_decl, v_decl_novo), v_fim, v_fim_novo);
end
$migracao$;

revoke execute on function public.save_meeting_series(jsonb) from public, anon;
grant execute on function public.save_meeting_series(jsonb) to authenticated;

-- o que o formulário precisa para contar e listar as pessoas de cada nível
create or replace function public.reuniao_niveis_pessoas()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with ctx as materialized (
    select public.my_active_tenant() as tenant,
           public.is_tenant_member(public.my_active_tenant()) as membro,
           (now() at time zone 'America/Sao_Paulo')::date as hoje
  )
  select case when ctx.membro then jsonb_build_object(
    'niveis', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'nome', h.name, 'ativo', h.active) order by h.rank, h.name)
        from public.hierarchy_levels h
       where h.tenant_id = ctx.tenant
    ), '[]'::jsonb),
    'pessoas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.user_id,
               'nivel', m.hierarchy_level_id,
               'unidades', coalesce((
                 select jsonb_agg(mu.unit_id) from public.membership_units mu where mu.membership_id = m.id
               ), '[]'::jsonb)
             ))
        from public.memberships m
       where m.tenant_id = ctx.tenant
         and m.is_active
         and (m.dismissed_at is null or m.dismissed_at > ctx.hoje)
         and m.hierarchy_level_id is not null
    ), '[]'::jsonb)
  ) else '{"niveis": [], "pessoas": []}'::jsonb end
  from ctx;
$function$;

revoke execute on function public.reuniao_niveis_pessoas() from public, anon;
grant execute on function public.reuniao_niveis_pessoas() to authenticated;

-- envio dos convites pendentes: o banco chama o app com o segredo do Vault
create or replace function public.reunioes_disparar_convites()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_segredo text;
begin
  -- cinco tentativas sem sair: desiste, para a fila não crescer para sempre
  delete from public.meeting_series_convites_fila f where f.tentativas >= 5;

  if not exists (select 1 from public.meeting_series_convites_fila f where f.tentativas < 5) then
    return;
  end if;
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'push_webhook_segredo';
  if v_segredo is null then
    return;
  end if;
  perform net.http_post(
    url := 'https://managerhub.4yousmartsolutions.com.br/api/reunioes-convites',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-segredo', v_segredo),
    timeout_milliseconds := 30000
  );
end;
$function$;

revoke execute on function public.reunioes_disparar_convites() from public, anon, authenticated;

create or replace function public.reuniao_convites_pegar(p_segredo text)
returns table (o_series uuid, o_user uuid, o_metodo text)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_segredo is null
     or p_segredo is distinct from (select decrypted_secret from vault.decrypted_secrets where name = 'push_webhook_segredo') then
    raise exception 'não autorizado' using errcode = '42501';
  end if;

  return query
  with lote as (
    select f.series_id as s, f.user_id as u
      from public.meeting_series_convites_fila f
     where f.tentativas < 5
     order by f.criado_em
     limit 300
     for update skip locked
  )
  update public.meeting_series_convites_fila f
     set tentativas = f.tentativas + 1
    from lote
   where f.series_id = lote.s and f.user_id = lote.u
  returning f.series_id, f.user_id, f.metodo;
end;
$function$;

revoke execute on function public.reuniao_convites_pegar(text) from public, anon, authenticated;
grant execute on function public.reuniao_convites_pegar(text) to service_role;

create or replace function public.reuniao_convites_concluir(p_segredo text, p_series uuid, p_users uuid[], p_metodo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_segredo is null
     or p_segredo is distinct from (select decrypted_secret from vault.decrypted_secrets where name = 'push_webhook_segredo') then
    raise exception 'não autorizado' using errcode = '42501';
  end if;
  delete from public.meeting_series_convites_fila f
   where f.series_id = p_series and f.user_id = any(p_users) and f.metodo = p_metodo;
end;
$function$;

revoke execute on function public.reuniao_convites_concluir(text, uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.reuniao_convites_concluir(text, uuid, uuid[], text) to service_role;

select cron.schedule('reunioes-convites-pendentes', '*/10 * * * *', 'select public.reunioes_disparar_convites();');
select cron.schedule('reunioes-sincronizar-niveis', '10 3 * * *', 'select public.reunioes_sincronizar_niveis();');

notify pgrst, 'reload schema';
