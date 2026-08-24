-- A blitz sai de "em construção": o fluxo principal (catálogos, formulário,
-- registro com respostas carimbadas, veículos e visibilidade por alçada) está
-- no ar. O painel e a tratativa do gestor chegam na leva seguinte, mas isso é
-- acréscimo, não pré-requisito de uso.

update public.platform_module_flags
   set under_construction = false
 where module_key = 'seg_blitz';
