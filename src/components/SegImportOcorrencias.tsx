"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { loadXlsx } from "@/lib/xlsx-lazy";
import { useLeituraDePlanilha, AvisoLendoPlanilha } from "@/components/ui/LeituraDePlanilha";
import { importarOcorrencias, type LinhaImportOcorrencia } from "@/lib/actions/seguranca";

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/**
 * Importação das ocorrências por planilha.
 *
 * A lista real de uma distribuidora passa de trinta itens, cada um com seus
 * vínculos. Cadastrar isso na mão, um por um, é o tipo de trabalho que faz o
 * cliente desistir do módulo antes de usá-lo.
 *
 * Vínculo casa por NOME, separado por ponto e vírgula, porque quem digita a
 * planilha não tem os ids. O que não casar vira AVISO na tela e não cadastro
 * novo: catálogo criado por erro de digitação é pior que catálogo faltando.
 */
export function SegImportOcorrencias({ onClose }: { onClose: () => void }) {
  const { lendo, ler } = useLeituraDePlanilha();
  const [linhas, setLinhas] = useState<LinhaImportOcorrencia[]>([]);
  const [arquivo, setArquivo] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);
  const router = useRouter();

  const baixarModelo = async () => {
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Ocorrência", "Classificações", "Locais", "Áreas", "Descrição"],
      ["Pallet quebrado", "Condição insegura", "Armazém", "", "Pallet trincado ou lascado em uso"],
      ["Pista esburacada", "Condição insegura", "Caminhão; Externo", "", ""],
      ["Utilização de EPI", "Comportamento seguro", "", "", "Reconhecimento de uso correto"],
    ]);
    ws["!cols"] = [{ wch: 34 }, { wch: 30 }, { wch: 26 }, { wch: 26 }, { wch: 44 }];
    const wsI = XLSX.utils.aoa_to_sheet([
      ["Coluna", "Como preencher"],
      ["Ocorrência", "Nome do fato padronizado. Se já existir, a linha ATUALIZA o cadastro em vez de duplicar."],
      ["Classificações", "Em que tipos de relato ela aparece, separados por ponto e vírgula. VAZIO = aparece em todas."],
      ["Locais", "Em que locais ela aparece, separados por ponto e vírgula. VAZIO = aparece em todos."],
      ["Áreas", "Em que áreas ela aparece, separadas por ponto e vírgula. VAZIO = aparece em todas."],
      ["Descrição", "Opcional. Aparece como ajuda no formulário."],
      ["", ""],
      ["Importante", "Classificação, local e área precisam existir antes, com o mesmo nome. O que não for encontrado é ignorado e aparece na lista de avisos."],
    ]);
    wsI["!cols"] = [{ wch: 20 }, { wch: 96 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ocorrências");
    XLSX.utils.book_append_sheet(wb, wsI, "Instruções");
    XLSX.writeFile(wb, "modelo_ocorrencias_seguranca.xlsx");
  };

  const lerArquivo = async (file: File) => {
    setErro(""); setAvisos([]);
    const XLSX = await loadXlsx();
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, blankrows: false });
      if (aoa.length < 2) { setErro("Planilha vazia."); return; }

      const cab = (aoa[0] as unknown[]).map((h) => norm(String(h ?? "")));
      const achar = (...chaves: string[]) => cab.findIndex((h) => chaves.some((k) => h.includes(k)));
      const iNome = achar("ocorrencia", "nome");
      const iTipos = achar("classifica", "tipo");
      const iLocais = achar("local");
      const iAreas = achar("area");
      const iDesc = achar("descric");
      if (iNome === -1) { setErro('A planilha precisa de uma coluna "Ocorrência".'); return; }

      const txt = (r: unknown[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
      const lidas: LinhaImportOcorrencia[] = [];
      for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i] as unknown[];
        const nome = txt(r, iNome);
        if (!nome) continue;
        lidas.push({
          nome,
          classificacoes: txt(r, iTipos),
          locais: txt(r, iLocais),
          areas: txt(r, iAreas),
          descricao: txt(r, iDesc),
        });
      }
      if (lidas.length === 0) { setErro("Nenhuma linha com ocorrência preenchida."); return; }
      setLinhas(lidas);
      setArquivo(file.name);
    } catch {
      setErro("Não foi possível ler o arquivo. Ele precisa ser .xlsx ou .csv.");
    }
  };

  const importar = () => {
    setEnviando(true);
    void (async () => {
      const r = await importarOcorrencias(linhas);
      setEnviando(false);
      if (r.error) { setErro(r.error); return; }
      setAvisos(r.avisos ?? []);
      toast.success(r.message ?? "Importação concluída.");
      router.refresh();
      // com avisos a janela fica aberta: eles são o resultado que importa ler
      if (!r.avisos?.length) onClose();
    })();
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "6vh 1rem", zIndex: 60, overflowY: "auto",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 620, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>Importar ocorrências</h2>
          <button
            type="button" onClick={onClose} className="muted" aria-label="Fechar"
            style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "1.15rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>
            Uma linha por ocorrência. Os vínculos vão por nome, separados por ponto e vírgula,
            e coluna vazia significa que a ocorrência aparece em tudo.
          </p>

          <div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={baixarModelo}>
              Baixar modelo com instruções
            </button>
          </div>

          <div>
            <label className="label">Planilha</label>
            <input
              className="input" type="file" accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void ler(() => lerArquivo(f));
              }}
            />
            <AvisoLendoPlanilha lendo={lendo} />
            {arquivo && (
              <p className="soft" style={{ fontSize: "0.8rem", margin: "0.4rem 0 0" }}>
                {arquivo}: {linhas.length} ocorrência(s) prontas para importar.
              </p>
            )}
          </div>

          {erro && (
            <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
              {erro}
            </p>
          )}

          {avisos.length > 0 && (
            <div>
              <h3 style={{ fontSize: "0.85rem", fontWeight: 700, margin: "0 0 0.3rem" }}>
                Avisos ({avisos.length})
              </h3>
              <ul className="soft" style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.78rem", maxHeight: 180, overflowY: "auto" }}>
                {avisos.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
          <button
            type="button" className="btn btn-primary"
            disabled={enviando || linhas.length === 0} onClick={importar}
          >
            {enviando ? "Importando…" : `Importar ${linhas.length || ""}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}
