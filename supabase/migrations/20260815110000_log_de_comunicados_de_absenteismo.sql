-- O registro de cada comunicado disparado.
--
-- Não existe fila, retry nem retorno de bounce no projeto: uma indisponibilidade
-- do provedor significa comunicado não entregue, e sem registro ninguém
-- descobre. Esta tabela é a única memória do que foi tentado, para quem, quando
-- e com que erro; o botão de reenviar é a recuperação.
--
-- Sem policy de insert: quem grava é o service client do disparador, que roda no
-- servidor depois de a action já ter conferido a sessão. A leitura acompanha a
-- do lançamento, para a tela mostrar "enviado para 3 destinatários" e "falhou:
-- 401 do provedor" a quem já pode ver o caso.
create table public.absenteismo_emails (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lancamento_id uuid not null
    references public.absenteismo_lancamentos(id) on delete cascade,
  event text not null
    check (event in ('aberto', 'confirmado', 'aprovado', 'reprovado', 'reenvio')),
  to_emails text[] not null default '{}',
  status text not null check (status in ('sent', 'failed', 'skipped')),
  error text,
  sent_by uuid references public.profiles(id) on delete set null,
  sent_at timestamptz not null default now()
);

create index absenteismo_emails_lanc_idx
  on public.absenteismo_emails (lancamento_id, sent_at desc);

alter table public.absenteismo_emails enable row level security;

create policy absenteismo_emails_select on public.absenteismo_emails
  for select using (exists (
    select 1 from public.absenteismo_lancamentos l
     where l.id = lancamento_id
       and public.pode_ver_absenteismo(l.tenant_id, l.user_id, l.created_by)));

revoke all on table public.absenteismo_emails from public, anon;

notify pgrst, 'reload schema';
