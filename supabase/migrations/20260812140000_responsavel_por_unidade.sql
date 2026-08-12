-- Responsável POR UNIDADE.
--
-- Um treinamento que vale para várias unidades raramente tem o mesmo dono em
-- todas: cada filial tem quem responde por ela. Sem isto, ou se cadastra um
-- responsável genérico que não resolve na ponta, ou se duplica o curso por
-- unidade, que é justamente o retrabalho que o escopo múltiplo veio eliminar.
--
-- `unit_id` nulo = responsável por TODAS as unidades do treinamento. Com
-- unidade = responde só por aquela. As duas formas convivem: dá para ter um
-- coordenador geral e um responsável local em cada filial.
--
-- Quem PODE GERIR o treinamento (editar catálogo, ver as matrículas) continua
-- sendo qualquer responsável, de qualquer unidade. A unidade diz de quem é a
-- ponta, não recorta a permissão: recortar exigiria dividir também o catálogo,
-- e o curso é um só.

alter table public.training_owners
  add column unit_id uuid references public.units(id) on delete cascade;

-- a chave antiga (training_id, user_id) impedia a mesma pessoa de responder por
-- duas unidades do mesmo curso
alter table public.training_owners drop constraint training_owners_training_id_user_id_key;

-- por unidade: uma linha por pessoa e unidade
create unique index training_owners_por_unidade_uidx
  on public.training_owners (training_id, user_id, unit_id)
  where unit_id is not null;

-- geral: uma linha por pessoa (NULL não colide sozinho num unique comum)
create unique index training_owners_geral_uidx
  on public.training_owners (training_id, user_id)
  where unit_id is null;

notify pgrst, 'reload schema';
