-- Foco da área: o que a análise de causa-raiz vira na prática.
--
-- Ter a causa dominante no painel é meio caminho. O outro meio é a área SABER
-- que o assunto dela naquele mês é aquele. É o que o item 1.2 do pilar
-- Segurança pede quando fala em direcionar a atuação a partir da tendência: a
-- equipe olha "o Armazém teve 18 desvios e 11 são EPI indisponível", define o
-- foco do trimestre, e a partir daí quem abre um relato naquela área lê a
-- orientação antes de escrever.
--
-- VIGÊNCIA, e uma de cada vez. Foco sem data de fim vira cartaz velho na
-- parede, que ninguém lê depois do segundo mês. E dois focos sobrepostos na
-- mesma área são duas mensagens concorrentes, que é o mesmo que nenhuma; por
-- isso a exclusão por período (btree_gist), e não um simples índice único: a
-- garantia é do banco, não da tela.
--
-- O foco é PÚBLICO para a empresa. Ele não contém relator, não contém
-- envolvido e não contém fato: contém orientação. Esconder isso da operação
-- seria esvaziar o motivo de existir dele.

create table public.seg_focos (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  area_id    uuid not null references public.seg_areas(id) on delete cascade,
  -- a causa que motivou o foco. Fica guardada para o painel poder responder a
  -- única pergunta que interessa depois: ela caiu?
  causa_id   uuid references public.seg_causas(id) on delete set null,
  titulo     text not null,
  orientacao text,
  inicio     date not null,
  fim        date not null,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seg_foco_titulo_nao_vazio check (btrim(titulo) <> ''),
  constraint seg_foco_periodo_valido   check (fim >= inicio),
  constraint seg_foco_um_por_vez
    exclude using gist (area_id with =, daterange(inicio, fim, '[]') with &&)
);
create index seg_focos_tenant_idx on public.seg_focos (tenant_id, inicio desc);
create index seg_focos_area_idx   on public.seg_focos (area_id, inicio desc);

create trigger trg_seg_focos_updated before update on public.seg_focos
  for each row execute function public.set_updated_at();

alter table public.seg_focos enable row level security;

create policy seg_focos_select on public.seg_focos
  for select using (tenant_id in (select public.my_tenant_ids()));

create policy seg_focos_write on public.seg_focos
  for all
  using      (public.pode_tratar_seguranca(tenant_id))
  with check (public.pode_tratar_seguranca(tenant_id));

revoke all on table public.seg_focos from public, anon;

drop trigger if exists audit_seg_focos on public.seg_focos;
create trigger audit_seg_focos after insert or update or delete on public.seg_focos
  for each row execute function public.audit_trigger();

/**
 * Grava o foco. A sobreposição é recusada pelo banco; aqui ela só ganha um
 * texto que diz o que fazer, em vez do erro cru do Postgres.
 */
create or replace function public.seg_salvar_foco(p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := public.my_active_tenant();
  v_id     uuid := nullif(p_data->>'id', '')::uuid;
  v_area   uuid := nullif(p_data->>'area_id', '')::uuid;
  v_causa  uuid := nullif(p_data->>'causa_id', '')::uuid;
  v_titulo text := btrim(coalesce(p_data->>'titulo', ''));
  v_orient text := nullif(btrim(coalesce(p_data->>'orientacao', '')), '');
  v_inicio date := nullif(p_data->>'inicio', '')::date;
  v_fim    date := nullif(p_data->>'fim', '')::date;
begin
  if v_tenant is null then
    raise exception 'Você não tem acesso a esta empresa.';
  end if;
  perform public.seg_exige_tratativa(v_tenant);

  if v_titulo = '' then
    raise exception 'Dê um título ao foco.';
  end if;
  if v_inicio is null or v_fim is null then
    raise exception 'Informe o período de vigência do foco.';
  end if;
  if v_fim < v_inicio then
    raise exception 'O fim da vigência não pode ser antes do início.';
  end if;
  if not exists (
    select 1 from public.seg_areas a where a.id = v_area and a.tenant_id = v_tenant
  ) then
    raise exception 'Escolha uma área válida.';
  end if;
  if v_causa is not null and not exists (
    select 1 from public.seg_causas c where c.id = v_causa and c.tenant_id = v_tenant
  ) then
    v_causa := null;
  end if;

  if v_id is null then
    insert into public.seg_focos (tenant_id, area_id, causa_id, titulo, orientacao, inicio, fim)
    values (v_tenant, v_area, v_causa, v_titulo, v_orient, v_inicio, v_fim)
    returning id into v_id;
  else
    update public.seg_focos
       set area_id = v_area, causa_id = v_causa, titulo = v_titulo,
           orientacao = v_orient, inicio = v_inicio, fim = v_fim
     where id = v_id and tenant_id = v_tenant;
    if not found then
      raise exception 'Foco não encontrado.';
    end if;
  end if;

  return v_id;
exception when exclusion_violation then
  raise exception 'Esta área já tem um foco definido nesse período. Ajuste as datas ou edite o foco que já existe.';
end;
$$;

revoke execute on function public.seg_salvar_foco(jsonb) from public, anon;
grant  execute on function public.seg_salvar_foco(jsonb) to authenticated;

create or replace function public.seg_excluir_foco(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_tenant uuid;
begin
  select f.tenant_id into v_tenant from public.seg_focos f where f.id = p_id;
  if v_tenant is null then
    raise exception 'Foco não encontrado.';
  end if;
  perform public.seg_exige_tratativa(v_tenant);
  delete from public.seg_focos where id = p_id;
end;
$$;

revoke execute on function public.seg_excluir_foco(uuid) from public, anon;
grant  execute on function public.seg_excluir_foco(uuid) to authenticated;

/**
 * O foco visto de fora: o que está valendo hoje, com o número que diz se está
 * funcionando, e o que a base sugere para as áreas que ainda não têm foco.
 *
 * `na_causa_antes` compara a MESMA quantidade de dias imediatamente anterior ao
 * início do foco. É a única leitura honesta: um foco de 90 dias comparado com o
 * mês passado inflaria qualquer resultado.
 *
 * As sugestões só saem para quem pode definir foco. O resto da empresa lê o
 * foco, não a análise que levou a ele.
 */
create or replace function public.seg_focos_status(
  p_ref date default current_date,
  p_dias int default 90
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := public.my_active_tenant();
  v_pode   boolean;
  v_ref    date := coalesce(p_ref, current_date);
  v_dias   int  := greatest(coalesce(p_dias, 90), 7);
  v_vig    jsonb;
  v_sug    jsonb := '[]'::jsonb;
begin
  if v_tenant is null or not public.is_tenant_member(v_tenant) then
    raise exception 'Você não tem acesso a esta empresa.';
  end if;
  v_pode := public.pode_tratar_seguranca(v_tenant);

  select coalesce(jsonb_agg(x order by x->>'area_nome'), '[]'::jsonb) into v_vig
  from (
    select jsonb_build_object(
      'id', f.id,
      'area_id', f.area_id,
      'area_nome', a.name,
      'causa_id', f.causa_id,
      'causa_nome', c.name,
      'titulo', f.titulo,
      'orientacao', f.orientacao,
      'inicio', f.inicio,
      'fim', f.fim,
      'relatos', (
        select count(*) from public.seg_relatos r
         where r.tenant_id = f.tenant_id and r.area_id = f.area_id
           and r.occurred_on between f.inicio and v_ref
           and r.status <> 'duplicado'
      ),
      'na_causa', (
        select count(*) from public.seg_relatos r
         where r.tenant_id = f.tenant_id and r.area_id = f.area_id
           and r.occurred_on between f.inicio and v_ref
           and r.status <> 'duplicado'
           and f.causa_id is not null and r.causa_id = f.causa_id
      ),
      'na_causa_antes', (
        select count(*) from public.seg_relatos r
         where r.tenant_id = f.tenant_id and r.area_id = f.area_id
           and r.occurred_on >= f.inicio - (v_ref - f.inicio) - 1
           and r.occurred_on <  f.inicio
           and r.status <> 'duplicado'
           and f.causa_id is not null and r.causa_id = f.causa_id
      )
    ) as x
    from public.seg_focos f
    join public.seg_areas a on a.id = f.area_id
    left join public.seg_causas c on c.id = f.causa_id
    where f.tenant_id = v_tenant
      and v_ref between f.inicio and f.fim
  ) t;

  if v_pode then
    with base as (
      select r.area_id, r.causa_id
        from public.seg_relatos r
       where r.tenant_id = v_tenant
         and r.area_id is not null
         and r.causa_id is not null
         and r.status not in ('improcedente', 'duplicado')
         and r.occurred_on > v_ref - v_dias
         -- área que já tem foco valendo não precisa de sugestão
         and not exists (
           select 1 from public.seg_focos f
            where f.area_id = r.area_id and v_ref between f.inicio and f.fim
         )
    ),
    por_causa as (
      select area_id, causa_id, count(*) as qtd from base group by 1, 2
    ),
    total as (
      select area_id, count(*) as total from base group by 1
    ),
    dominante as (
      select distinct on (p.area_id) p.area_id, p.causa_id, p.qtd
        from por_causa p
       order by p.area_id, p.qtd desc, p.causa_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'area_id', d.area_id,
             'area_nome', a.name,
             'causa_id', d.causa_id,
             'causa_nome', c.name,
             'qtd', d.qtd,
             'total', t.total
           ) order by d.qtd desc, a.name), '[]'::jsonb)
      into v_sug
      from dominante d
      join total t on t.area_id = d.area_id
      join public.seg_areas a on a.id = d.area_id
      join public.seg_causas c on c.id = d.causa_id;
  end if;

  return jsonb_build_object(
    'pode_definir', v_pode,
    'dias', v_dias,
    'vigentes', v_vig,
    'sugestoes', v_sug
  );
end;
$$;

revoke execute on function public.seg_focos_status(date, int) from public, anon;
grant  execute on function public.seg_focos_status(date, int) to authenticated;

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
