-- Linha do tempo do Painel de férias com 12 meses (LUIZ, 12/11/2026).
--
-- A tela ganhou rolagem horizontal (largura fixa por mês), então a janela
-- deixa de precisar caber em seis meses. Só a janela muda: o corpo da função
-- é o mesmo, trocado no lugar, e a troca recusa se o trecho não for o
-- esperado (função alterada por outra migração no meio do caminho).

do $$
declare
  v_def text := pg_get_functiondef('public.ferias_painel(uuid, date, uuid[])'::regprocedure);
begin
  if position('interval ''6 months''' in v_def) = 0 then
    raise exception 'ferias_painel mudou: a janela de 6 meses não foi encontrada';
  end if;
  execute replace(v_def, 'interval ''6 months''', 'interval ''12 months''');
end $$;

-- AGENTS.md: toda SECURITY DEFINER substituída sai do alcance da chave pública
revoke execute on function public.ferias_painel(uuid, date, uuid[]) from public, anon;

notify pgrst, 'reload schema';
