-- A chave 'ferias' no registro de módulos das unidades que já existem.
--
-- O padrão de `unit_modules` é bloqueado (ausência de linha = hidden), e sem
-- esta linha o cliente atual veria o módulo sumido do menu em vez da tela em
-- construção. Mesmo rito da blitz (20260819210000).
insert into public.unit_modules (tenant_id, unit_id, module_key, state)
select u.tenant_id, u.id, 'ferias', 'on'::public.unit_module_state
  from public.units u
on conflict (unit_id, module_key) do nothing;
