-- Perfil "Gestor": lidera uma equipe e enxerga os dados dela, sem os poderes de
-- empresa inteira que o "Gerencial" (manager) tem.
--
-- Valor em ingles como os outros (owner/admin/manager/member), rotulado "Gestor"
-- na UI. Chamar de 'gestor' no enum deixaria dois valores indistinguiveis para
-- quem le o SQL, ja que 'manager' tambem quer dizer gestor em portugues.
--
-- Esta migracao vai SOZINHA de proposito: o valor novo de um enum nao pode ser
-- USADO na mesma transacao em que e criado, e o apply_migration envolve tudo numa.
alter type public.member_role add value 'team_lead' before 'member';
