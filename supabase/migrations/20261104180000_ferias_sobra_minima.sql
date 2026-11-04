-- Férias: o pedido não pode deixar uma sobra que nunca vai virar férias.
--
-- Achado do LUIZ (04/11/2026): um colaborador com 15 dias de saldo conseguiu
-- programar 12, e os 3 dias que sobraram não cabem em período nenhum (todo
-- período tem no mínimo 5 dias, art. 134 §1º). O erro só aparecia na hora de
-- lançar os 3 dias, quando já não havia o que fazer.
--
-- Duas checagens novas, por aquisitivo, depois de debitar o pedido inteiro:
--   - sobra entre 1 e 4 dias: recusa (use o saldo todo, ou deixe ao menos 5);
--   - o aquisitivo chegaria a 3 períodos com saldo sobrando: recusa (não há
--     quarto período).
-- O pedido que já existe não é revalidado; vale para os pedidos novos (todos os
-- caminhos passam por `ferias_validar_periodos`).

do $migr$
declare
  v_def text;
  v_de text := 'extract(year from aq_ini[k])::int, extract(year from aq_fim[k])::int, v_min14, aq_saldo[k];'
               || chr(10) || '    end if;';
  v_para text;
  v_qtd int;
begin
  v_def := pg_get_functiondef('public.ferias_validar_periodos(uuid, uuid, jsonb, date, uuid, boolean)'::regprocedure);
  v_qtd := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  if v_qtd <> 1 then raise exception 'ferias_validar_periodos: âncora encontrada % vezes', v_qtd; end if;

  v_para := v_de || chr(10) ||
    '    -- art. 134 §1º: nenhum período tem menos de 5 dias, e são no máximo 3. O que' || chr(10) ||
    '    -- sobrar no aquisitivo precisa caber num período futuro.' || chr(10) ||
    '    if aq_usado[k] and aq_saldo[k] between 1 and 4 then' || chr(10) ||
    '      raise exception ''Com este pedido sobrariam % dia(s) no aquisitivo %/%, e nenhum período de férias pode ter menos de 5 dias (art. 134). Use o saldo todo ou deixe ao menos 5 dias para um próximo período.'',' || chr(10) ||
    '        aq_saldo[k], extract(year from aq_ini[k])::int, extract(year from aq_fim[k])::int;' || chr(10) ||
    '    end if;' || chr(10) ||
    '    if aq_usado[k] and aq_qtd[k] >= 3 and aq_saldo[k] > 0 then' || chr(10) ||
    '      raise exception ''O aquisitivo %/% chegaria ao 3º período com % dia(s) ainda sobrando, e as férias podem ser divididas em no máximo 3 períodos (art. 134). Use o saldo todo neste período.'',' || chr(10) ||
    '        extract(year from aq_ini[k])::int, extract(year from aq_fim[k])::int, aq_saldo[k];' || chr(10) ||
    '    end if;';

  execute replace(v_def, v_de, v_para);
end
$migr$;

revoke execute on function public.ferias_validar_periodos(uuid, uuid, jsonb, date, uuid, boolean)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
