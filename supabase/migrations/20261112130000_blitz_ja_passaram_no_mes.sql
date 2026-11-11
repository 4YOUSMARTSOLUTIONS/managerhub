-- Blitz: quem já passou pela blitz neste mês (LUIZ, 11/11/2026).
--
-- O formulário avisa quando o colaborador escolhido já tem blitz no mês
-- ("Arthur Filho já passou pela blitz este mês: 11/11 às 06:30"), para pegar
-- engano de pessoa sem travar a segunda blitz de verdade. O avaliador só lê,
-- pela RLS, as blitz que ele mesmo registrou; o aviso precisa enxergar as de
-- qualquer avaliador, então vem por esta função, que devolve o mínimo: quem,
-- quantas vezes e a data e a hora da última. Só para quem avalia a blitz.

create or replace function public.seg_blitz_ja_passaram_no_mes()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.my_active_tenant();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_inicio date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
begin
  if v_tenant is null or not public.pode_avaliar_blitz(v_tenant) then
    raise exception 'Só quem avalia a blitz vê quem já passou no mês.' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'user_id', x.user_id, 'vezes', x.vezes,
             'occurred_on', x.occurred_on, 'registrada_em', x.registrada_em)), '[]'::jsonb)
      from (
        select distinct on (a.user_id)
               a.user_id, a.occurred_on, a.registrada_em,
               count(*) over (partition by a.user_id) as vezes
          from public.seg_blitz_avaliacoes a
         where a.tenant_id = v_tenant
           and a.occurred_on between v_inicio and v_hoje
         order by a.user_id, a.occurred_on desc, a.registrada_em desc
      ) x
  );
end;
$function$;

revoke execute on function public.seg_blitz_ja_passaram_no_mes() from public, anon;
grant execute on function public.seg_blitz_ja_passaram_no_mes() to authenticated;

notify pgrst, 'reload schema';
