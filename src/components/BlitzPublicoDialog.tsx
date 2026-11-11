"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { DetailModal } from "@/components/ui/DetailModal";
import { Badge } from "@/components/ui/Badge";
import { PeoplePicker, type Person } from "@/components/PeoplePicker";
import { salvarPublicoBlitz } from "@/lib/actions/seguranca";
import { normalizar, shortName } from "@/lib/format";
import type { BlitzPublicoConfig } from "@/lib/blitz-aderencia";

/**
 * Quem passa pela blitz (LUIZ, 11/11/2026): todo ativo, menos as funções que
 * entram por outro portão com veículo da empresa. A exceção por pessoa resolve
 * quem foge da regra da própria função, nos dois sentidos.
 */
export function BlitzPublicoDialog({
  config, pessoas, onClose, onSalvo,
}: {
  config: BlitzPublicoConfig;
  pessoas: Person[];
  onClose: () => void;
  onSalvo: () => void;
}) {
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

  const alternar = (id: string) => setFora((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
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
      onSalvo();
    });
  };

  return (
    <DetailModal
      open
      onClose={() => { if (!salvando) onClose(); }}
      title="Público da blitz"
      width="md"
      footer={
        <>
          <span />
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn btn-ghost" disabled={salvando} onClick={onClose}>Cancelar</button>
            <button type="button" className="btn btn-primary" disabled={salvando} onClick={salvar}>
              {salvando ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
        <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>
          Todo colaborador ativo passa pela blitz, menos as funções marcadas abaixo e as exceções por pessoa.
          Quem fica de férias ou afastado o mês inteiro sai da conta daquele mês automaticamente.
        </p>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.4rem" }}>
            <label className="label" style={{ marginBottom: 0 }}>Funções que não passam pela blitz</label>
            <span className="soft" style={{ fontSize: "0.76rem" }}>
              {fora.size} {fora.size === 1 ? "função" : "funções"}, {pessoasFora} {pessoasFora === 1 ? "pessoa" : "pessoas"} hoje
            </span>
          </div>
          <input className="input" placeholder="Buscar função…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <div style={{ maxHeight: 260, overflowY: "auto", marginTop: "0.5rem", border: "1px solid var(--border)", borderRadius: 8 }}>
            {funcoes.length === 0 ? (
              <p className="soft" style={{ fontSize: "0.82rem", margin: 0, padding: "0.7rem" }}>Nenhuma função com esse nome.</p>
            ) : funcoes.map((f) => (
              <label
                key={f.id}
                style={{ display: "flex", alignItems: "center", gap: "0.55rem", padding: "0.45rem 0.7rem", borderBottom: "1px solid var(--border)", cursor: "pointer", fontSize: "0.85rem" }}
              >
                <input type="checkbox" checked={fora.has(f.id)} onChange={() => alternar(f.id)} />
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
          {excecoes.length > 0 && (
            <div style={{ marginTop: "0.6rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              {excecoes.map((x) => (
                <div key={x.userId} style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.85rem" }}>
                  <span style={{ flex: 1, fontWeight: 600 }}>{shortName(x.nome)}</span>
                  <Badge variant="quiet" tone={x.participa ? "green" : "gray"}>{x.participa ? "Participa" : "Não participa"}</Badge>
                  <button type="button" className="icon-btn" title="Remover exceção" aria-label="Remover exceção"
                    onClick={() => setExcecoes((xs) => xs.filter((y) => y.userId !== x.userId))}>
                    <Trash2 size={14} />
                  </button>
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
      </div>
    </DetailModal>
  );
}
