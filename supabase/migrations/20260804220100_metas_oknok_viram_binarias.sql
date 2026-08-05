-- Converte para "Sim ou não" as metas que já estavam improvisadas como binárias.
--
-- Três metas da SARAH foram cadastradas com a unidade literalmente escrita
-- "OK/NOK" e meta 100, esperando que alguém digitasse 100 para OK e 0 para NOK.
-- A intenção está na própria unidade, então a conversão é segura.
--
-- Filtra por `unit`, não por nome: nome muda, e amarrar a migração a três textos
-- específicos a tornaria frágil sem ganhar nada.
--
-- NENHUM lançamento é reescrito. Os registros dessas metas já têm
-- target_value = 100 e actual_value nulo, que é exatamente o formato binário.
-- Por isso a migração toca só em `individual_goals`.
--
-- `partial_pct` vai a nulo porque num sim/não não existe meio-termo: deixar um
-- percentual parcial ali seria uma regra que nunca se aplica, esperando para
-- confundir alguém depois.
update public.individual_goals
   set direction = 'binaria',
       partial_pct = null,
       updated_at = now()
 where upper(replace(trim(unit), ' ', '')) = 'OK/NOK'
   and direction <> 'binaria';

-- Metas com unidade "%" e meta 100 são binárias na PRÁTICA (Farol de caixa,
-- Report Plano de Contingência, Vales Financeiros...), mas o "%" pode ser
-- intencional. Ficam como estão: converter seria adivinhar a intenção de quem
-- cadastrou, e a tela permite mudar uma a uma.
