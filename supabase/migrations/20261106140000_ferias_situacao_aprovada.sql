-- ---------------------------------------------------------------------------
-- Aquisitivo sem saldo: "aprovada" separada de "solicitada".
--
-- Com o gestor já tendo aprovado, o cartão do aquisitivo seguia "Solicitada"
-- enquanto as linhas diziam "Aprovada pelo gestor" (LUIZ, 06/11/2026). Ordem:
--   solicitada  algum pedido ainda com o gestor
--   aprovada    tudo aprovado pelo gestor, falta a efetivação do DP
--   em_gozo / agendada / concluida   como em 20261106120000
-- ---------------------------------------------------------------------------

create or replace function public.ferias_periodos_aquisitivos(
  p_tenant uuid, p_user uuid, p_hoje date default current_date, p_excluir uuid default null)
returns table(
  aq_inicio date, aq_fim date, concessivo_fim date,
  dias_direito integer, dias_usados integer, abono_usado integer, saldo integer,
  qtd_periodos integer, situacao text,
  origem text, referencia date, gozados_folha integer, limite_gozo date, tem14 boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_adm date;
  v_min14 int;
  v_pendente boolean;
  v_aprovada boolean;
  v_em_gozo boolean;
  v_por_vir boolean;
  r record;
begin
  if p_user <> (select auth.uid())
     and not public.manages_user(p_user, p_tenant)
     and not public.has_tenant_role(p_tenant, '{owner,admin,hr,manager}'::public.member_role[]) then
    raise exception 'Sem alçada para ver o saldo de férias deste colaborador.';
  end if;

  -- 1) a folha disse quais são os aquisitivos desta pessoa
  if exists (select 1 from public.ferias_aquisitivos a
              where a.tenant_id = p_tenant and a.user_id = p_user) then
    for r in
      select a.* from public.ferias_aquisitivos a
       where a.tenant_id = p_tenant and a.user_id = p_user
       order by a.aq_inicio
    loop
      aq_inicio := r.aq_inicio;
      aq_fim := r.aq_fim;
      concessivo_fim := r.concessivo_fim;
      dias_direito := r.dias_direito;
      origem := 'folha';
      referencia := r.referencia;
      gozados_folha := r.dias_gozados;
      limite_gozo := r.limite_gozo;
      -- quem tem direito menor que 14 (art. 130) só pode tirar tudo de uma vez
      v_min14 := least(14, r.dias_direito);

      -- só o que a folha ainda não viu: previsões que começam depois do relatório
      select coalesce(sum(f.dias + f.abono_dias), 0)::int,
             coalesce(sum(f.abono_dias), 0)::int,
             count(*)::int,
             coalesce(bool_or(f.dias >= v_min14), false),
             coalesce(bool_or(f.status = 'solicitada'), false),
             coalesce(bool_or(f.status = 'aprovada'), false),
             coalesce(bool_or(f.status = 'efetivada' and f.start_date <= p_hoje and f.end_date >= p_hoje), false),
             coalesce(bool_or(f.status = 'efetivada' and f.start_date > p_hoje), false)
        into dias_usados, abono_usado, qtd_periodos, tem14, v_pendente, v_aprovada, v_em_gozo, v_por_vir
        from public.ferias_solicitacoes f
       where f.tenant_id = p_tenant and f.user_id = p_user
         and f.aquisitivo_inicio = r.aq_inicio
         and f.status in ('solicitada', 'aprovada', 'efetivada')
         and f.start_date > r.referencia
         and (p_excluir is null or f.id <> p_excluir);

      dias_usados := dias_usados + r.dias_gozados;
      -- a folha informa o TOTAL gozado, não em quantos períodos: conta como um,
      -- e um gozo de 14 dias ou mais já cumpre o período mínimo do art. 134
      if r.dias_gozados > 0 then
        qtd_periodos := qtd_periodos + 1;
      end if;
      tem14 := tem14 or (r.dias_gozados > 0 and r.dias_gozados >= v_min14);

      saldo := greatest(dias_direito - dias_usados, 0);
      situacao := case
        when saldo <= 0 and dias_usados > 0 then case
          when v_pendente then 'solicitada'
          when v_aprovada then 'aprovada'
          when v_em_gozo then 'em_gozo'
          when v_por_vir then 'agendada'
          else 'concluida'
        end
        when aq_fim >= p_hoje then 'em_curso'
        -- direito zerado (faltas, afastamento) sem nada usado
        when saldo <= 0 then 'concluida'
        when p_hoje > concessivo_fim then 'vencida'
        when concessivo_fim - p_hoje <= 90 then 'a_vencer'
        else 'aberta'
      end;
      return next;
    end loop;
    return;
  end if;

  -- 2) a empresa importa da folha e esta pessoa não veio no relatório: sem
  -- os dados da folha não há saldo confiável, e calcular pela admissão seria
  -- justamente o erro que a importação veio corrigir
  if exists (select 1 from public.ferias_importacoes i where i.tenant_id = p_tenant) then
    return;
  end if;

  -- 3) empresa que nunca importou: o cálculo antigo, pela admissão
  select m.admission_date into v_adm
    from public.memberships m
   where m.tenant_id = p_tenant and m.user_id = p_user;
  if v_adm is null then
    return;
  end if;

  origem := 'admissao';
  referencia := null;
  gozados_folha := 0;
  limite_gozo := null;
  aq_inicio := v_adm;
  while aq_inicio <= p_hoje loop
    aq_fim := (aq_inicio + interval '1 year' - interval '1 day')::date;
    concessivo_fim := (aq_fim + interval '1 year')::date;
    dias_direito := 30;

    select coalesce(sum(f.dias + f.abono_dias), 0)::int,
           coalesce(sum(f.abono_dias), 0)::int,
           count(*)::int,
           coalesce(bool_or(f.dias >= 14), false),
           coalesce(bool_or(f.status = 'solicitada'), false),
           coalesce(bool_or(f.status = 'aprovada'), false),
           coalesce(bool_or(f.status = 'efetivada' and f.start_date <= p_hoje and f.end_date >= p_hoje), false),
           coalesce(bool_or(f.status = 'efetivada' and f.start_date > p_hoje), false)
      into dias_usados, abono_usado, qtd_periodos, tem14, v_pendente, v_aprovada, v_em_gozo, v_por_vir
      from public.ferias_solicitacoes f
     where f.tenant_id = p_tenant and f.user_id = p_user
       and f.aquisitivo_inicio = aq_inicio
       and f.status in ('solicitada', 'aprovada', 'efetivada')
       and (p_excluir is null or f.id <> p_excluir);

    saldo := greatest(dias_direito - dias_usados, 0);
    situacao := case
      when saldo <= 0 and dias_usados > 0 then case
        when v_pendente then 'solicitada'
        when v_aprovada then 'aprovada'
        when v_em_gozo then 'em_gozo'
        when v_por_vir then 'agendada'
        else 'concluida'
      end
      when aq_fim >= p_hoje then 'em_curso'
      -- direito zerado (faltas, afastamento) sem nada usado
      when saldo <= 0 then 'concluida'
      when p_hoje > concessivo_fim then 'vencida'
      when concessivo_fim - p_hoje <= 90 then 'a_vencer'
      else 'aberta'
    end;

    return next;
    aq_inicio := (aq_inicio + interval '1 year')::date;
  end loop;
end;
$function$;

revoke execute on function public.ferias_periodos_aquisitivos(uuid, uuid, date, uuid) from public, anon;

notify pgrst, 'reload schema';
