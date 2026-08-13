-- As portas do processo de absenteísmo.
--
-- Estão em função e não em update solto porque cada transição tem efeito
-- colateral que precisa acontecer na MESMA transação: aprovar cria a ausência
-- real, cancelar apaga, e as duas avisam quem lançou.
--
-- Os avisos usam `notify_users_sistema` e não `notify_users`: esta guarda pelo
-- CHAMADOR ser membro da empresa, e o super admin opera numa empresa da qual
-- não é membro. Com ela, o aviso sumiria em silêncio (ver 20260813130000).

create or replace function public.absenteismo_confirmar(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_l record;
  v_at record;
  v_adm uuid[];
begin
  select l.* into v_l from public.absenteismo_lancamentos l where l.id = p_id;
  if v_l.id is null or not public.pode_ver_absenteismo(v_l.tenant_id, v_l.user_id, v_l.created_by) then
    raise exception 'Lançamento não encontrado.';
  end if;
  if v_l.status not in ('aberto', 'reprovado') then
    raise exception 'Este lançamento já foi enviado ao RH.';
  end if;

  -- as mesmas condições dos checks da tabela, ditas em português antes de o
  -- banco reclamar em inglês
  if v_l.absence_type_id is null then raise exception 'Escolha o tipo de absenteísmo.'; end if;
  if v_l.start_date is null or v_l.end_date is null then
    raise exception 'Informe o período de início e término.';
  end if;
  if v_l.end_date < v_l.start_date then
    raise exception 'O término não pode ser antes do início.';
  end if;
  if v_l.occurred_on not between v_l.start_date and v_l.end_date then
    raise exception 'O período informado precisa incluir o dia do não comparecimento (%).',
      to_char(v_l.occurred_on, 'DD/MM/YYYY');
  end if;
  if v_l.snap_requires_document and v_l.doc_path is null then
    raise exception 'Anexe o documento antes de enviar ao RH.';
  end if;

  if v_l.snap_requires_medical then
    select a.* into v_at from public.absenteismo_atestados a where a.lancamento_id = p_id;
    if v_at.lancamento_id is null
       or coalesce(btrim(v_at.cid_code), '') = ''
       or coalesce(btrim(v_at.doctor_name), '') = ''
       or v_at.issued_on is null then
      raise exception 'Preencha o CID, o nome do profissional e a data de emissão do atestado.';
    end if;
  end if;

  update public.absenteismo_lancamentos
     set status = 'pendente',
         submitted_at = now(),
         decision_note = null,
         decided_at = null,
         decided_by = null,
         updated_at = now()
   where id = p_id;

  select array_agg(m.user_id) into v_adm
    from public.memberships m
   where m.tenant_id = v_l.tenant_id
     and m.role in ('owner', 'admin', 'hr')
     and m.is_active;

  -- O aviso do sino NUNCA leva dado clínico: ele aparece na barra de qualquer
  -- tela e pode ser lido por cima do ombro.
  if v_adm is not null then
    perform public.notify_users_sistema(
      v_l.tenant_id, v_adm, 'absenteismo_pendente',
      'Absenteísmo aguardando aprovação',
      coalesce(v_l.snap_full_name, 'Colaborador') || ': ' ||
      coalesce(v_l.snap_type_name, 'ausência') || ' de ' ||
      to_char(v_l.start_date, 'DD/MM') || ' a ' || to_char(v_l.end_date, 'DD/MM') || '.');
  end if;
end;
$$;

revoke execute on function public.absenteismo_confirmar(uuid) from public, anon;
grant execute on function public.absenteismo_confirmar(uuid) to authenticated;

/**
 * A decisão do RH.
 *
 * Aprovar é o único caminho que cria linha em `employee_absences`, e é por isso
 * que a ausência só passa a contar para a remuneração variável depois daqui.
 *
 * A constraint `employee_absences_sem_sobreposicao` recusa períodos que se
 * cruzem para a mesma pessoa, e atestado durante férias é situação real. A
 * pré-checagem existe para o caso comum sair com mensagem em português; o bloco
 * de exceção cobre a corrida entre dois RHs aprovando ao mesmo tempo.
 */
create or replace function public.absenteismo_decidir(
  p_id uuid, p_aprovar boolean, p_nota text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_l record;
  v_c record;
  v_aus uuid;
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
begin
  select l.* into v_l from public.absenteismo_lancamentos l where l.id = p_id;
  if v_l.id is null then
    raise exception 'Lançamento não encontrado.';
  end if;
  if not public.has_tenant_role(v_l.tenant_id, '{owner,admin,hr}'::public.member_role[]) then
    raise exception 'Apenas o RH, o administrador ou o proprietário decidem um absenteísmo.';
  end if;
  if v_l.status <> 'pendente' then
    raise exception 'Este lançamento não está aguardando decisão.';
  end if;
  if not p_aprovar and v_nota is null then
    raise exception 'Informe o motivo da reprovação.';
  end if;

  if p_aprovar then
    select e.start_date, e.end_date, e.kind into v_c
      from public.employee_absences e
     where e.tenant_id = v_l.tenant_id
       and e.user_id = v_l.user_id
       and daterange(e.start_date, e.end_date, '[]')
        && daterange(v_l.start_date, v_l.end_date, '[]')
     limit 1;
    if found then
      raise exception 'O período de % a % cruza com uma ausência já lançada de % a %. Ajuste as datas ou corrija o período em Configurações, na aba Colaboradores.',
        to_char(v_l.start_date, 'DD/MM/YYYY'), to_char(v_l.end_date, 'DD/MM/YYYY'),
        to_char(v_c.start_date, 'DD/MM/YYYY'), to_char(v_c.end_date, 'DD/MM/YYYY');
    end if;

    begin
      -- O FATO nasce aqui. `note` leva o NOME DO TIPO e nada mais: esta coluna é
      -- lida por service client em /metas e congelada em `rv_period_snapshots`,
      -- e é o último lugar do sistema onde um CID poderia acabar.
      insert into public.employee_absences (
        tenant_id, user_id, kind, start_date, end_date, discounts_rv, note, created_by)
      values (
        v_l.tenant_id, v_l.user_id, v_l.snap_kind, v_l.start_date, v_l.end_date,
        coalesce(v_l.discounts_rv, v_l.snap_discounts_rv_default),
        nullif(btrim(coalesce(v_l.snap_type_name, '')), ''),
        (select auth.uid()))
      returning id into v_aus;
    exception when exclusion_violation then
      select e.start_date, e.end_date into v_c
        from public.employee_absences e
       where e.tenant_id = v_l.tenant_id
         and e.user_id = v_l.user_id
         and daterange(e.start_date, e.end_date, '[]')
          && daterange(v_l.start_date, v_l.end_date, '[]')
       limit 1;
      raise exception 'O período de % a % cruza com uma ausência já lançada de % a %.',
        to_char(v_l.start_date, 'DD/MM/YYYY'), to_char(v_l.end_date, 'DD/MM/YYYY'),
        to_char(v_c.start_date, 'DD/MM/YYYY'), to_char(v_c.end_date, 'DD/MM/YYYY');
    end;

    update public.absenteismo_lancamentos
       set status = 'aprovado', absence_id = v_aus,
           decided_at = now(), decided_by = (select auth.uid()),
           decision_note = v_nota, updated_at = now()
     where id = p_id;

    perform public.notify_users_sistema(
      v_l.tenant_id, array[v_l.created_by], 'absenteismo_aprovado',
      'Absenteísmo aprovado',
      coalesce(v_l.snap_full_name, 'Colaborador') || ': ' ||
      coalesce(v_l.snap_type_name, 'ausência') || ' aprovada pelo RH.');
  else
    update public.absenteismo_lancamentos
       set status = 'reprovado',
           decided_at = now(), decided_by = (select auth.uid()),
           decision_note = v_nota, updated_at = now()
     where id = p_id;

    perform public.notify_users_sistema(
      v_l.tenant_id, array[v_l.created_by], 'absenteismo_reprovado',
      'Absenteísmo reprovado',
      coalesce(v_l.snap_full_name, 'Colaborador') || ': ' || v_nota);
  end if;
end;
$$;

revoke execute on function public.absenteismo_decidir(uuid, boolean, text) from public, anon;
grant execute on function public.absenteismo_decidir(uuid, boolean, text) to authenticated;

/**
 * Cancelar.
 *
 * De `aprovado` é operação de administrador, porque desfaz a ausência real e
 * devolve dias à remuneração variável. De `aberto` ou `reprovado` é do próprio
 * gestor: o comunicado da manhã já saiu, e alguém precisa poder dizer "ela
 * apareceu, foi engano" sem apagar o registro.
 *
 * A ordem importa: primeiro solta o vínculo, depois apaga a ausência. Ao
 * contrário, o `on delete restrict` da FK recusaria.
 */
create or replace function public.absenteismo_cancelar(p_id uuid, p_nota text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_l record;
  v_aus uuid;
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
begin
  select l.* into v_l from public.absenteismo_lancamentos l where l.id = p_id;
  if v_l.id is null then
    raise exception 'Lançamento não encontrado.';
  end if;
  if v_l.status = 'aprovado' then
    if not public.has_tenant_role(v_l.tenant_id, '{owner,admin}'::public.member_role[]) then
      raise exception 'Apenas o administrador ou o proprietário cancelam um absenteísmo aprovado.';
    end if;
  elsif v_l.status in ('aberto', 'reprovado') then
    if not public.pode_ver_absenteismo(v_l.tenant_id, v_l.user_id, v_l.created_by) then
      raise exception 'Lançamento não encontrado.';
    end if;
  else
    raise exception 'Um lançamento em análise pelo RH não pode ser cancelado. Peça a reprovação.';
  end if;
  if v_nota is null then
    raise exception 'Informe o motivo do cancelamento.';
  end if;

  v_aus := v_l.absence_id;

  update public.absenteismo_lancamentos
     set status = 'cancelado', absence_id = null,
         cancelled_at = now(), cancelled_by = (select auth.uid()),
         cancel_note = v_nota, updated_at = now()
   where id = p_id;

  if v_aus is not null then
    delete from public.employee_absences where id = v_aus;
  end if;

  if v_l.created_by is distinct from (select auth.uid()) then
    perform public.notify_users_sistema(
      v_l.tenant_id, array[v_l.created_by], 'absenteismo_cancelado',
      'Absenteísmo cancelado',
      coalesce(v_l.snap_full_name, 'Colaborador') || ': ' || v_nota);
  end if;
end;
$$;

revoke execute on function public.absenteismo_cancelar(uuid, text) from public, anon;
grant execute on function public.absenteismo_cancelar(uuid, text) to authenticated;

/**
 * O dado do atestado, uma linha por vez.
 *
 * Esta é a ÚNICA porta de leitura do dado clínico. A tabela filha existe para
 * que o CID não viaje na listagem, e essa separação só vale se ninguém abrir
 * uma segunda porta: um `select` na filha pelo PostgREST devolveria o
 * diagnóstico de todo mundo que o leitor pode ver, de uma vez.
 */
create or replace function public.absenteismo_atestado(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_l record;
  v_a record;
begin
  select l.* into v_l from public.absenteismo_lancamentos l where l.id = p_id;
  if v_l.id is null or not public.pode_ver_absenteismo(v_l.tenant_id, v_l.user_id, v_l.created_by) then
    return null;
  end if;

  select a.* into v_a from public.absenteismo_atestados a where a.lancamento_id = p_id;

  return jsonb_build_object(
    'id', v_l.id,
    'colaborador', v_l.snap_full_name,
    'tipo', v_l.snap_type_name,
    'inicio', v_l.start_date,
    'fim', v_l.end_date,
    'cid', v_a.cid_code,
    'cidDescricao', v_a.cid_description,
    'medico', v_a.doctor_name,
    'crm', v_a.doctor_crm,
    'local', v_a.facility,
    'emitidoEm', v_a.issued_on,
    'diasAfastamento', v_a.days_off
  );
end;
$$;

revoke execute on function public.absenteismo_atestado(uuid) from public, anon;
grant execute on function public.absenteismo_atestado(uuid) to authenticated;

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
