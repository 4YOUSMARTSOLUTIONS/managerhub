-- Férias sai do catálogo de tipos de absenteísmo.
--
-- O seed da 20260815100000 criou uma linha para cada valor de `absence_kind`, e
-- isso foi erro de origem: o catálogo não é a lista de tudo que tira alguém do
-- trabalho, é a lista do que um NÃO COMPARECIMENTO pode vir a ser.
--
-- Férias não cabe nessa lista por três motivos, e qualquer um deles bastaria:
--
-- 1. Férias é programada. Ela é lançada com antecedência em Configurações ›
--    Colaboradores › Férias e afastamentos, que é a tela específica para isso.
--    Ninguém descobre no dia que a pessoa "estava de férias" e precisa criar o
--    período naquele momento.
-- 2. A própria linha nascia com `counts_as_absenteeism = false`, ou seja, o
--    catálogo de absenteísmo oferecia uma opção que não é absenteísmo.
-- 3. Aprovar um lançamento como férias esbarraria em
--    `employee_absences_sem_sobreposicao`, porque o período já estaria lançado
--    pela outra tela. O gestor receberia um erro de sobreposição sem entender
--    que o caminho certo era outro.
--
-- Quando o não comparecimento se revelar férias esquecidas na escala, o caminho
-- é cancelar o lançamento com essa nota. O período continua sendo o que a tela
-- de Férias registrou, e nada é duplicado.
--
-- O valor `ferias` CONTINUA no enum e continua disponível como "comportamento"
-- ao cadastrar um tipo: quem tiver um caso de negócio para isso decide por
-- conta, com o nome que quiser. O que sai é só a linha semeada por engano.
delete from public.absence_types t
 where t.kind = 'ferias'
   and not exists (
     select 1 from public.absenteismo_lancamentos l where l.absence_type_id = t.id
   );
