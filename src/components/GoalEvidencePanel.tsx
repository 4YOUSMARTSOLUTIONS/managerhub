"use client";

import { useRef, useState, useTransition } from "react";
import { Paperclip, Download, Trash2 } from "lucide-react";
import { uploadGoalEvidence, deleteGoalEvidence, goalEvidenceUrl } from "@/lib/actions/individual-goals";
import { recusaDeUpload, TAMANHO_ANEXO, MIMES_ANEXO } from "@/lib/uploads";
import { confirmDialog } from "@/components/ui/confirm";
import type { GoalEvidenceLite } from "./IndividualGoalsFarol";

const tamanho = (bytes: number | null) => {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Evidências do atingimento, dentro do diálogo de registrar o realizado.
 *
 * O arquivo sobe NA HORA em que é escolhido, e não junto com o Salvar. Duas
 * razões: a validação de "evidência obrigatória" acontece no servidor no momento
 * de gravar o realizado, então o anexo já precisa existir; e subir 10 MB no mesmo
 * clique do Salvar faria o botão parecer travado.
 *
 * Competência aprovada vira registro: dá para baixar, não dá para anexar nem
 * remover. A trava real está na RLS da tabela; aqui é só não oferecer o que vai
 * ser recusado.
 */
export function GoalEvidencePanel({
  goalId,
  period,
  evidences,
  obrigatoria,
  exigidaAgora,
  travado,
  onMudou,
}: {
  goalId: string;
  period: string;
  evidences: GoalEvidenceLite[];
  /** a meta pede evidência do atingimento */
  obrigatoria: boolean;
  /** o resultado digitado agora é dos que precisam de prova (atingido ou parcial) */
  exigidaAgora: boolean;
  /** competência aprovada: só leitura */
  travado: boolean;
  onMudou: () => void;
}) {
  const [erro, setErro] = useState("");
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  const enviar = (files: FileList | null) => {
    setErro("");
    if (!files || files.length === 0) return;
    const lista = Array.from(files);
    for (const f of lista) {
      const recusa = recusaDeUpload(f, TAMANHO_ANEXO, MIMES_ANEXO);
      if (recusa) { setErro(recusa); return; }
    }
    start(async () => {
      const fd = new FormData();
      fd.set("goal_id", goalId);
      fd.set("period", period);
      for (const f of lista) fd.append("files", f);
      const res = await uploadGoalEvidence(fd);
      // sem isso, escolher o MESMO arquivo de novo não dispara o onChange
      if (input.current) input.current.value = "";
      if (res.error) { setErro(res.error); return; }
      onMudou();
    });
  };

  const baixar = (path: string) => {
    start(async () => {
      const res = await goalEvidenceUrl(path);
      if (res.error || !res.url) { setErro(res.error ?? "Não foi possível abrir o arquivo."); return; }
      window.open(res.url, "_blank", "noopener");
    });
  };

  const remover = async (a: GoalEvidenceLite) => {
    const ok = await confirmDialog({
      title: "Remover evidência",
      message: `"${a.filename}" será apagado. Não dá para desfazer.`,
      confirmLabel: "Remover",
    });
    if (!ok) return;
    start(async () => {
      const res = await deleteGoalEvidence(a.id);
      if (res.error) { setErro(res.error); return; }
      onMudou();
    });
  };

  return (
    <div>
      <label className="label" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
        <Paperclip size={13} />
        Evidência do atingimento{" "}
        {!obrigatoria
          ? <span className="soft">(opcional)</span>
          : exigidaAgora
            ? <span style={{ color: "var(--mh-danger)", fontWeight: 700 }}>(obrigatória)</span>
            : <span className="soft">(obrigatória só se a meta for atingida)</span>}
      </label>

      {evidences.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginBottom: "0.5rem" }}>
          {evidences.map((a) => (
            <div
              key={a.id}
              style={{
                display: "flex", alignItems: "center", gap: "0.5rem",
                padding: "0.35rem 0.5rem", background: "var(--surface-2)",
                border: "1px solid var(--border)", borderRadius: "var(--mh-radius-sm)",
              }}
            >
              <span style={{ flex: 1, minWidth: 0, fontSize: "0.82rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.filename}>
                {a.filename}
              </span>
              <span className="soft" style={{ fontSize: "0.72rem", whiteSpace: "nowrap" }}>{tamanho(a.size)}</span>
              <button type="button" className="icon-btn" title="Baixar" disabled={pending} onClick={() => baixar(a.path)}>
                <Download size={14} />
              </button>
              {!travado && (
                <button type="button" className="icon-btn" title="Remover" disabled={pending} onClick={() => remover(a)}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {travado ? (
        <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
          Competência aprovada: a evidência fica como registro e não pode mais ser alterada.
        </p>
      ) : (
        <>
          <input
            ref={input}
            type="file"
            multiple
            className="input"
            disabled={pending}
            accept={MIMES_ANEXO.join(",")}
            onChange={(e) => enviar(e.target.files)}
            style={{ padding: "0.35rem" }}
          />
          <p className="soft" style={{ fontSize: "0.74rem", margin: "0.3rem 0 0" }}>
            {pending ? "Enviando…" : "Planilha, imagem, PDF ou documento, até 10 MB cada. O arquivo é enviado assim que você escolhe."}
          </p>
        </>
      )}

      {evidences.length === 0 && obrigatoria && exigidaAgora && !travado && (
        <p style={{ color: "var(--mh-danger)", fontSize: "0.78rem", margin: "0.3rem 0 0" }}>
          O resultado informado atinge a meta: sem anexo, ele não será salvo.
        </p>
      )}
      {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.82rem", margin: "0.3rem 0 0" }}>{erro}</p>}
    </div>
  );
}
