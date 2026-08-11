-- Operar uma reunião (iniciar, antecipar, registrar, finalizar, cancelar,
-- salvar rascunho) passa a exigir vínculo COM A REUNIÃO, não só com a empresa.
--
-- As seis RPCs da família são SECURITY DEFINER, então a RLS não vale dentro
-- delas: a única barreira era a guarda no corpo, e ela dizia apenas
-- `is_tenant_member(tenant_id)`. Ou seja, qualquer funcionário logado podia,
-- chamando a RPC direto com a chave pública do navegador:
--   - cancelar a reunião em andamento de outra pessoa (e o cancelamento APAGA
--     o rascunho, levando junto as anotações que estavam sendo escritas);
--   - sobrescrever esse rascunho;
--   - finalizar/registrar uma reunião da qual não participa, inclusive privada,
--     que ele nem enxerga na tela.
--
-- A regra nova, `pode_operar_serie`: dono da série, `owner`, `manager`,
-- participante da reunião e, em reunião PÚBLICA, também `admin`. É mais larga
-- que `pode_editar_serie` de propósito: numa reunião pública os PARTICIPANTES
-- registram e finalizam, e travar isso quebraria o uso normal. E é mais
-- estreita que hoje: quem só enxerga a reunião não a opera.
--
-- O cron `auto_finish_overdue_meetings` não passa por estas RPCs (faz UPDATE
-- direto), então segue funcionando.

create or replace function public.pode_operar_serie(p_series public.meeting_series)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_series.tenant_id in (select public.my_tenant_ids())
     and (
       p_series.owner_user_id = (select auth.uid())
       or p_series.tenant_id in (select public.my_role_tenant_ids('{owner,manager}'::member_role[]))
       or (p_series.is_private = false
           and p_series.tenant_id in (select public.my_role_tenant_ids('{admin}'::member_role[])))
       or exists (
            select 1 from public.meeting_series_participants p
             where p.series_id = p_series.id and p.user_id = (select auth.uid())
          )
     );
$$;

revoke execute on function public.pode_operar_serie(public.meeting_series) from public, anon;
grant execute on function public.pode_operar_serie(public.meeting_series) to authenticated;

-- Os corpos são remendados a partir do que está no banco (molde da
-- 20260807162000): são funções longas e uma cópia à mão perderia linha em
-- silêncio. Duas formas de guarda, conforme a variável disponível no ponto.
do $do$
declare
  r record;
  v_def text;
  v_new text;
  v_trocou int := 0;

  c_serie_velha constant text := $q$if not public.is_tenant_member(v_series.tenant_id) then raise exception 'Sem permissão'; end if;$q$;
  c_serie_nova  constant text := $q$if not public.pode_operar_serie(v_series) then raise exception 'Você não participa desta reunião'; end if;$q$;

  c_occ_velha constant text := $q$if not public.is_tenant_member(v_occ.tenant_id) then raise exception 'Sem permissão'; end if;$q$;
  c_occ_nova  constant text := $q$if not exists (select 1 from public.meeting_series s where s.id = v_occ.series_id and public.pode_operar_serie(s)) then raise exception 'Você não participa desta reunião'; end if;$q$;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('start_meeting_occurrence','anticipate_meeting_occurrence',
                        'finish_meeting_occurrence','register_meeting_occurrence',
                        'cancel_meeting_occurrence','save_occurrence_draft')
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, c_serie_velha, c_serie_nova);
    v_new := replace(v_new, c_occ_velha, c_occ_nova);
    if v_new = v_def then
      raise exception 'guarda esperada não encontrada em %', r.proname;
    end if;
    execute v_new;
    v_trocou := v_trocou + 1;
  end loop;

  -- 6 nomes, 7 assinaturas: start_meeting_occurrence tem duas (com e sem sala)
  if v_trocou <> 7 then
    raise exception 'esperava remendar 7 assinaturas, remendou %', v_trocou;
  end if;
end
$do$;

revoke execute on function public.cancel_meeting_occurrence(uuid) from public, anon;
revoke execute on function public.save_occurrence_draft(uuid, jsonb) from public, anon;
revoke execute on function public.finish_meeting_occurrence(jsonb) from public, anon;
revoke execute on function public.register_meeting_occurrence(jsonb) from public, anon;
revoke execute on function public.start_meeting_occurrence(uuid) from public, anon;
revoke execute on function public.start_meeting_occurrence(uuid, uuid, text) from public, anon;
revoke execute on function public.anticipate_meeting_occurrence(uuid, uuid, text, date, time) from public, anon;
