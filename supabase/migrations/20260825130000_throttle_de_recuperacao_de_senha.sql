-- Baldes próprios para a recuperação de senha.
--
-- Reusar `login_id` seria um buraco de negação de serviço: bastaria pedir
-- recuperação 8 vezes com o CPF de um colega para ele não conseguir mais
-- entrar. O freio da recuperação precisa ser SEU, e não compartilhado com o
-- freio do login.
--
--   reset_ip = 20/15min: a portaria e o escritório saem pelo mesmo IP; 20
--   pedidos em 15 minutos é muito acima do uso legítimo e ainda barra script.
--   reset_id = 3/15min: cada pedido INVALIDA o link anterior (o GoTrue guarda
--   um token de recovery por usuário, `one_time_tokens_user_id_token_type_key`).
--   Limite alto não protegeria ninguém: daria a um incomodador mais chances de
--   matar o link que a vítima acabou de receber. Três cobre o humano que
--   pediu, não achou o e-mail e pediu de novo.

alter table public.auth_throttle drop constraint auth_throttle_bucket_ck;

alter table public.auth_throttle add constraint auth_throttle_bucket_ck
  check (bucket in ('login_ip', 'login_id', 'senha_usuario', 'reset_ip', 'reset_id'));

-- A política de limites mora DENTRO da função (o app não pode pedir um limite
-- frouxo). Remendo a partir do banco, e não reescrita à mão, pelo mesmo motivo
-- da migração 20260811280000: se a função tiver sofrido qualquer ajuste antes,
-- uma reescrita cega o desfaria em silêncio. As checagens abaixo quebram alto.
do $do$
declare
  v_def text;
  c_de constant text := $q$      ('senha_usuario',  5, interval '15 minutes')
    ) as p(b, l, j) where p.b = v_bucket;$q$;
  c_para constant text := $q$      ('senha_usuario',  5, interval '15 minutes'),
      ('reset_ip',      20, interval '15 minutes'),
      ('reset_id',       3, interval '15 minutes')
    ) as p(b, l, j) where p.b = v_bucket;$q$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'auth_throttle_falha';

  if v_def is null then
    raise exception 'auth_throttle_falha não encontrada';
  end if;
  if (length(v_def) - length(replace(v_def, c_de, ''))) / length(c_de) <> 1 then
    raise exception 'auth_throttle_falha: a tabela de política não está exatamente uma vez no corpo';
  end if;

  execute replace(v_def, c_de, c_para);
end
$do$;

-- O `create or replace` acima devolve os privilégios padrão: revogar de novo.
revoke execute on function public.auth_throttle_falha(jsonb) from public, anon, authenticated;

do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_n <> 0 then
    raise exception 'ha % funcoes SECURITY DEFINER alcancaveis por anon', v_n;
  end if;
end $$;

notify pgrst, 'reload schema';
