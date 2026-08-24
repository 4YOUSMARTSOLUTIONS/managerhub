<!-- BEGIN:nextjs-agent-rules -->
# UI: as regras visuais moram em DESIGN.md

Antes de criar tela, tabela, badge ou modal, leia `DESIGN.md`. Em especial: cor
é só para status que pede ação (uma pílula tintada por linha; taxonomia usa
`<Badge variant="quiet">`), e painel de detalhe usa as primitivas `DetailModal`
+ `Field`/`FieldGrid`/`DetailSection` em vez de overlay copiado à mão.

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

# Dado pessoal: RLS não tem granularidade de coluna

A RLS decide **linhas**, nunca colunas. A policy `profiles_self_select` libera a
linha do colega para todo mundo da mesma empresa, e com a linha vinha `cpf`,
`phone` e `birth_date`. Como a `NEXT_PUBLIC_SUPABASE_ANON_KEY` está no bundle do
navegador, qualquer funcionário lia a base inteira chamando o PostgREST direto.
Esconder na tela não esconde nada.

Coluna sensível se protege com **privilégio de coluna**, e aí vem a armadilha:

> `revoke select (cpf) on profiles from authenticated` **não faz efeito** enquanto
> existir o grant de `SELECT` em nível de **tabela**. E ele existe por padrão: o
> ACL padrão do Supabase concede tudo a `anon` e `authenticated` em toda tabela
> nova de `public`.

O jeito certo é derrubar e devolver:

```sql
revoke select on table public.profiles from anon, authenticated;
grant select (id, full_name, email, avatar_url, created_at, updated_at)
  on table public.profiles to authenticated;
```

Quem pode ler o resto lê por RPC `SECURITY DEFINER` com guarda no corpo
(`meu_perfil_pessoal`, `tenant_dados_pessoais`). Funções `SECURITY DEFINER` de
`postgres` não são afetadas pelo revoke: dentro delas o usuário efetivo é o dono.
Isso vale inclusive para `WHERE cpf = ...` e para o `RETURNING`, que exigem
`SELECT` na coluna.

Duas consequências que vêm junto:

- O mesmo raciocínio vale para **escrita**. `authenticated` tinha `UPDATE` de
  tabela, então dava para reescrever o próprio CPF pelo PostgREST, contornando o
  `admin_update_employee`. Hoje o grant é só `update (full_name, avatar_url)`.
- `src/types/database.ts` é mantido à mão e **descreve o privilégio, não só o
  schema**: `cpf`, `phone`, `birth_date` e `gender` estão fora do `Row` de
  `profiles` de propósito, para um `.select("cpf")` futuro quebrar na compilação
  em vez de virar `42501` em produção. Não recoloque.

Tabela nova em `public` que não deva ser alcançada pela chave pública precisa de
`revoke all ... from public, anon, authenticated` explícito, além da RLS. Ligar
RLS sem policy não basta se o grant de tabela estiver lá.
