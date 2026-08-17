-- Duas telas novas em Segurança, ainda como casca.
--
-- Blitz de trajeto (abordagem na rota) e Gabaritos de segurança (o padrão que a
-- inspeção usa para dizer se está conforme). Entram já com a chave no registro
-- de módulos, marcadas como "em construção": assim aparecem na navegação com o
-- selo certo, e quando a implementação chegar não é preciso mexer em
-- entitlement nenhum.
--
-- Estado `on` para as unidades que já existem, pelo mesmo motivo do seed
-- original: o padrão de `unit_modules` é bloqueado, e sem esta linha o cliente
-- atual veria uma porta trancada em vez de uma tela em construção.

insert into public.unit_modules (tenant_id, unit_id, module_key, state)
select u.tenant_id, u.id, k, 'on'::public.unit_module_state
  from public.units u
 cross join unnest(array['seg_blitz', 'seg_gabaritos']) as k
on conflict (unit_id, module_key) do nothing;

insert into public.platform_module_flags (module_key, under_construction)
values ('seg_blitz', true), ('seg_gabaritos', true)
on conflict (module_key) do nothing;
