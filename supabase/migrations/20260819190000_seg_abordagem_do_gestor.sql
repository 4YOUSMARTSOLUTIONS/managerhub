-- A conversa do gestor: o alerta deixa de ser um aviso solto e vira um ciclo.
--
-- Hoje `seg_alertar_gestor` dispara uma notificação e acaba. Ninguém sabe se o
-- gestor conversou com a equipe, e a segurança fica repetindo alerta no vazio.
-- O item 1.2 do pilar chama isso de tratativa comportamental: alertar é meio
-- serviço, o serviço é a conversa acontecer e ficar registrada.
--
-- O NÓ DESTE MÓDULO É O ANONIMATO, e ele continua valendo aqui. O gestor não
-- alcança a linha de `seg_relatos` (a RLS é `pode_ver_relato`, e ele não passa),
-- então ele não pode simplesmente "abrir o relato para responder". A saída é a
-- de sempre no projeto: a linha continua fora do alcance dele, e o que ele
-- enxerga vem de uma RPC SECURITY DEFINER que escolhe as colunas uma a uma.
-- `created_by` não está entre elas, e não é a tela que decide isso.
--
-- Uma linha por alerta, e a conversa mora na mesma linha: um alerta tem no
-- máximo uma tratativa, e essa cardinalidade fica estrutural em vez de virar
-- regra escrita em algum lugar.

create table public.seg_alertas (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  relato_id         uuid not null references public.seg_relatos(id) on delete cascade,
  gestor_id         uuid not null references public.profiles(id) on delete cascade,
  -- com quem o gestor precisa conversar. É o carimbo do envolvido, não o
  -- vínculo de hoje: quem mudou de equipe depois não reescreve o alerta.
  envolvido_id      uuid references public.profiles(id) on delete set null,
  envolvido_nome    text,
  enviado_por       uuid references public.profiles(id) on delete set null,
  enviado_em        timestamptz not null default now(),
  abordagem_em      date,
  abordagem_resumo  text,
  abordagem_acordo  text,
  registrada_em     timestamptz,
  constraint seg_alerta_unico unique (relato_id, gestor_id),
  constraint seg_alerta_conversa_completa
    check ((registrada_em is null) = (abordagem_em is null))
);
create index seg_alertas_gestor_idx on public.seg_alertas (gestor_id, enviado_em desc);
create index seg_alertas_tenant_idx on public.seg_alertas (tenant_id, enviado_em desc);
create index seg_alertas_relato_idx on public.seg_alertas (relato_id);

alter table public.seg_alertas enable row level security;

-- O gestor lê o próprio alerta; a segurança lê todos, para cobrar. Ninguém
-- mais, nem o envolvido: a linha aponta para o relato, e um caminho a menos é
-- um caminho a menos.
create policy seg_alertas_select on public.seg_alertas
  for select using (
    gestor_id = (select auth.uid())
    or public.pode_tratar_seguranca(tenant_id)
  );

-- Escrita é só por RPC. Sem policy de update, o gestor não consegue reescrever
-- `gestor_id` nem carimbar conversa em alerta alheio pelo PostgREST.
revoke all on table public.seg_alertas from public, anon, authenticated;
grant  select on table public.seg_alertas to authenticated;

drop trigger if exists audit_seg_alertas on public.seg_alertas;
create trigger audit_seg_alertas after insert or update or delete on public.seg_alertas
  for each row execute function public.audit_trigger();

/**
 * Alerta o gestor, agora deixando rastro.
 *
 * A notificação continua igual e continua sem o relator. O que muda é que cada
 * gestor avisado ganha uma linha, que é o que permite cobrar a conversa depois.
 * Reenviar o alerta não duplica nem apaga a conversa já registrada.
 */
create or replace function public.seg_alertar_gestor(p_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_r      record;
  v_tipo   text;
  v_onde   text;
  v_gestores uuid[];
begin
  select r.* into v_r from public.seg_relatos r where r.id = p_id;
  if v_r.id is null then
    raise exception 'Relato não encontrado.';
  end if;
  perform public.seg_exige_tratativa(v_r.tenant_id);

  select array_agg(distinct e.snap_manager_id) into v_gestores
    from public.seg_relato_envolvidos e
   where e.relato_id = p_id and e.snap_manager_id is not null;

  if v_gestores is null then
    return 0;
  end if;

  select t.name into v_tipo from public.seg_tipos_relato t where t.id = v_r.tipo_id;

  select coalesce(
    nullif(concat_ws(' · ', l.name, a.name), ''),
    'local não informado'
  ) into v_onde
    from (select 1) x
    left join public.seg_locais l on l.id = v_r.local_id
    left join public.seg_areas  a on a.id = v_r.area_id;

  -- uma linha por (relato, gestor). O `distinct on` escolhe um envolvido para
  -- nomear a conversa quando o mesmo gestor tem dois citados no mesmo relato.
  insert into public.seg_alertas (
    tenant_id, relato_id, gestor_id, envolvido_id, envolvido_nome, enviado_por
  )
  select distinct on (e.snap_manager_id)
    v_r.tenant_id, p_id, e.snap_manager_id, e.user_id, e.snap_full_name, (select auth.uid())
    from public.seg_relato_envolvidos e
   where e.relato_id = p_id and e.snap_manager_id is not null
   order by e.snap_manager_id, e.created_at
  on conflict (relato_id, gestor_id) do nothing;

  perform public.notify_users(
    v_r.tenant_id, v_gestores, 'seg_relato_alerta',
    'Relato de segurança na sua equipe',
    coalesce(v_tipo, 'Relato') || ' em ' || to_char(v_r.occurred_on, 'DD/MM/YYYY')
      || ' (' || v_onde || '). ' || v_r.descricao
      || ' Converse com a equipe e registre o que foi feito.',
    null
  );

  return array_length(v_gestores, 1);
end;
$$;

revoke execute on function public.seg_alertar_gestor(uuid) from public, anon;
grant  execute on function public.seg_alertar_gestor(uuid) to authenticated;

/**
 * Os alertas do gestor que está chamando, com o fato e SEM o relator.
 *
 * A projeção é escrita coluna a coluna de propósito: é aqui, e não na tela, que
 * se decide o que o gestor pode ver de um relato que a RLS lhe nega por
 * inteiro.
 */
create or replace function public.seg_meus_alertas()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(x order by x->>'enviado_em' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', al.id,
      'enviado_em', al.enviado_em,
      'envolvido_nome', al.envolvido_nome,
      'occurred_on', r.occurred_on,
      'tipo', t.name,
      'ocorrencia', o.name,
      'local', l.name,
      'area', a.name,
      'descricao', r.descricao,
      'status', r.status,
      'abordagem_em', al.abordagem_em,
      'abordagem_resumo', al.abordagem_resumo,
      'abordagem_acordo', al.abordagem_acordo
    ) as x
    from public.seg_alertas al
    join public.seg_relatos r on r.id = al.relato_id
    left join public.seg_tipos_relato t on t.id = r.tipo_id
    left join public.seg_ocorrencias  o on o.id = r.ocorrencia_id
    left join public.seg_locais       l on l.id = r.local_id
    left join public.seg_areas        a on a.id = r.area_id
    where al.gestor_id = (select auth.uid())
    order by al.enviado_em desc
    limit 200
  ) s;
$$;

revoke execute on function public.seg_meus_alertas() from public, anon;
grant  execute on function public.seg_meus_alertas() to authenticated;

/**
 * O gestor registra a conversa.
 *
 * Só o gestor alertado registra: a conversa é dele, e deixar a segurança
 * preencher no lugar dele transformaria o indicador em ficção. A equipe é
 * avisada quando acontece, que é o fecho do ciclo do lado dela.
 */
create or replace function public.seg_registrar_abordagem(
  p_alerta uuid,
  p_em date,
  p_resumo text,
  p_acordo text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_a      record;
  v_resumo text := btrim(coalesce(p_resumo, ''));
  v_avisar uuid[];
begin
  select al.* into v_a from public.seg_alertas al where al.id = p_alerta;
  if v_a.id is null then
    raise exception 'Alerta não encontrado.';
  end if;
  if v_a.gestor_id <> (select auth.uid()) then
    raise exception 'Só o gestor que recebeu o alerta registra a conversa.';
  end if;
  if p_em is null then
    raise exception 'Informe a data da conversa.';
  end if;
  if p_em > current_date then
    raise exception 'A data da conversa não pode estar no futuro.';
  end if;
  if v_resumo = '' then
    raise exception 'Escreva o que foi conversado.';
  end if;

  update public.seg_alertas
     set abordagem_em = p_em,
         abordagem_resumo = v_resumo,
         abordagem_acordo = nullif(btrim(coalesce(p_acordo, '')), ''),
         registrada_em = now()
   where id = p_alerta;

  select array_agg(distinct uid) into v_avisar from (
    select e.user_id as uid from public.seg_equipe e where e.tenant_id = v_a.tenant_id
    union
    select m.user_id from public.memberships m
     where m.tenant_id = v_a.tenant_id and m.role in ('owner', 'admin') and m.is_active
  ) todos;

  if v_avisar is not null then
    perform public.notify_users(
      v_a.tenant_id, v_avisar, 'seg_abordagem_registrada',
      'Conversa registrada por um gestor',
      'O gestor alertado registrou a tratativa com a equipe em '
        || to_char(p_em, 'DD/MM/YYYY') || '.',
      null
    );
  end if;
end;
$$;

revoke execute on function public.seg_registrar_abordagem(uuid, date, text, text) from public, anon;
grant  execute on function public.seg_registrar_abordagem(uuid, date, text, text) to authenticated;

/** Quantos alertas viraram conversa no ano. Só para quem trata segurança. */
create or replace function public.seg_alertas_resumo(p_ano int default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := public.my_active_tenant();
  v_ano    int  := coalesce(p_ano, extract(year from current_date)::int);
  v_env    int;
  v_conv   int;
begin
  if v_tenant is null or not public.pode_tratar_seguranca(v_tenant) then
    return jsonb_build_object('enviados', 0, 'com_conversa', 0, 'visivel', false);
  end if;

  select count(*), count(*) filter (where al.registrada_em is not null)
    into v_env, v_conv
    from public.seg_alertas al
   where al.tenant_id = v_tenant
     and extract(year from al.enviado_em) = v_ano;

  return jsonb_build_object('enviados', v_env, 'com_conversa', v_conv, 'visivel', true);
end;
$$;

revoke execute on function public.seg_alertas_resumo(int) from public, anon;
grant  execute on function public.seg_alertas_resumo(int) to authenticated;

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
