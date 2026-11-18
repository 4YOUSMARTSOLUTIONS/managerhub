-- Blitz: o que deu "não" na última blitz de cada colaborador (LUIZ, 18/11/2026).
--
-- Ao lançar a blitz, o formulário avisa: "Atenção! Na última blitz, em 12/11,
-- Arthur estava com Antena corta-cerol NOK." A última é a mais recente da
-- pessoa, de qualquer avaliador; se ela saiu conforme, não há aviso (a pessoa
-- corrigiu). Vem com a página, como o aviso de "já passou no mês", para valer
-- também sem sinal na portaria.
--
-- Devolve o mínimo para o aviso: data, se foi bloqueio e o motivo, e as
-- perguntas com "não". Só para quem avalia a blitz.

create or replace function public.seg_blitz_ultima_com_nok()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.my_active_tenant();
begin
  if v_tenant is null or not public.pode_avaliar_blitz(v_tenant) then
    raise exception 'Só quem avalia a blitz vê a última blitz de cada colaborador.' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'user_id', u.user_id,
             'occurred_on', u.occurred_on,
             'liberado', u.liberado,
             'motivo', mo.name,
             'nao', n.itens)), '[]'::jsonb)
      from (
        select distinct on (a.user_id)
               a.id, a.user_id, a.occurred_on, a.liberado, a.motivo_bloqueio_id
          from public.seg_blitz_avaliacoes a
         where a.tenant_id = v_tenant
         order by a.user_id, a.occurred_on desc, a.registrada_em desc, a.id
      ) u
      left join public.seg_blitz_motivos mo on mo.id = u.motivo_bloqueio_id
      cross join lateral (
        select coalesce(jsonb_agg(jsonb_build_object('pergunta_id', r.pergunta_id, 'pergunta', r.snap_pergunta)
                                  order by r.snap_pergunta), '[]'::jsonb) as itens
          from public.seg_blitz_respostas r
         where r.avaliacao_id = u.id and r.resposta = 'nao'
      ) n
     where not u.liberado or jsonb_array_length(n.itens) > 0
  );
end;
$function$;

revoke execute on function public.seg_blitz_ultima_com_nok() from public, anon;
grant execute on function public.seg_blitz_ultima_com_nok() to authenticated;

notify pgrst, 'reload schema';
