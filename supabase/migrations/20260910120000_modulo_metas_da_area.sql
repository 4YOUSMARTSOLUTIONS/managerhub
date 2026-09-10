-- A chave 'metas_area' no registro de módulos das unidades que já existem.
--
-- "Metas da área" era a segunda aba de /metas e passou a ser tela própria, com
-- key própria. O padrão de `unit_modules` é bloqueado (ausência de linha =
-- hidden), então sem esta carga o item nasceria sumido do menu de quem já usava
-- a aba todo dia. Mesmo rito de férias (20260825107000) e da blitz
-- (20260819210000).
--
-- O estado é COPIADO de 'metas', e não fixado em 'on': unidade que não tem
-- metas contratadas não deve ganhar a tela nova de brinde, e unidade que está
-- na vitrine ('locked') continua na vitrine.
insert into public.unit_modules (tenant_id, unit_id, module_key, state)
select um.tenant_id, um.unit_id, 'metas_area', um.state
  from public.unit_modules um
 where um.module_key = 'metas'
on conflict (unit_id, module_key) do nothing;
