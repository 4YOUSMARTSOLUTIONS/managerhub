"use client";

import { useEffect, useState } from "react";
import { buscarCid } from "@/lib/actions/absenteismos";

/**
 * A tabela CID-10 que preenche a descrição na efetivação do absenteísmo.
 *
 * Somente leitura de propósito: é a tabela OFICIAL do DATASUS (Ministério da
 * Saúde), igual para todas as empresas. Editável, cada RH "corrigiria" uma
 * descrição e o mesmo código passaria a dizer coisas diferentes.
 */
export function CidTableViewer({ total }: { total: number }) {
  const [q, setQ] = useState("");
  const [linhas, setLinhas] = useState<{ code: string; description: string }[]>([]);

  useEffect(() => {
    const termo = q.trim();
    if (termo.length < 2) return;
    let vivo = true;
    const h = setTimeout(() => {
      buscarCid(termo).then((r) => { if (vivo) setLinhas(r); });
    }, 250);
    return () => { vivo = false; clearTimeout(h); };
  }, [q]);

  const visiveis = q.trim().length >= 2 ? linhas : [];

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.2rem" }}>Tabela CID-10</h3>
        <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
          A tabela oficial do DATASUS (Ministério da Saúde), com {total.toLocaleString("pt-BR")} códigos.
          É ela que preenche a descrição do CID na efetivação de um atestado, para a descrição nunca
          divergir do documento. Não é editável: o código J11.0 significa a mesma coisa em qualquer
          empresa.
        </p>
      </div>
      <input
        className="input" placeholder="Buscar por código (J11) ou descrição (influenza)…"
        value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 380 }}
      />
      {visiveis.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 110 }}>Código</th>
              <th>Descrição</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((l) => (
              <tr key={l.code}>
                <td style={{ fontWeight: 600 }}>{l.code}</td>
                <td>{l.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>
          {q.trim().length >= 2 ? "Nada encontrado com esse termo." : "Digite ao menos 2 caracteres para buscar."}
        </p>
      )}
    </div>
  );
}
