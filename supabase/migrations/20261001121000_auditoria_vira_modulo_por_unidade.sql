-- "Logs do sistema" entra no registro de módulos por unidade.
--
-- Ela era `core` no catálogo (`src/lib/modules.ts`), e core quer dizer "sempre
-- ligada, fora da venda": por isso não aparecia na lista do Painel ADM e não
-- havia como escondê-la de uma empresa. Agora ela é um módulo como os outros, e
-- o Painel ADM decide unidade por unidade.
--
-- O papel continua sendo o piso (Proprietário e Administrador, por `minRole`); o
-- entitlement é o teto. Quem não tem o papel não vê, e quem tem o papel só vê
-- onde a unidade tiver o módulo.
--
-- A carga é obrigatória: o padrão de `unit_modules` é bloqueado (ausência de
-- linha = hidden), então sem ela a tela sumiria do menu de quem a usa hoje.
-- Mesmo rito de férias (20260825107000) e de metas da área (20260910120000).
insert into public.unit_modules (tenant_id, unit_id, module_key, state)
select u.tenant_id, u.id, 'auditoria', 'on'::public.unit_module_state
  from public.units u
on conflict (unit_id, module_key) do nothing;
