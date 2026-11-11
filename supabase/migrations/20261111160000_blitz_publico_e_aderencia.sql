-- Público e aderência da blitz de trajeto (LUIZ, 11/11/2026).
--
-- Todo colaborador ativo passa pela blitz, menos as funções que entram por
-- outro portão (veículo da empresa, outro check). Ficam de fora:
--   - funções marcadas em `seg_blitz_publico_funcoes`;
--   - exceção por pessoa em `seg_blitz_publico_pessoas` (participa = true
--     inclui mesmo numa função de fora; false exclui);
--   - quem esteve ausente (férias, afastamento, licença...) o MÊS INTEIRO.
-- Ciclo mensal: aderência = do público, quem passou pelo menos uma vez no mês.
-- Estrutura (setor, gestor, função, unidade) é a de hoje.

-- ---------- 1. o público ----------
create table public.seg_blitz_publico_funcoes (
  id uuid not null default gen_random_uuid() unique,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  position_id uuid not null references public.positions(id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, position_id)
);

create table public.seg_blitz_publico_pessoas (
  id uuid not null default gen_random_uuid() unique,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null,
  participa boolean not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

alter table public.seg_blitz_publico_funcoes enable row level security;
alter table public.seg_blitz_publico_pessoas enable row level security;
revoke all on table public.seg_blitz_publico_funcoes from public, anon, authenticated;
revoke all on table public.seg_blitz_publico_pessoas from public, anon, authenticated;
grant select, insert, update, delete on table public.seg_blitz_publico_funcoes to authenticated;
grant select, insert, update, delete on table public.seg_blitz_publico_pessoas to authenticated;

-- lê quem é da empresa; escreve quem cuida do cadastro da blitz (o mesmo dos meios)
create policy seg_blitz_publico_funcoes_select on public.seg_blitz_publico_funcoes
  for select to authenticated using (tenant_id in (select public.my_tenant_ids()));
create policy seg_blitz_publico_funcoes_write on public.seg_blitz_publico_funcoes
  for all to authenticated
  using (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::public.member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::public.member_role[])));
create policy seg_blitz_publico_pessoas_select on public.seg_blitz_publico_pessoas
  for select to authenticated using (tenant_id in (select public.my_tenant_ids()));
create policy seg_blitz_publico_pessoas_write on public.seg_blitz_publico_pessoas
  for all to authenticated
  using (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::public.member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::public.member_role[])));

create trigger audit_seg_blitz_publico_funcoes after insert or delete or update on public.seg_blitz_publico_funcoes
  for each row execute function public.audit_trigger();
create trigger audit_seg_blitz_publico_pessoas after insert or delete or update on public.seg_blitz_publico_pessoas
  for each row execute function public.audit_trigger();

-- ---------- 2. a aderência do mês ----------
create or replace function public.seg_blitz_aderencia(p_mes date, p_unit_ids uuid[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := public.my_active_tenant();
  v_de  date := date_trunc('month', p_mes)::date;
  v_ate date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_amplo boolean;
  v_lider boolean;
  v_out jsonb;
begin
  if v_tenant is null or not public.is_tenant_member(v_tenant) then
    raise exception 'Você não tem acesso a esta empresa.';
  end if;
  -- mesma alçada das Análises: empresa inteira, ou a cadeia do Gestor
  v_amplo := public.has_tenant_role(v_tenant, '{owner,admin,manager}'::public.member_role[])
          or public.pode_tratar_seguranca(v_tenant);
  v_lider := public.has_tenant_role(v_tenant, '{team_lead}'::public.member_role[]);
  if not (v_amplo or v_lider) then
    raise exception 'A aderência da blitz é de quem tem alçada sobre a equipe.' using errcode = '42501';
  end if;

  with base as (
    select m.user_id, m.employee_code, m.position_id,
           p.full_name as nome, pos.name as funcao, d.name as setor, mg.full_name as gestor,
           (select u.name from public.membership_units mu join public.units u on u.id = mu.unit_id
             where mu.membership_id = m.id order by u.name limit 1) as unidade,
           (select array_agg(mu.unit_id) from public.membership_units mu where mu.membership_id = m.id) as unidades
      from public.memberships m
      join public.profiles p on p.id = m.user_id
      left join public.positions pos on pos.id = m.position_id
      left join public.departments d on d.id = m.department_id
      left join public.profiles mg on mg.id = m.manager_id
     where m.tenant_id = v_tenant
       -- quem estava na empresa no mês: admitido até o fim dele e não desligado dentro dele
       and (m.admission_date is null or m.admission_date <= v_ate)
       and (m.is_active or (m.dismissed_at is not null and m.dismissed_at > v_ate))
       and (v_amplo or exists (
             select 1 from public.my_managed_memberships() e
              where e.user_id = m.user_id and e.tenant_id = v_tenant))
  ),
  classif as (
    select b.*,
           x.participa as excecao,
           exists (select 1 from public.seg_blitz_publico_funcoes f
                    where f.tenant_id = v_tenant and f.position_id = b.position_id) as funcao_fora,
           coalesce((
             select range_agg(daterange(a.start_date, a.end_date, '[]'))
               from public.employee_absences a
              where a.tenant_id = v_tenant and a.user_id = b.user_id
                and a.start_date <= v_ate and a.end_date >= v_de
           ) @> daterange(v_de, v_ate, '[]'), false) as ausente_mes,
           (select max(a.occurred_on) from public.seg_blitz_avaliacoes a
             where a.tenant_id = v_tenant and a.user_id = b.user_id
               and a.occurred_on between v_de and v_ate) as ultima_no_mes,
           (select max(a.occurred_on) from public.seg_blitz_avaliacoes a
             where a.tenant_id = v_tenant and a.user_id = b.user_id) as ultima_geral
      from base b
      left join public.seg_blitz_publico_pessoas x on x.tenant_id = v_tenant and x.user_id = b.user_id
     where p_unit_ids is null or b.unidades && p_unit_ids
  ),
  publico as (
    select * from classif
     where coalesce(excecao, not funcao_fora) and not ausente_mes
  )
  select jsonb_build_object(
    'mes', to_char(v_de, 'YYYY-MM'),
    'de', v_de,
    'ate', v_ate,
    'publico', (select count(*) from publico),
    'passaram', (select count(*) from publico where ultima_no_mes is not null),
    'fora', jsonb_build_object(
      'por_funcao', (select count(*) from classif where excecao is null and funcao_fora),
      'por_excecao', (select count(*) from classif where excecao = false),
      'ausentes', (select count(*) from classif where coalesce(excecao, not funcao_fora) and ausente_mes)
    ),
    'por_setor', (select coalesce(jsonb_agg(jsonb_build_object('nome', k, 'publico', n, 'passaram', ok) order by k), '[]'::jsonb)
                    from (select coalesce(setor, 'Sem setor') k, count(*) n, count(*) filter (where ultima_no_mes is not null) ok
                            from publico group by 1) x),
    'por_gestor', (select coalesce(jsonb_agg(jsonb_build_object('nome', k, 'publico', n, 'passaram', ok) order by k), '[]'::jsonb)
                     from (select coalesce(gestor, 'Sem gestor') k, count(*) n, count(*) filter (where ultima_no_mes is not null) ok
                             from publico group by 1) x),
    'por_unidade', (select coalesce(jsonb_agg(jsonb_build_object('nome', k, 'publico', n, 'passaram', ok) order by k), '[]'::jsonb)
                      from (select coalesce(unidade, 'Sem unidade') k, count(*) n, count(*) filter (where ultima_no_mes is not null) ok
                              from publico group by 1) x),
    'por_funcao', (select coalesce(jsonb_agg(jsonb_build_object('nome', k, 'publico', n, 'passaram', ok) order by k), '[]'::jsonb)
                     from (select coalesce(funcao, 'Sem função') k, count(*) n, count(*) filter (where ultima_no_mes is not null) ok
                             from publico group by 1) x),
    'faltam', (select coalesce(jsonb_agg(jsonb_build_object(
                  'user_id', user_id, 'nome', nome, 'matricula', employee_code, 'funcao', funcao,
                  'setor', setor, 'gestor', gestor, 'unidade', unidade, 'ultima', ultima_geral) order by nome), '[]'::jsonb)
                 from publico where ultima_no_mes is null)
  ) into v_out;

  return v_out;
end;
$$;
revoke execute on function public.seg_blitz_aderencia(date, uuid[]) from public, anon;

notify pgrst, 'reload schema';
