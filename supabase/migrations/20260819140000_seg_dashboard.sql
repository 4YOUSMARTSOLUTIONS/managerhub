-- O painel de segurança, numa chamada só.
--
-- A tela precisa de dez recortes do mesmo período (camadas da pirâmide, série
-- mensal, quebras por local, área, setor e gestor, taxa de tratamento). Feito
-- no app, isso seria uma dezena de consultas em sequência, cada uma com sua ida
-- e volta até São Paulo, e ainda traria linha a linha para o navegador contar.
-- Aqui a conta é feita onde os dados estão e volta um jsonb.
--
-- A PIRÂMIDE DE HEINRICH, com os dados que existem:
--
--        SIF          topo: morte, incapacidade permanente
--        LTI          com afastamento
--     FAI+MTI+MDI     com atendimento, sem afastar
--     incidentes      quase acidente: houve o evento, não houve lesão
--       desvios       base: ato e condição insegura relatados
--
-- Relato improcedente e duplicado NÃO contam: cinco pessoas relatando o mesmo
-- buraco são um desvio, não cinco, e um relato analisado e descartado não é
-- desvio nenhum. Comportamento seguro fica fora da pirâmide (ela conta falha) e
-- volta num campo próprio.
--
-- O bloco `restrito` (quebra por setor e gestor, e a taxa de tratamento) só vai
-- junto para quem trata segurança. Para o resto da empresa o painel mostra o
-- todo, sem apontar dedo para setor nem para chefia.

create or replace function public.seg_dashboard(p_ano integer, p_unit_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_tenant  uuid := public.my_active_tenant();
  v_de      date;
  v_ate     date;
  v_out     jsonb;
  v_restrito jsonb;
begin
  if v_tenant is null or not public.is_tenant_member(v_tenant) then
    raise exception 'Você não tem acesso a esta empresa.';
  end if;

  v_de  := make_date(p_ano, 1, 1);
  v_ate := make_date(p_ano, 12, 31);

  with relatos as (
    select r.*
      from public.seg_relatos r
     where r.tenant_id = v_tenant
       and r.occurred_on between v_de and v_ate
       and (p_unit_id is null or r.unit_id = p_unit_id)
  ),
  validos as (
    -- o que a estatística conta: fora improcedente e duplicado
    select * from relatos where status not in ('improcedente', 'duplicado')
  ),
  acidentes as (
    select a.*
      from public.seg_acidentes a
     where a.tenant_id = v_tenant
       and a.occurred_on between v_de and v_ate
       and (p_unit_id is null or a.snap_unit_id = p_unit_id)
  )
  select jsonb_build_object(
    'ano', p_ano,
    'piramide', jsonb_build_object(
      'desvios',    (select count(*) from validos where snap_natureza = 'desvio'),
      'incidentes', (select count(*) from validos where snap_natureza = 'incidente'),
      'atendimento',(select count(*) from acidentes where classe in ('fai','mti','mdi')),
      'lti',        (select count(*) from acidentes where classe = 'lti'),
      'sif',        (select count(*) from acidentes where classe = 'sif')
    ),
    'relatos', jsonb_build_object(
      'total',        (select count(*) from relatos),
      'validos',      (select count(*) from validos),
      'positivos',    (select count(*) from validos where snap_natureza = 'positivo'),
      'aguardando',   (select count(*) from relatos where status = 'aberto'),
      'improcedentes',(select count(*) from relatos where status = 'improcedente'),
      'duplicados',   (select count(*) from relatos where status = 'duplicado')
    ),
    'acidentes', jsonb_build_object(
      'total',         (select count(*) from acidentes),
      'abertos',       (select count(*) from acidentes where status = 'aberto'),
      'dias_perdidos', (select coalesce(sum(dias_afastamento), 0) from acidentes),
      'por_classe',    (
        select coalesce(jsonb_object_agg(classe, n), '{}'::jsonb)
          from (select classe, count(*) as n from acidentes group by classe) x
      )
    ),
    -- doze posições sempre, inclusive os meses sem nada: um gráfico com buraco
    -- no meio faz o leitor achar que o dado sumiu
    'mensal', (
      select jsonb_agg(jsonb_build_object(
        'mes', m,
        'desvios',    (select count(*) from validos v where extract(month from v.occurred_on) = m and v.snap_natureza = 'desvio'),
        'incidentes', (select count(*) from validos v where extract(month from v.occurred_on) = m and v.snap_natureza = 'incidente'),
        'positivos',  (select count(*) from validos v where extract(month from v.occurred_on) = m and v.snap_natureza = 'positivo'),
        'acidentes',  (select count(*) from acidentes a where extract(month from a.occurred_on) = m)
      ) order by m)
      from generate_series(1, 12) as m
    ),
    'por_local', (
      select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'relatos', rel, 'acidentes', aci) order by (rel + aci) desc), '[]'::jsonb)
      from (
        select coalesce(l.name, 'Não informado') as nome,
               count(*) filter (where origem = 'relato')   as rel,
               count(*) filter (where origem = 'acidente') as aci
          from (
            select local_id, 'relato'::text as origem from validos
            union all
            select local_id, 'acidente'::text from acidentes
          ) t
          left join public.seg_locais l on l.id = t.local_id
         group by 1
      ) x
    ),
    'por_area', (
      select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'relatos', rel, 'acidentes', aci) order by (rel + aci) desc), '[]'::jsonb)
      from (
        select coalesce(a2.name, 'Não informada') as nome,
               count(*) filter (where origem = 'relato')   as rel,
               count(*) filter (where origem = 'acidente') as aci
          from (
            select area_id, 'relato'::text as origem from validos
            union all
            select area_id, 'acidente'::text from acidentes
          ) t
          left join public.seg_areas a2 on a2.id = t.area_id
         group by 1
      ) x
    ),
    'por_tipo', (
      select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'total', n) order by n desc), '[]'::jsonb)
      from (
        select coalesce(t.name, 'Sem tipo') as nome, count(*) as n
          from validos v
          left join public.seg_tipos_relato t on t.id = v.tipo_id
         group by 1
      ) x
    )
  ) into v_out;

  if public.pode_tratar_seguranca(v_tenant) then
    with relatos as (
      select r.* from public.seg_relatos r
       where r.tenant_id = v_tenant
         and r.occurred_on between v_de and v_ate
         and (p_unit_id is null or r.unit_id = p_unit_id)
    ),
    validos as (
      select * from relatos where status not in ('improcedente', 'duplicado')
    ),
    acidentes as (
      select a.* from public.seg_acidentes a
       where a.tenant_id = v_tenant
         and a.occurred_on between v_de and v_ate
         and (p_unit_id is null or a.snap_unit_id = p_unit_id)
    )
    select jsonb_build_object(
      -- tratados sobre o que era para ser tratado: improcedente e duplicado
      -- saem do denominador, senão a equipe seria cobrada por relato que ela
      -- corretamente descartou
      'taxa_tratamento', (
        select case when count(*) = 0 then null
                    else round(100.0 * count(*) filter (where status = 'tratado') / count(*), 1)
               end
          from validos
      ),
      'por_setor', (
        select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'relatos', rel, 'acidentes', aci) order by (rel + aci) desc), '[]'::jsonb)
        from (
          select coalesce(nome, 'Sem setor') as nome,
                 count(*) filter (where origem = 'relato')   as rel,
                 count(*) filter (where origem = 'acidente') as aci
            from (
              select e.snap_department_name as nome, 'relato'::text as origem
                from public.seg_relato_envolvidos e
                join validos v on v.id = e.relato_id
              union all
              select a.snap_department_name, 'acidente'::text from acidentes a
            ) t
           group by 1
        ) x
      ),
      'por_gestor', (
        select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'relatos', rel, 'acidentes', aci) order by (rel + aci) desc), '[]'::jsonb)
        from (
          select coalesce(nome, 'Sem gestor') as nome,
                 count(*) filter (where origem = 'relato')   as rel,
                 count(*) filter (where origem = 'acidente') as aci
            from (
              select e.snap_manager_name as nome, 'relato'::text as origem
                from public.seg_relato_envolvidos e
                join validos v on v.id = e.relato_id
              union all
              select a.snap_manager_name, 'acidente'::text from acidentes a
            ) t
           group by 1
        ) x
      )
    ) into v_restrito;

    v_out := v_out || jsonb_build_object('restrito', v_restrito);
  end if;

  return v_out;
end;
$$;

revoke execute on function public.seg_dashboard(integer, uuid) from public, anon;
grant  execute on function public.seg_dashboard(integer, uuid) to authenticated;

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
