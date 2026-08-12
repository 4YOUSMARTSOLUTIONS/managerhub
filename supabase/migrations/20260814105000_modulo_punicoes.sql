-- Liga o módulo de punições nas unidades que já existem.
--
-- `unit_modules` nasce sem linha para uma key nova, e sem linha o módulo é
-- tratado como `hidden`: o cliente atual perderia a tela sem saber que ela
-- existe. É o mesmo seed da 20260716234721, agora para uma key só.
--
-- Vale para as unidades de hoje. Unidade criada daqui para frente entra pelo
-- caminho normal de venda, no Painel ADM.
insert into public.unit_modules (tenant_id, unit_id, module_key, state)
select u.tenant_id, u.id, 'punicoes', 'on'
from public.units u
on conflict (unit_id, module_key) do nothing;
