-- Liga o módulo de chat interno nas unidades que já existem.
--
-- `unit_modules` nasce sem linha para uma key nova, e sem linha o módulo é
-- tratado como `hidden`. Mesmo seed da 20260815104000 (absenteísmos).
insert into public.unit_modules (tenant_id, unit_id, module_key, state)
select u.tenant_id, u.id, 'chat', 'on'
from public.units u
on conflict (unit_id, module_key) do nothing;
