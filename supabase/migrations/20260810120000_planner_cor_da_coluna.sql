-- Cor opcional na coluna do Planner.
--
-- A MESMA paleta fixa das etiquetas, pelo mesmo motivo: cor livre vira um
-- arco-iris ilegivel e um campo a validar para sempre. Nula = coluna neutra,
-- entao nenhum quadro existente muda de cara.
--
-- A cor pinta a IDENTIDADE da coluna (borda superior + cabecalho), nunca o
-- corpo: os cartoes carregam etiquetas, prioridade e prazo coloridos, e tudo
-- isso sobre um fundo verde viraria ruido. Essa decisao mora na tela; o banco
-- so guarda o tom.
alter table public.planner_buckets
  add column color text
  check (color is null or color in ('blue','green','amber','red','purple','pink','gray','dark'));
