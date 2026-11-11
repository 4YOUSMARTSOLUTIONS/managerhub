-- Alertas da blitz, um a um, para quem acompanha (LUIZ, 11/11/2026).
--
-- O bloco de tratativas só mostra a quem recebeu o alerta (o gestor do
-- colaborador). Owner, admin e a equipe de segurança viam só o percentual
-- "Alertas com tratativa", sem saber quem está devendo. Esta função devolve a
-- lista no mesmo recorte das Análises: período pela data da blitz, unidade do
-- seletor do topo e a mesma alçada de `seg_blitz_analise` (empresa inteira
-- para owner/admin/manager/segurança; a cadeia para o Gestor).
--
-- Só leitura: registrar a tratativa continua sendo do gestor alertado.

create or replace function public.seg_blitz_alertas_do_periodo(p_de date, p_ate date, p_unit_ids uuid[] default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.my_active_tenant();
  v_amplo boolean;
  v_lider boolean;
begin
  if v_tenant is null or not public.is_tenant_member(v_tenant) then
    raise exception 'Você não tem acesso a esta empresa.';
  end if;
  v_amplo := public.has_tenant_role(v_tenant, '{owner,admin,manager}'::public.member_role[])
          or public.pode_tratar_seguranca(v_tenant);
  v_lider := public.has_tenant_role(v_tenant, '{team_lead}'::public.member_role[]);
  if not (v_amplo or v_lider) then
    raise exception 'As análises da blitz são de quem tem alçada sobre a equipe.' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de then
    raise exception 'Período inválido.';
  end if;
  if p_ate - p_de > 400 then
    raise exception 'Escolha um período de até um ano.';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', al.id,
             'enviado_em', al.enviado_em,
             'occurred_on', a.occurred_on,
             'colaborador', a.snap_full_name,
             'setor', a.snap_department_name,
             'unidade', a.snap_unit_name,
             'gestor', coalesce(a.snap_manager_name, g.full_name),
             'meio', m.name,
             'liberado', a.liberado,
             'motivo', mo.name,
             'observacao', a.observacao,
             'respostas_nao', (
               select coalesce(jsonb_agg(r.snap_pergunta order by r.snap_pergunta), '[]'::jsonb)
                 from public.seg_blitz_respostas r
                where r.avaliacao_id = a.id and r.resposta = 'nao'
             ),
             'tratativa_em', al.tratativa_em,
             'tratativa_resumo', al.tratativa_resumo,
             'tratativa_acordo', al.tratativa_acordo,
             'registrada_em', al.registrada_em
           ) order by (al.registrada_em is not null), a.occurred_on desc, al.enviado_em desc), '[]'::jsonb)
      from public.seg_blitz_alertas al
      join public.seg_blitz_avaliacoes a on a.id = al.avaliacao_id
      left join public.profiles g on g.id = al.gestor_id
      left join public.seg_blitz_meios m on m.id = a.meio_id
      left join public.seg_blitz_motivos mo on mo.id = a.motivo_bloqueio_id
     where al.tenant_id = v_tenant
       and a.tenant_id = v_tenant
       and a.occurred_on between p_de and p_ate
       and (p_unit_ids is null or a.snap_unit_id = any(p_unit_ids) or a.snap_unit_id is null)
       and (v_amplo or a.user_id in (
             select e.user_id from public.my_managed_memberships() e where e.tenant_id = v_tenant
           ))
  );
end;
$function$;

revoke execute on function public.seg_blitz_alertas_do_periodo(date, date, uuid[]) from public, anon;
grant execute on function public.seg_blitz_alertas_do_periodo(date, date, uuid[]) to authenticated;

notify pgrst, 'reload schema';
