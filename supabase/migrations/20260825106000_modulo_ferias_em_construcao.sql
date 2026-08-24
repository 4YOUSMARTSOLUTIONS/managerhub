-- O módulo Férias nasce atrás da cortina: a key entra no registry do app nesta
-- mesma leva, e a flag global segura o acesso até a última leva baixá-la em
-- migração própria (o mesmo rito de treinamentos e da blitz, por
-- reprodutibilidade em base nova).
insert into public.platform_module_flags (module_key, under_construction)
values ('ferias', true)
on conflict (module_key) do update
  set under_construction = true, updated_at = now();
