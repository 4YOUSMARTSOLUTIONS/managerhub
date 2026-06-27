# MANAGERHUB

Portal SaaS de gestão corporativa — multi-empresa (multi-tenant) com Next.js + Supabase.

## Módulos

| Módulo | Rota | Descrição |
|--------|------|-----------|
| Dashboard | `/dashboard` | KPIs e resumos consolidados de todo o sistema |
| Salas | `/salas` | Cadastro de salas de reunião e disponibilidade |
| Reuniões | `/reunioes` | Agendamento com trava anti-conflito de sala |
| Ações | `/acoes` | Itens de ação das reuniões (prazo, responsável, status) |
| Chamados | `/chamados` | Solicitações de TI / Serviços Gerais (com SLA e código CH-0001) |
| Metas | `/metas` | Objetivos do time com progresso e histórico |
| Equipe | `/equipe` | Membros e papéis (owner/admin/manager/member) |
| Auditoria | `/auditoria` | Log automático de todas as alterações |

## Stack

- **Frontend:** Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4
- **Backend:** Supabase (Postgres 17, Auth, Row Level Security)
- **Multi-tenant:** isolamento por empresa via RLS (`memberships` + helpers `is_tenant_member` / `has_tenant_role`)
- **Auditoria:** trigger genérico (`audit_trigger`) em todas as tabelas de negócio

## Como rodar

```bash
npm install
npm run dev
# http://localhost:3000
```

As variáveis já estão em `.env.local` (URL + chave pública do Supabase).

## Acesso de demonstração

Já existe um usuário admin confirmado e uma **Empresa Demo** com dados de exemplo:

- **E-mail:** `admin@managerhub.app`
- **Senha:** `managerhub123`

## Estrutura

```
src/
  app/
    (app)/            # área autenticada (sidebar + topbar)
      dashboard/  salas/  reunioes/  acoes/  chamados/  metas/  equipe/  auditoria/
    login/  signup/  onboarding/
  components/         # UI reutilizável (Badge, FormModal, Sidebar, ...)
  lib/
    supabase/         # clients (browser/server) + sessão
    actions/          # Server Actions por módulo
    constants.ts      # rótulos PT-BR dos enums
    format.ts  tenant.ts
  types/database.ts   # tipos gerados do schema
  proxy.ts            # middleware de sessão/proteção de rotas
```

## Banco de dados

7 migrações aplicadas no projeto Supabase `MANAGERHUB`:

1. `01_core_tenancy_and_auth` — tenants, profiles, memberships, RLS base
2. `02_rooms_and_meetings` — salas e reuniões (exclusion constraint anti-overlap)
3. `03_actions_and_tickets` — ações e chamados (código sequencial)
4. `04_goals` — metas + histórico de progresso
5. `05_audit_logs` — log de auditoria automático
6. `06_rpc_onboarding_and_dashboard` — RPCs de onboarding e KPIs
7. `07_security_hardening` — search_path e revogação de execução

## Notas / próximos passos

- **Confirmação de e-mail:** para cadastros novos via `/signup`, desative
  *Authentication → Providers → Email → Confirm email* no painel do Supabase,
  ou o usuário precisará confirmar o e-mail antes de entrar.
- **Convite de membros:** hoje a equipe é gerenciada pelo painel; um fluxo de
  convite por e-mail é um bom próximo incremento.
