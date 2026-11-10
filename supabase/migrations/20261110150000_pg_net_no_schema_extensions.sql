-- O `create extension pg_net` da migração do push registrou a extensão no
-- schema public (o advisor de segurança acusa "extension_in_public"). Os
-- objetos dela já moram em `net`; só o registro estava em public. Como a
-- extensão não é relocável, sai e volta no schema `extensions`, o padrão do
-- Supabase. A fila estava vazia, e o trigger `push_disparar` chama
-- `net.http_post` pelo nome na hora do uso, então nada depende do objeto antigo.
drop extension if exists pg_net;
create extension pg_net with schema extensions;
