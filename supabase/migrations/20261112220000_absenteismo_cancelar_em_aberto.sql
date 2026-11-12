-- Cancelar um lançamento em aberto (LUIZ, 12/11/2026).
--
-- `absenteismo_campos_para_confirmar` exigia motivo e período em todo
-- lançamento fora de 'aberto', e o cancelado em aberto não tem nenhum dos
-- dois: o cancelamento era recusado com "violates check constraint" (nunca
-- funcionou, nem pela ficha). O que a regra protege é o envio ao RH; o
-- cancelado em aberto fica de fora dela, como o próprio aberto.

alter table public.absenteismo_lancamentos drop constraint absenteismo_campos_para_confirmar;
alter table public.absenteismo_lancamentos
  add constraint absenteismo_campos_para_confirmar
    check (status in ('aberto', 'cancelado')
           or (absence_type_id is not null and snap_kind is not null
               and start_date is not null and end_date is not null));
