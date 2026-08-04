-- Throttle de autenticacao.
--
-- O rate limit por IP do GoTrue e inutil aqui: o signInWithPassword sai do
-- SERVIDOR (funcao Vercel em gru1), entao o que ele ve e sempre um IP da Vercel,
-- nunca o do atacante. O limite precisa ser da aplicacao, com o IP real vindo dos
-- headers, e o contador precisa ser compartilhado entre instancias serverless.
-- Sem Redis no projeto: mora aqui.
--
-- Conta-se FALHA, nunca tentativa. E isso que permite um limite por IP que nao
-- atrapalha ~1000 funcionarios saindo pelo MESMO IP corporativo: uma manha normal
-- de trabalho e feita de acertos, e acerto nao conta.

create table if not exists public.auth_throttle (
  bucket          text        not null,
  chave           text        not null,
  janela_ini      timestamptz not null default now(),
  falhas          integer     not null default 0,
  strikes         integer     not null default 0,
  bloqueado_ate   timestamptz,
  ultimo_bloqueio timestamptz,
  atualizado_em   timestamptz not null default now(),
  primary key (bucket, chave),
  constraint auth_throttle_bucket_ck
    check (bucket in ('login_ip', 'login_id', 'senha_usuario')),
  constraint auth_throttle_chave_ck check (length(chave) between 1 and 128)
);

comment on table public.auth_throttle is
  'Contador de falhas de autenticacao, uma linha por (bucket, chave). NUNCA guarda '
  'identificador em claro: a chave do bucket login_id e um HMAC-SHA256 calculado no '
  'servidor. Alcancavel apenas por service role, pelas RPCs auth_throttle_*.';

-- RLS ligada e SEM policy: nenhuma sessao alcanca a tabela pelo PostgREST.
alter table public.auth_throttle enable row level security;

-- O default ACL do projeto concede tudo a anon/authenticated em TODA tabela nova
-- em public. Sem este revoke a tabela nasceria gravavel pela chave publica.
revoke all on table public.auth_throttle from public, anon, authenticated;

create index if not exists idx_auth_throttle_purga on public.auth_throttle (atualizado_em);

-- ---------------------------------------------------------------------------
-- auth_throttle_check: o portao, chamado ANTES de tocar na senha.
-- ---------------------------------------------------------------------------
create or replace function public.auth_throttle_check(p_chaves jsonb)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare r jsonb; v_espera integer := 0;
begin
  -- Guarda real no corpo. Nao existe guarda por auth.uid(): o login acontece ANTES
  -- de existir sessao. A guarda e o papel do chamador, que so pode ser o service
  -- role (dentro do servidor Next). session_user cobre o acesso por psql/SQL editor.
  if coalesce(auth.role(), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Sem permissão';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_chaves, '[]'::jsonb)) loop
    v_espera := greatest(v_espera, coalesce((
      select ceil(extract(epoch from (t.bloqueado_ate - now())))::int
        from public.auth_throttle t
       where t.bucket = r->>'bucket' and t.chave = r->>'chave'
         and t.bloqueado_ate is not null and t.bloqueado_ate > now()
    ), 0));
  end loop;

  return jsonb_build_object('bloqueado', v_espera > 0, 'espera_segundos', v_espera);
end;
$function$;

-- ---------------------------------------------------------------------------
-- auth_throttle_falha: registra a falha e aplica o bloqueio progressivo.
-- ---------------------------------------------------------------------------
create or replace function public.auth_throttle_falha(p_chaves jsonb)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  r jsonb; v_bucket text; v_chave text;
  v_limite integer; v_janela interval;
  v_falhas integer; v_strikes integer;
  v_bloqueio interval; v_ate timestamptz; v_espera integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Sem permissão';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_chaves, '[]'::jsonb)) loop
    v_bucket := r->>'bucket';
    v_chave  := left(coalesce(r->>'chave', ''), 128);
    continue when v_chave = '';

    -- A politica fica AQUI, nao em parametro: o app nao pode ser induzido a pedir
    -- um limite frouxo.
    --   login_ip = 50: ~1000 funcionarios pelo mesmo IP corporativo. Pico de ~250
    --   logins/15min com 12% de erro de digitacao (pessimista) da ~30 falhas.
    --   50 e ~1,7x de folga. Quem barra brute force de verdade e o login_id.
    --   login_id = 8: humano que esqueceu a senha tenta 3-5x. Atacante fica com 32
    --   chutes/hora POR CONTA, e como a chave e o identificador, botnet
    --   distribuida nao evade.
    --   senha_usuario = 5: e um dialogo de reconfirmacao. Chave presa a sessao.
    select p.l, p.j into v_limite, v_janela from (values
      ('login_ip',      50, interval '15 minutes'),
      ('login_id',       8, interval '15 minutes'),
      ('senha_usuario',  5, interval '15 minutes')
    ) as p(b, l, j) where p.b = v_bucket;
    if v_limite is null then raise exception 'bucket desconhecido: %', v_bucket; end if;

    insert into public.auth_throttle as t
      (bucket, chave, janela_ini, falhas, strikes, atualizado_em)
    values (v_bucket, v_chave, now(), 1, 0, now())
    on conflict (bucket, chave) do update set
      janela_ini = case when now() - t.janela_ini > v_janela then now() else t.janela_ini end,
      falhas     = case when now() - t.janela_ini > v_janela then 1 else t.falhas + 1 end,
      -- a escada de bloqueio decai: 24h sem bloqueio novo zera os strikes
      strikes    = case when t.ultimo_bloqueio is null
                          or t.ultimo_bloqueio < now() - interval '24 hours'
                        then 0 else t.strikes end,
      atualizado_em = now()
    returning t.falhas, t.strikes into v_falhas, v_strikes;

    if v_falhas >= v_limite then
      v_strikes  := v_strikes + 1;
      v_bloqueio := case
                      when v_strikes <= 1 then interval '1 minute'
                      when v_strikes  = 2 then interval '5 minutes'
                      when v_strikes  = 3 then interval '15 minutes'
                      else interval '60 minutes'
                    end;
      v_ate := now() + v_bloqueio;

      update public.auth_throttle set
        bloqueado_ate   = greatest(coalesce(bloqueado_ate, v_ate), v_ate),
        ultimo_bloqueio = now(),
        strikes         = v_strikes,
        falhas          = 0,          -- o bloqueio substitui a contagem
        janela_ini      = now(),
        atualizado_em   = now()
      where bucket = v_bucket and chave = v_chave;

      v_espera := greatest(v_espera, ceil(extract(epoch from v_bloqueio))::int);
    end if;
  end loop;

  return jsonb_build_object('bloqueado', v_espera > 0, 'espera_segundos', v_espera);
end;
$function$;

-- ---------------------------------------------------------------------------
-- auth_throttle_sucesso
-- ---------------------------------------------------------------------------
create or replace function public.auth_throttle_sucesso(p_chaves jsonb)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare r jsonb; v_bucket text; v_chave text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Sem permissão';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_chaves, '[]'::jsonb)) loop
    v_bucket := r->>'bucket';
    v_chave  := left(coalesce(r->>'chave', ''), 128);
    continue when v_chave = '';

    if v_bucket = 'login_ip' then
      -- Sucesso NAO limpa o balde do IP: quem ataca de dentro tem credencial
      -- valida propria e intercalaria um login bom a cada rajada para zerar o
      -- contador. Abate metade e nunca derruba bloqueio ativo.
      update public.auth_throttle
         set falhas = falhas / 2, atualizado_em = now()
       where bucket = v_bucket and chave = v_chave
         and (bloqueado_ate is null or bloqueado_ate <= now());
    else
      -- login_id / senha_usuario: a senha certa prova que quem esta ali e o dono.
      delete from public.auth_throttle where bucket = v_bucket and chave = v_chave;
    end if;
  end loop;
end;
$function$;

-- ---------------------------------------------------------------------------
-- auth_throttle_purga: a tabela nao pode crescer sem fim. Interna (so o cron
-- chama), no mesmo padrao de topup_all_series_bookings.
-- ---------------------------------------------------------------------------
create or replace function public.auth_throttle_purga()
returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_n integer;
begin
  delete from public.auth_throttle
   where atualizado_em < now() - interval '7 days'
     and (bloqueado_ate is null or bloqueado_ate <= now());
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

-- Chamadas SO com service role, entao authenticated tambem sai. A purga e interna.
revoke execute on function public.auth_throttle_check(jsonb)    from public, anon, authenticated;
revoke execute on function public.auth_throttle_falha(jsonb)    from public, anon, authenticated;
revoke execute on function public.auth_throttle_sucesso(jsonb)  from public, anon, authenticated;
revoke execute on function public.auth_throttle_purga()         from public, anon, authenticated;

select cron.schedule('purga-auth-throttle', '17 4 * * *', 'select public.auth_throttle_purga();');
