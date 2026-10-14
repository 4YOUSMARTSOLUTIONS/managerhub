-- Sai o `reference_month` da sessão de feedback.
--
-- É a metade que SUBTRAI da troca feita em 20261013120000: o período de
-- referência (`period_start`/`period_end`) já carrega tudo o que o mês
-- carregava, e as sessões existentes foram convertidas lá. Manter as duas
-- colunas deixaria duas respostas para "o que esta sessão cobre", e a antiga
-- pararia de ser gravada: valor velho em coluna viva é armadilha para o próximo
-- que ler o schema.
--
-- Separada da anterior de propósito, e aplicada só depois de o código novo
-- estar no ar: a versão anterior da tela lia e gravava esta coluna, e derrubá-la
-- no mesmo passo quebraria a aba de sessões durante o intervalo do deploy.
--
-- Nada no banco depende dela (nenhuma view, função, índice ou policy).
alter table public.feedback_sessions
  drop column if exists reference_month;

notify pgrst, 'reload schema';
