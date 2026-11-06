-- ---------------------------------------------------------------------------
-- Os avisos da decisão do gestor dizem quando a previsão é um reagendamento.
--
-- Aprovado o reagendamento do Paulo, o DP recebeu "Férias aguardando
-- efetivação" com só o período novo: no sino não dava para saber que havia um
-- período antigo a ser trocado (LUIZ, 06/11/2026). Agora o aviso diz "de ...
-- para ...", ao DP, ao colaborador e na devolução, e lembra que o período
-- anterior vale até a efetivação. Os tipos de aviso não mudam (o sino roteia
-- por eles).
-- ---------------------------------------------------------------------------

create or replace function public.ferias_decidir(p_id uuid, p_aprovar boolean, p_nota text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_l record;
  v_o record;
  v_gestor boolean;
  v_dp boolean;
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
  v_avisar uuid[];
  v_dp_arr uuid[];
  v_nome text;
  v_novo text;
  v_troca text;
begin
  select f.* into v_l from public.ferias_solicitacoes f where f.id = p_id;
  if v_l.id is null then
    raise exception 'Previsão não encontrada.';
  end if;
  v_gestor := public.manages_user(v_l.user_id, v_l.tenant_id);
  v_dp := public.has_tenant_role(v_l.tenant_id, '{owner,admin,hr}'::public.member_role[]);

  if v_l.status = 'solicitada' then
    if not (v_gestor or v_dp) then
      raise exception 'Apenas o gestor do colaborador ou o departamento pessoal decidem a previsão.';
    end if;
  elsif v_l.status = 'aprovada' and not p_aprovar then
    if not v_dp then
      raise exception 'Apenas o departamento pessoal devolve uma previsão aprovada.';
    end if;
  else
    raise exception 'Esta previsão não está aguardando decisão.';
  end if;

  if not p_aprovar and v_nota is null then
    raise exception 'Informe o motivo da reprovação.';
  end if;

  v_nome := coalesce(v_l.snap_full_name, 'Colaborador');
  v_novo := to_char(v_l.start_date, 'DD/MM/YYYY') || ' a ' || to_char(v_l.end_date, 'DD/MM/YYYY');
  -- reagendamento: o período que está sendo trocado
  if v_l.reagendada_de is not null then
    select f.start_date, f.end_date into v_o
      from public.ferias_solicitacoes f where f.id = v_l.reagendada_de;
    v_troca := case when v_o.start_date is not null
      then 'de ' || to_char(v_o.start_date, 'DD/MM/YYYY') || ' a ' || to_char(v_o.end_date, 'DD/MM/YYYY')
           || ' para ' || v_novo
      else 'para ' || v_novo end;
  end if;

  if p_aprovar then
    update public.ferias_solicitacoes
       set status = 'aprovada',
           decided_at = now(), decided_by = (select auth.uid()),
           decision_note = v_nota, updated_at = now()
     where id = p_id;

    v_avisar := array_remove(array[v_l.user_id, v_l.created_by], (select auth.uid()));
    if array_length(v_avisar, 1) > 0 then
      if v_troca is not null then
        perform public.notify_users_sistema(
          v_l.tenant_id, v_avisar, 'ferias_aprovada',
          'Reagendamento aprovado pelo gestor',
          v_nome || ': ' || v_troca || ', aguardando a efetivação do departamento pessoal. '
          || 'Até lá, vale o período anterior.');
      else
        perform public.notify_users_sistema(
          v_l.tenant_id, v_avisar, 'ferias_aprovada',
          'Férias aprovadas pelo gestor',
          v_nome || ': ' ||
          to_char(v_l.start_date, 'DD/MM') || ' a ' || to_char(v_l.end_date, 'DD/MM') ||
          ', aguardando a efetivação do departamento pessoal.');
      end if;
    end if;

    v_dp_arr := array_remove(public.ferias_destinatarios_dp(v_l.tenant_id), (select auth.uid()));
    if v_dp_arr is not null and array_length(v_dp_arr, 1) > 0 then
      if v_troca is not null then
        perform public.notify_users_sistema(
          v_l.tenant_id, v_dp_arr, 'ferias_aguardando_efetivacao',
          'Reagendamento aguardando efetivação',
          v_nome || ': ' || v_troca || '. Ao efetivar, o período anterior sai da folha e do calendário.');
      else
        perform public.notify_users_sistema(
          v_l.tenant_id, v_dp_arr, 'ferias_aguardando_efetivacao',
          'Férias aguardando efetivação',
          v_nome || ': ' || v_novo || '.');
      end if;
    end if;
  else
    update public.ferias_solicitacoes
       set status = 'reprovada',
           decided_at = now(), decided_by = (select auth.uid()),
           decision_note = v_nota, updated_at = now()
     where id = p_id;

    v_avisar := array_remove(array[v_l.user_id, v_l.created_by], (select auth.uid()));
    if array_length(v_avisar, 1) > 0 then
      if v_troca is not null then
        perform public.notify_users_sistema(
          v_l.tenant_id, v_avisar, 'ferias_reprovada',
          'Reagendamento devolvido',
          v_nome || ': ' || rtrim(v_nota, '. ') || '. O período anterior continua valendo.');
      else
        perform public.notify_users_sistema(
          v_l.tenant_id, v_avisar, 'ferias_reprovada',
          'Previsão de férias devolvida',
          v_nome || ': ' || v_nota);
      end if;
    end if;
  end if;
end;
$function$;

revoke execute on function public.ferias_decidir(uuid, boolean, text) from public, anon;
