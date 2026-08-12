-- Backfill: quem nunca escolheu a própria senha passa a ser cobrado no acesso
-- seguinte.
--
-- Medição do dia: de 988 contas, 985 ainda respondem à senha padrão da
-- importação em lote e 976 nunca fizeram login. Na prática, a base inteira está
-- com a mesma senha, e é isso que permite um colaborador entrar na conta de
-- outro.
--
-- Critério: senha padrão conhecida OU nunca logou. A união é a definição exata
-- de "senha definida por terceiro": ou a senha ainda é a que a administração
-- distribuiu, ou a pessoa nunca chegou a exercer escolha nenhuma sobre ela.
-- Marcar TODOS pegaria também quem já definiu senha forte por conta própria, e
-- marcar só a senha padrão deixaria de fora quem o admin cadastrou digitando
-- outra senha à mão.
--
-- Super admin entra igual: se estiver com a senha padrão, é o alvo mais valioso
-- do banco. Ninguém é deslogado; quem estiver com sessão aberta é levado à tela
-- de troca na navegação seguinte, pela leitura autoritativa do layout.

-- O crypt faz uma verificação bcrypt POR LINHA, e o custo depende do fator de
-- trabalho de cada hash. Com 988 contas isso passa do timeout padrão.
set local statement_timeout = '10min';

do $do$
declare
  v_lote int;
  v_total int := 0;
begin
  loop
    with alvo as (
      select u.id
        from auth.users u
       where u.deleted_at is null
         and coalesce((u.raw_app_meta_data ->> 'must_change_password')::boolean, false) = false
         and (u.encrypted_password = extensions.crypt('Mudar@123', u.encrypted_password)
              or u.last_sign_in_at is null)
       limit 100
    )
    update auth.users u
       set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
                               || jsonb_build_object('must_change_password', true),
           updated_at = now()
      from alvo
     where u.id = alvo.id;

    get diagnostics v_lote = row_count;
    v_total := v_total + v_lote;
    exit when v_lote = 0;
  end loop;

  raise notice 'contas marcadas para trocar a senha: %', v_total;
end
$do$;

-- Reversão de emergência, se o gate travar o acesso em produção (guardada aqui
-- como registro, não como parte da migração):
--   update auth.users set raw_app_meta_data = raw_app_meta_data - 'must_change_password'
--    where raw_app_meta_data ? 'must_change_password';
