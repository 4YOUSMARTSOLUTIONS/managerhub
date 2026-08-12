-- As quatro portas do processo de punição.
--
-- Estão em função e não em update solto porque cada transição tem efeito
-- colateral que precisa acontecer na MESMA transação: aprovar cria a punição
-- real, cancelar apaga, e as duas avisam quem lançou. Um update pela tela
-- deixaria metade disso para a boa vontade do cliente.
--
-- As notificações usam `notify_users_sistema` e não `notify_users`: esta última
-- guarda pelo CHAMADOR ser membro da empresa, e o super admin opera numa empresa
-- da qual não é membro. Com ela, o aviso sumiria em silêncio, que é exatamente o
-- bug que a migração 20260813130000 documenta.

create or replace function public.punicao_submeter(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_l record;
  v_adm uuid[];
begin
  select l.* into v_l from public.punicao_lancamentos l where l.id = p_id;
  if v_l.id is null or not public.pode_ver_punicao(v_l.tenant_id, v_l.user_id, v_l.created_by) then
    raise exception 'Lançamento não encontrado.';
  end if;
  if v_l.status not in ('rascunho', 'reprovada') then
    raise exception 'Este lançamento já foi enviado ao RH.';
  end if;

  -- as mesmas condições do check da tabela, ditas em português antes de o banco
  -- reclamar em inglês
  if v_l.applied_on is null then raise exception 'Informe a data da aplicação.'; end if;
  if v_l.infraction_type_id is null then raise exception 'Escolha a infração.'; end if;
  if v_l.sanction_type_id is null then raise exception 'Escolha a punição aplicada.'; end if;
  if v_l.signed_path is null then
    raise exception 'Anexe o documento assinado antes de enviar ao RH.';
  end if;

  update public.punicao_lancamentos
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

  if v_adm is not null then
    perform public.notify_users_sistema(
      v_l.tenant_id, v_adm, 'punicao_pendente',
      'Punição aguardando aprovação',
      coalesce(v_l.snap_full_name, 'Colaborador') || ': ' ||
      coalesce(v_l.sanction_name, 'punição') || ' por ' ||
      coalesce(v_l.infraction_name, 'infração') || '.');
  end if;
end;
$$;

revoke execute on function public.punicao_submeter(uuid) from public, anon;
grant execute on function public.punicao_submeter(uuid) to authenticated;

/**
 * A decisão do RH.
 *
 * Aprovar é o único caminho que cria linha em `employee_sanctions`, e é por isso
 * que a punição só passa a valer para a remuneração variável depois daqui.
 * Reprovar não toca naquela tabela: o lançamento fica registrado como reprovado,
 * com o motivo, e não vale nada.
 */
create or replace function public.punicao_decidir(
  p_id uuid, p_aprovar boolean, p_nota text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_l record;
  v_sancao uuid;
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
begin
  select l.* into v_l from public.punicao_lancamentos l where l.id = p_id;
  if v_l.id is null then
    raise exception 'Lançamento não encontrado.';
  end if;
  if not public.has_tenant_role(v_l.tenant_id, '{owner,admin,hr}'::public.member_role[]) then
    raise exception 'Apenas o RH, o administrador ou o proprietário decidem uma punição.';
  end if;
  if v_l.status <> 'pendente' then
    raise exception 'Este lançamento não está aguardando decisão.';
  end if;
  if not p_aprovar and v_nota is null then
    raise exception 'Informe o motivo da reprovação.';
  end if;

  if p_aprovar then
    -- o FATO nasce aqui. `created_by` é quem aprovou: foi a decisão do RH que
    -- deu existência à punição, e é ela que a auditoria precisa encontrar.
    insert into public.employee_sanctions (
      tenant_id, user_id, sanction_type_id, occurred_on, note, created_by)
    values (
      v_l.tenant_id, v_l.user_id, v_l.sanction_type_id, v_l.applied_on,
      nullif(btrim(coalesce(v_l.infraction_code || ' ', '') || coalesce(v_l.infraction_name, '')), ''),
      (select auth.uid()))
    returning id into v_sancao;

    update public.punicao_lancamentos
       set status = 'aprovada', sanction_id = v_sancao,
           decided_at = now(), decided_by = (select auth.uid()),
           decision_note = v_nota, updated_at = now()
     where id = p_id;

    perform public.notify_users_sistema(
      v_l.tenant_id, array[v_l.created_by], 'punicao_aprovada',
      'Punição aprovada',
      coalesce(v_l.snap_full_name, 'Colaborador') || ': ' ||
      coalesce(v_l.sanction_name, 'punição') || ' aprovada pelo RH.');
  else
    update public.punicao_lancamentos
       set status = 'reprovada',
           decided_at = now(), decided_by = (select auth.uid()),
           decision_note = v_nota, updated_at = now()
     where id = p_id;

    perform public.notify_users_sistema(
      v_l.tenant_id, array[v_l.created_by], 'punicao_reprovada',
      'Punição reprovada',
      coalesce(v_l.snap_full_name, 'Colaborador') || ': ' || v_nota);
  end if;
end;
$$;

revoke execute on function public.punicao_decidir(uuid, boolean, text) from public, anon;
grant execute on function public.punicao_decidir(uuid, boolean, text) to authenticated;

/**
 * Desfazer uma punição aprovada.
 *
 * A ordem importa: primeiro solta o vínculo, depois apaga a sanção. Ao
 * contrário, o `on delete restrict` da FK recusaria a exclusão.
 */
create or replace function public.punicao_cancelar(p_id uuid, p_nota text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_l record;
  v_sancao uuid;
begin
  select l.* into v_l from public.punicao_lancamentos l where l.id = p_id;
  if v_l.id is null then
    raise exception 'Lançamento não encontrado.';
  end if;
  if not public.has_tenant_role(v_l.tenant_id, '{owner,admin}'::public.member_role[]) then
    raise exception 'Apenas o administrador ou o proprietário cancelam uma punição aprovada.';
  end if;
  if v_l.status <> 'aprovada' then
    raise exception 'Só uma punição aprovada pode ser cancelada.';
  end if;

  v_sancao := v_l.sanction_id;

  update public.punicao_lancamentos
     set status = 'cancelada', sanction_id = null,
         cancelled_at = now(), cancelled_by = (select auth.uid()),
         cancel_note = nullif(btrim(coalesce(p_nota, '')), ''), updated_at = now()
   where id = p_id;

  if v_sancao is not null then
    delete from public.employee_sanctions where id = v_sancao;
  end if;

  perform public.notify_users_sistema(
    v_l.tenant_id, array[v_l.created_by], 'punicao_cancelada',
    'Punição cancelada',
    coalesce(v_l.snap_full_name, 'Colaborador') || ': ' ||
    coalesce(v_l.sanction_name, 'punição') || ' foi cancelada e deixou de valer.');
end;
$$;

revoke execute on function public.punicao_cancelar(uuid, text) from public, anon;
grant execute on function public.punicao_cancelar(uuid, text) to authenticated;

/**
 * O documento, com CPF.
 *
 * `tenant_dados_pessoais` não serve aqui: ela exige owner/admin/manager/hr, e o
 * gestor de equipe (`team_lead`) que aplica a punição não passa nessa guarda.
 * Esta função devolve UM CPF, o da pessoa daquele lançamento, para quem já pode
 * ver aquele lançamento. É o mesmo raciocínio que separa `meu_perfil_pessoal` de
 * `tenant_dados_pessoais`: quanto mais estreita a pergunta, mais estreita a
 * porta.
 */
create or replace function public.punicao_documento(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_l record;
  v_doc jsonb;
begin
  select l.* into v_l from public.punicao_lancamentos l where l.id = p_id;
  if v_l.id is null or not public.pode_ver_punicao(v_l.tenant_id, v_l.user_id, v_l.created_by) then
    return null;
  end if;

  select jsonb_build_object(
    'id', v_l.id,
    'status', v_l.status,
    'empresa', (select t.name from public.tenants t where t.id = v_l.tenant_id),
    'unidade', v_l.snap_unit_name,
    'colaborador', jsonb_build_object(
      'nome', coalesce(v_l.snap_full_name, p.full_name),
      'cpf', p.cpf,
      'matricula', v_l.snap_employee_code,
      'setor', v_l.snap_department_name,
      'subsetor', v_l.snap_subdepartment_name,
      'funcao', v_l.snap_position_name,
      'gestor', v_l.snap_manager_name
    ),
    'infracao', jsonb_build_object(
      'codigo', v_l.infraction_code,
      'nome', v_l.infraction_name,
      'descricao', v_l.infraction_description,
      'gravidade', v_l.severity
    ),
    'punicao', v_l.sanction_name,
    'aplicadaEm', v_l.applied_on,
    'informacaoComplementar', v_l.extra_info,
    'lancadoPor', (select x.full_name from public.profiles x where x.id = v_l.created_by),
    'decididoPor', (select x.full_name from public.profiles x where x.id = v_l.decided_by),
    'motivoDaDecisao', v_l.decision_note
  ) into v_doc
  from public.profiles p
  where p.id = v_l.user_id;

  return v_doc;
end;
$$;

revoke execute on function public.punicao_documento(uuid) from public, anon;
grant execute on function public.punicao_documento(uuid) to authenticated;

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
