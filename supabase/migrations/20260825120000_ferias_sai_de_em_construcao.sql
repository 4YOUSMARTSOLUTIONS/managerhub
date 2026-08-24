-- Férias vai ao ar.
--
-- As três levas estão aplicadas e verificadas (fluxo colaborador -> gestor ->
-- DP, operacional lançado pelo gestor, reagendamento com troca atômica,
-- painel com timeline e cron de vencimento). Em migração, e não no Painel
-- ADM, pela mesma razão de treinamentos e blitz: base nova reproduz o estado
-- sem passo manual.
update public.platform_module_flags
   set under_construction = false, updated_at = now()
 where module_key = 'ferias';
