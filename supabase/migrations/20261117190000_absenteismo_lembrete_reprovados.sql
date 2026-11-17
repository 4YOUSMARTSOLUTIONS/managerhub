-- Lembrete diário também para os reprovados (LUIZ, 17/11/2026)
--
-- Desde 32ceebb o lançamento reprovado volta para "Em aberto", no topo, para
-- quem lançou corrigir pelo Efetivar e enviar de novo. O lembrete das 08:00 só
-- olhava status = 'aberto', então um reprovado esquecido não gerava aviso
-- nenhum depois do sino da própria reprovação.
--
-- Continua UM aviso por pessoa que lançou, agora somando os dois casos:
--   * em aberto: o que já era (dia anterior sem efetivar);
--   * reprovado: reprovado antes de hoje. O do dia já teve o sino
--     'absenteismo_reprovado' na hora da decisão.
-- O texto muda conforme o que há: só em aberto (igual a antes), só reprovado,
-- ou os dois.

create or replace function public.absenteismo_lembrar_em_aberto()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r record;
  v_titulo text;
  v_corpo text;
  v_n int := 0;
begin
  for r in
    select l.tenant_id, l.created_by,
           count(*) filter (where l.status = 'aberto') as qtd_aberto,
           count(*) filter (where l.status = 'reprovado') as qtd_reprov,
           -- em aberto
           min(coalesce(l.snap_full_name, 'Colaborador')) filter (where l.status = 'aberto') as nome_aberto,
           min(l.occurred_on) filter (where l.status = 'aberto') as desde,
           bool_and(l.partial_day) filter (where l.status = 'aberto') as so_parcial,
           string_agg(coalesce(l.snap_full_name, 'Colaborador') || ' (desde ' || to_char(l.occurred_on, 'DD/MM') || ')',
                      ', ' order by l.occurred_on, l.snap_full_name) filter (where l.status = 'aberto') as quem_aberto,
           -- reprovados
           min(coalesce(l.snap_full_name, 'Colaborador')) filter (where l.status = 'reprovado') as nome_reprov,
           min(l.occurred_on) filter (where l.status = 'reprovado') as dia_reprov,
           string_agg(coalesce(l.snap_full_name, 'Colaborador') || ' (' || to_char(l.occurred_on, 'DD/MM') || ')',
                      ', ' order by l.occurred_on, l.snap_full_name) filter (where l.status = 'reprovado') as quem_reprov
      from public.absenteismo_lancamentos l
     where (l.status = 'aberto'
            and coalesce(l.ausente_ate, l.occurred_on) < v_hoje)
        or (l.status = 'reprovado'
            and coalesce((l.decided_at at time zone 'America/Sao_Paulo')::date, l.occurred_on) < v_hoje)
     group by l.tenant_id, l.created_by
  loop
    if r.qtd_reprov = 0 then
      -- só em aberto: o texto de sempre
      v_titulo := case when r.qtd_aberto = 1 then 'Ausência em aberto' else r.qtd_aberto || ' ausências em aberto' end;
      v_corpo := case when r.qtd_aberto = 1 then
          r.nome_aberto || ' segue em aberto desde ' || to_char(r.desde, 'DD/MM') || '. '
            || case when r.so_parcial then 'Efetive quando tiver o horário e o motivo.'
                    else 'Se não comparecer hoje, registre em "Continua ausente". Quando tiver o motivo, use Efetivar.' end
        else
          'Seguem em aberto: ' || r.quem_aberto || '. Registre quem continua ausente e efetive quem já tem o motivo.'
        end;
    elsif r.qtd_aberto = 0 then
      -- só reprovados
      v_titulo := case when r.qtd_reprov = 1 then 'Ausência reprovada para corrigir'
                       else r.qtd_reprov || ' ausências reprovadas para corrigir' end;
      v_corpo := case when r.qtd_reprov = 1 then
          'A ausência de ' || r.nome_reprov || ' (' || to_char(r.dia_reprov, 'DD/MM') || ') foi reprovada pelo RH e segue sem correção. '
            || 'Corrija pelo Efetivar e envie de novo, ou cancele o lançamento se ela não procede.'
        else
          'Reprovadas pelo RH e ainda sem correção: ' || r.quem_reprov || '. '
            || 'Corrija pelo Efetivar e envie de novo, ou cancele o lançamento que não procede.'
        end;
    else
      -- os dois
      v_titulo := (r.qtd_aberto + r.qtd_reprov) || ' ausências esperando você';
      v_corpo := 'Em aberto: ' || r.quem_aberto || '. Reprovadas pelo RH: ' || r.quem_reprov || '. '
        || 'Registre quem continua ausente, efetive quem já tem o motivo e corrija as reprovadas pelo Efetivar.';
    end if;

    perform public.notify_users_sistema(
      r.tenant_id, array[r.created_by], 'absenteismo_em_aberto', v_titulo, v_corpo);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

-- só o cron chama
revoke execute on function public.absenteismo_lembrar_em_aberto() from public, anon, authenticated;

notify pgrst, 'reload schema';
