-- Treinamentos deixa de ser "módulo em construção".
--
-- A flag foi semeada na 20260716234839, quando a tela era só um placeholder.
-- Com a leva 1 no ar (catálogo, matriz de obrigatoriedade por cargo/setor e
-- matrículas), o gate de construção passou a esconder um módulo que já funciona.
--
-- A correção vive numa migração, e não só num UPDATE feito à mão, porque o
-- estado precisa ser reproduzível: um ambiente novo que rode as migrações do
-- zero herdaria a flag do seed e nasceria com o módulo bloqueado.
--
-- Os demais placeholders continuam marcados, e é isso que se quer: cada um sai
-- da lista quando a tela dele existir de verdade.
update public.platform_module_flags
   set under_construction = false, updated_at = now()
 where module_key = 'treinamentos';
