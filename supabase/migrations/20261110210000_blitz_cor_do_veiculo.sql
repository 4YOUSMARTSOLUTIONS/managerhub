-- Blitz de trajeto: coluna de cor (LUIZ, 10/11/2026), 1ª de 2 etapas.
--
-- A cor é lista fechada (as principais, mais "outra" para não travar a fila
-- da portaria) e vai também para o cadastro do veículo: a próxima blitz da
-- pessoa já vem com ela preenchida, como placa, modelo e propriedade.
-- Separada da regra (20261110210100) para entrar antes do código novo, que já
-- lê a coluna, sem barrar a blitz de quem ainda está com a tela antiga.

alter table public.seg_veiculos add column if not exists cor text
  check (cor in ('branco', 'preto', 'prata', 'cinza', 'vermelho', 'azul', 'outra'));
alter table public.seg_blitz_avaliacoes add column if not exists cor text
  check (cor in ('branco', 'preto', 'prata', 'cinza', 'vermelho', 'azul', 'outra'));
