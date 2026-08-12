-- O check da decisão era uma equivalência, e devia ser uma implicação.
--
-- `(status in ('aprovada','reprovada')) = (decided_at is not null and ...)` lê-se
-- "só a decidida tem carimbo, e toda decidida tem carimbo". A segunda metade é o
-- que se queria; a primeira quebra o cancelamento: ao virar `cancelada`, o lado
-- esquerdo fica falso e o direito continua verdadeiro, então o banco recusava
-- justamente a transição que existe para desfazer a punição.
--
-- Apagar `decided_at`/`decided_by` no cancelamento resolveria o check e perderia
-- a história: quem aprovou, e quando, é o que a auditoria vai querer saber
-- depois de a punição cair. O carimbo fica.

alter table public.punicao_lancamentos
  drop constraint punicao_decidida_tem_carimbo;

alter table public.punicao_lancamentos
  add constraint punicao_decidida_tem_carimbo
  check (status not in ('aprovada', 'reprovada')
         or (decided_at is not null and decided_by is not null));

notify pgrst, 'reload schema';
