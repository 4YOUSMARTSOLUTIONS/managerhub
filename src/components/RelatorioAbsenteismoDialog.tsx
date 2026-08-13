"use client";

import { useState, useTransition } from "react";
import { FileSpreadsheet, X } from "lucide-react";
import { downloadSheet } from "@/lib/export-xlsx";
import { gerarRelatorioAbsenteismo } from "@/lib/actions/absenteismos";

/**
 * O relatório de absenteísmo do RH.
 *
 * Ele não usa o `ExportButton` porque as linhas não estão na tela: a planilha
 * junta CPF e dado clínico, que só saem por RPC com guarda de papel. O caminho
 * é o mesmo do resto do sistema a partir daí (`downloadSheet`).
 */
export function RelatorioAbsenteismoDialog({
  unidades,
}: {
  unidades: { id: string; name: string }[];
}) {
  const [aberto, setAberto] = useState(false);
  const [de, setDe] = useState(inicioDoMes);
  const [ate, setAte] = useState(hoje);
  const [unidade, setUnidade] = useState("");
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();

  const gerar = () => {
    setErro("");
    iniciar(async () => {
      const r = await gerarRelatorioAbsenteismo(de, ate, unidade ? [unidade] : undefined);
      if (r.error || !r.headers || !r.rows) { setErro(r.error ?? "Não foi possível gerar."); return; }
      if (r.rows.length === 0) { setErro("Nenhum lançamento no período escolhido."); return; }
      await downloadSheet(`absenteismo_${de}_a_${ate}.xlsx`, "Absenteísmo", r.headers, r.rows);
      setAberto(false);
    });
  };

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setErro(""); setAberto(true); }}>
        <FileSpreadsheet size={15} /> Relatório completo
      </button>

      {aberto && (
        <Dialogo titulo="Relatório de absenteísmo" onFechar={() => setAberto(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
              A planilha traz o lançamento inteiro, com CPF, CID e dados do atestado, para a folha e
              o eSocial. Ela sai do sistema: guarde em pasta com acesso restrito.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.8rem" }}>
              <div>
                <label className="label">De <span style={{ color: "var(--mh-danger)" }}>*</span></label>
                <input type="date" className="input" value={de} onChange={(e) => setDe(e.target.value)} />
              </div>
              <div>
                <label className="label">Até <span style={{ color: "var(--mh-danger)" }}>*</span></label>
                <input type="date" className="input" value={ate} onChange={(e) => setAte(e.target.value)} />
              </div>
              {unidades.length > 1 && (
                <div>
                  <label className="label">Unidade</label>
                  <select className="select" value={unidade} onChange={(e) => setUnidade(e.target.value)}>
                    <option value="">Todas as unidades</option>
                    {unidades.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>}

            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={pendente} onClick={gerar}>
                {pendente ? "Gerando…" : "Baixar planilha"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAberto(false)}>Fechar</button>
            </div>
          </div>
        </Dialogo>
      )}
    </>
  );
}

/** Mesmo desenho do diálogo do módulo: fecha só pelo X ou pelo Fechar. */
function Dialogo({ titulo, children, onFechar }: { titulo: string; children: React.ReactNode; onFechar: () => void }) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "4vh 1rem", zIndex: 50, overflowY: "auto",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 560, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>{titulo}</h2>
          <button type="button" onClick={onFechar} className="muted" aria-label="Fechar"
            style={{ background: "none", border: "none", cursor: "pointer", lineHeight: 1, display: "flex" }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: "1.25rem" }}>{children}</div>
      </div>
    </div>
  );
}

/** Datas do NAVEGADOR: no servidor, em UTC, o dia vira o seguinte às 21h. */
function hoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function inicioDoMes(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
