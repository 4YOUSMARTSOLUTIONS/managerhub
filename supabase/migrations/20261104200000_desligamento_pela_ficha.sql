-- Desligamento pela ficha do colaborador.
--
-- Achado do LUIZ (04/11/2026): "Editar colaborador" não tinha como desligar.
-- Só a importação em lote gravava a demissão (`dismissed_at` + `is_active =
-- false`); o botão "Inativar" da lista corta o acesso sem data de saída, e a
-- data é o que a RV proporcional, as férias e o histórico de movimentações
-- leem.
--
-- Esta função faz o mesmo que a coluna Demissão da importação, para uma pessoa:
--   - data preenchida (diferente da atual): desliga nessa data e corta o acesso;
--   - data apagada de quem estava desligado: desfaz (desligamento lançado por
--     engano) e o acesso volta;
--   - sem mudança de data: não mexe em nada (salvar a ficha de alguém inativado
--     sem data não o reativa).
-- Data futura é recusada (o acesso seria cortado antes da hora), e a data não
-- pode ser antes da admissão. Quem desliga é o DP (owner/admin/RH); ninguém
-- desliga a si mesmo, e o proprietário só sai pelas mãos do dono do sistema
-- (a mesma regra dos botões da lista).

create or replace function public.colaborador_definir_desligamento(
  p_tenant uuid, p_user uuid, p_data date
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_m record;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not public.has_tenant_role(p_tenant, '{owner,admin,hr}'::public.member_role[]) then
    raise exception 'Apenas proprietário, administrador e RH desligam colaboradores.';
  end if;

  select m.id, m.role, m.admission_date, m.dismissed_at
    into v_m
    from public.memberships m
   where m.tenant_id = p_tenant and m.user_id = p_user;
  if v_m.id is null then
    raise exception 'Colaborador não encontrado nesta empresa.';
  end if;

  if p_data is not distinct from v_m.dismissed_at then
    return;
  end if;

  if p_data is not null then
    if p_user = (select auth.uid()) then
      raise exception 'Você não pode desligar a si mesmo.';
    end if;
    if v_m.role = 'owner' and not public.is_super_admin() then
      raise exception 'O proprietário só pode ser desligado pelo dono do sistema.';
    end if;
    if p_data > v_hoje then
      raise exception 'A data de desligamento não pode ser futura: lance no dia em que o desligamento acontecer.';
    end if;
    if v_m.admission_date is not null and p_data < v_m.admission_date then
      raise exception 'A data de desligamento não pode ser antes da admissão (%).', to_char(v_m.admission_date, 'DD/MM/YYYY');
    end if;
    update public.memberships
       set dismissed_at = p_data, is_active = false
     where id = v_m.id;
  else
    -- desfaz um desligamento lançado por engano
    update public.memberships
       set dismissed_at = null, is_active = true
     where id = v_m.id;
  end if;
end;
$$;

revoke execute on function public.colaborador_definir_desligamento(uuid, uuid, date) from public, anon;

notify pgrst, 'reload schema';
