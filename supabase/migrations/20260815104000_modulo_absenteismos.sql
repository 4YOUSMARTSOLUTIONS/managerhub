-- Liga o módulo de absenteísmos nas unidades que já existem.
--
-- `unit_modules` nasce sem linha para uma key nova, e sem linha o módulo é
-- tratado como `hidden`. Mesmo seed da 20260814105000, agora para uma key só.
insert into public.unit_modules (tenant_id, unit_id, module_key, state)
select u.tenant_id, u.id, 'absenteismos', 'on'
from public.units u
on conflict (unit_id, module_key) do nothing;
