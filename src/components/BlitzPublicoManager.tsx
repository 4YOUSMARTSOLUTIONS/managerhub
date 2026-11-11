"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { PeoplePicker, type Person } from "@/components/PeoplePicker";
import { salvarPublicoBlitz } from "@/lib/actions/seguranca";
import { normalizar, shortName } from "@/lib/format";
import type { BlitzPublicoConfig } from "@/lib/blitz-aderencia";

/**
 * Quem passa pela blitz (LUIZ, 11/11/2026): todo ativo, menos as funções que
 * entram por outro portão com veículo da empresa. A exceção por pessoa resolve
 * quem foge da regra da própria função, nos dois sentidos.
 *
 * Mora em Configurações > Segurança, junto do resto do cadastro da blitz:
 * owner/admin gravam (a RLS também só deixa eles), o Gerencial lê.
 */
export function BlitzPublicoManager({
  config, pessoas, canEdit,
}: {
  config: BlitzPublicoConfig;
  pessoas: Person[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [salvando, iniciar] = useTransition();
  const [fora, setFora] = useState(() => new Set(config.funcoesFora));
  const [excecoes, setExcecoes] = useState(config.excecoes);
  const [busca, setBusca] = useState("");
  const [novaPessoa, setNovaPessoa] = useState("");
  const [novaParticipa, setNovaParticipa] = useState(false);
  const [erro, setErro] = useState("");

  const termo = normalizar(busca.trim());
  const funcoes = useMemo(
    () => config.funcoes.filter((f) => !termo || normalizar(f.name).includes(termo)),
    [config.funcoes, termo],
  );
  const pessoasFora = config.funcoes.filter((f) => fora.has(f.id)).reduce((n, f) => n + f.pessoas, 0);
  const visiveisMarcadas = funcoes.filter((f) => fora.has(f.id)).length;

  const mudou = useMemo(() => {
    const antes = new Set(config.funcoesFora);
    if (antes.size !== fora.size || [...fora].some((id) => !antes.has(id))) return true;
    if (excecoes.length !== config.excecoes.length) return true;
    return excecoes.some((x) => config.excecoes.find((y) => y.userId === x.userId)?.participa !== x.participa);
  }, [fora, excecoes, config]);

  const alternar = (id: string) => setFora((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  // vale para a lista em vista: busque "MOTORISTA" e marque todas de uma vez
  const marcarVisiveis = (marcar: boolean) => setFora((s) => {
    const n = new Set(s);
    for (const f of funcoes) { if (marcar) n.add(f.id); else n.delete(f.id); }
    return n;
  });

  const adicionar = () => {
    if (!novaPessoa) return;
    const nome = pessoas.find((p) => p.id === novaPessoa)?.name ?? "—";
    setExcecoes((xs) => [...xs.filter((x) => x.userId !== novaPessoa), { userId: novaPessoa, nome, participa: novaParticipa }]
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
    setNovaPessoa("");
  };

  const salvar = () => {
    setErro("");
    iniciar(async () => {
      const r = await salvarPublicoBlitz({
        funcoesFora: [...fora],
        excecoes: excecoes.map((x) => ({ userId: x.userId, participa: x.participa })),
      });
      if (r.error) { setErro(r.error); return; }
      toast.success(r.message ?? "Público da blitz atualizado.");
      router.refresh();
    });
  };

  const descartar = () => { setFora(new Set(config.funcoesFora)); setExcecoes(config.excecoes); setErro(""); };

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "1.2rem", maxWidth: 760 }}>
      <div>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Público da blitz</h3>
        <p className="soft" style={{ fontSize: "0.82rem", margin: "0.25rem 0 0" }}>
          Todo colaborador ativo passa pela blitz, menos as funções marcadas abaixo e as exceções por pessoa.
          Quem fica de férias ou afastado o mês inteiro sai da conta daquele mês automaticamente.
          É a base da aderência, em Segurança &gt; Blitz de trajeto &gt; Análises.
        </p>
      </div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.4rem" }}>
          <label className="label" style={{ marginBottom: 0 }}>Funções que não passam pela blitz</label>
          <span className="soft" style={{ fontSize: "0.76rem" }}>
            {fora.size} {fora.size === 1 ? "função" : "funções"}, {pessoasFora} {pessoasFora === 1 ? "pessoa" : "pessoas"} hoje
          </span>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <input className="input" placeholder="Buscar função…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ flex: "1 1 220px" }} />
          {canEdit && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" disabled={funcoes.length === 0 || visiveisMarcadas === funcoes.length}
                onClick={() => marcarVisiveis(true)}>
                {termo ? `Marcar as ${funcoes.length} da busca` : "Marcar todas"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={visiveisMarcadas === 0}
                onClick={() => marcarVisiveis(false)}>
                {termo ? "Desmarcar as da busca" : "Desmarcar todas"}
              </button>
            </>
          )}
        </div>
        <div style={{ maxHeight: 340, overflowY: "auto", marginTop: "0.5rem", border: "1px solid var(--border)", borderRadius: 8 }}>
          {funcoes.length === 0 ? (
            <p className="soft" style={{ fontSize: "0.82rem", margin: 0, padding: "0.7rem" }}>Nenhuma função com esse nome.</p>
          ) : funcoes.map((f) => (
            <label
              key={f.id}
              style={{ display: "flex", alignItems: "center", gap: "0.55rem", padding: "0.45rem 0.7rem", borderBottom: "1px solid var(--border)", cursor: canEdit ? "pointer" : "default", fontSize: "0.85rem" }}
            >
              <input type="checkbox" checked={fora.has(f.id)} disabled={!canEdit} onChange={() => alternar(f.id)} />
              <span style={{ flex: 1 }}>{f.name}</span>
              <span className="soft" style={{ fontSize: "0.76rem" }}>{f.pessoas} {f.pessoas === 1 ? "pessoa" : "pessoas"}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="label">Exceções por pessoa</label>
        <p className="soft" style={{ fontSize: "0.78rem", margin: "0 0 0.5rem" }}>
          Para quem foge da regra da própria função: alguém de uma função de fora que entra pelo portão da blitz, ou o contrário.
        </p>
        {canEdit && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ flex: "1 1 240px", minWidth: 0 }}>
              <PeoplePicker people={pessoas} selected={novaPessoa ? [novaPessoa] : []} onChange={(ids) => setNovaPessoa(ids[0] ?? "")} single placeholder="Nome ou matrícula…" />
            </div>
            <select className="select" value={novaParticipa ? "sim" : "nao"} onChange={(e) => setNovaParticipa(e.target.value === "sim")} style={{ width: "auto" }}>
              <option value="nao">Não participa</option>
              <option value="sim">Participa</option>
            </select>
            <button type="button" className="btn btn-ghost" disabled={!novaPessoa} onClick={adicionar}>Adicionar</button>
          </div>
        )}
        {excecoes.length === 0 ? (
          <p className="soft" style={{ fontSize: "0.8rem", margin: "0.5rem 0 0" }}>Nenhuma exceção.</p>
        ) : (
          <div style={{ marginTop: "0.6rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            {excecoes.map((x) => (
              <div key={x.userId} style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.85rem" }}>
                <span style={{ flex: 1, fontWeight: 600 }}>{shortName(x.nome)}</span>
                <Badge variant="quiet" tone={x.participa ? "green" : "gray"}>{x.participa ? "Participa" : "Não participa"}</Badge>
                {canEdit && (
                  <button type="button" className="icon-btn" title="Remover exceção" aria-label="Remover exceção"
                    onClick={() => setExcecoes((xs) => xs.filter((y) => y.userId !== x.userId))}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {erro && (
        <p role="alert" style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
          {erro}
        </p>
      )}

      {canEdit && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          {mudou && <span className="soft" style={{ fontSize: "0.78rem", marginRight: "auto" }}>Há mudanças não salvas.</span>}
          <button type="button" className="btn btn-ghost" disabled={salvando || !mudou} onClick={descartar}>Descartar</button>
          <button type="button" className="btn btn-primary" disabled={salvando || !mudou} onClick={salvar}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      )}
    </div>
  );
}
