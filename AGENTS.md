<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Banco: toda função SECURITY DEFINER sai do alcance da chave pública

Uma função `SECURITY DEFINER` roda com os privilégios do dono, então **a RLS não se
aplica por dentro dela**. A única proteção é a guarda escrita no corpo, e o Postgres
concede `EXECUTE` ao `PUBLIC` por padrão em toda função nova. Sem o revoke, um erro
numa guarda vira exposição anônima, sem segunda camada.

Toda migração que criar ou substituir uma função `SECURITY DEFINER` em `public`
termina com:

```sql
revoke execute on function public.<nome>(<tipos dos argumentos>) from public, anon;
```

Se a função também não deve ser chamada direto pelo app (helper interno, chamado só
por outra função ou pelo cron), inclua `authenticated` no revoke. Chamada interna não
precisa de grant: a verificação ocorre sob o dono.

Duas regras que vêm junto:

- Toda função `SECURITY DEFINER` precisa de `set search_path to 'public'`.
- Toda função exposta ao app precisa de uma guarda real no corpo (`is_tenant_member`,
  `has_tenant_role`, `is_super_admin` ou equivalente). Não confie no revoke sozinho.

Antes de considerar uma migração pronta, rode esta verificação. O esperado é `0`:

```sql
select count(*) from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE');
```

Exceção conhecida: nenhuma. `email_by_cpf` era a única RPC usada antes do login e
passou a ser resolvida com service role dentro do servidor
(`src/lib/actions/auth.ts`).
