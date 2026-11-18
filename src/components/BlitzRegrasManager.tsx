"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { salvarRegrasBlitz } from "@/lib/actions/seguranca";
import { LIMITES_DA_RECORRENCIA, textoDaRecorrencia, type BlitzRegras } from "@/lib/blitz-regras";

/**
 * As regras da blitz da empresa (LUIZ, 18/11/2026): a primeira blitz
 * educativa e como a tratativa abre. Mora em Configurações > Segurança, junto
 * do resto do cadastro da blitz: owner/admin gravam (a RLS também só deixa
 * eles), o Gerencial lê.
 */
export function BlitzRegrasManager({ regras, canEdit }: { regras: BlitzRegras; canEdit: boolean }) {
  const [salvando, iniciar] = useTransition();
  const [r, setR] = useState(regras);
  // os números ficam como texto enquanto se digita (apagar para redigitar não vira 0)
  const [qtd, setQtd] = useState(String(regras.qtd));
  const [dias, setDias] = useState(String(regras.dias));
  const [erro, setErro] = useState("");

  const atual: BlitzRegras = { ...r, qtd: Number(qtd), dias: Number(dias) };
  const mudou = (Object.keys(regras) as (keyof BlitzRegras)[]).some((k) => regras[k] !== atual[k]);

  const salvar = () => {
    setErro("");
    iniciar(async () => {
      const res = await salvarRegrasBlitz(atual);
      if (res.error) { setErro(res.error); return; }
      toast.success(res.message ?? "Regras da blitz salvas.");
    });
  };
  const descartar = () => { setR(regras); setQtd(String(regras.qtd)); setDias(String(regras.dias)); setErro(""); };

  const opcao = (on: boolean): React.CSSProperties => ({
    display: "flex", gap: "0.6rem", alignItems: "flex-start", padding: "0.65rem 0.8rem",
    border: "1px solid " + (on ? "var(--mh-primary-500)" : "var(--border)"),
    background: on ? "var(--mh-primary-soft)" : "transparent",
    borderRadius: 8, cursor: canEdit ? "pointer" : "default", fontSize: "0.86rem",
  });

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: "1.4rem", maxWidth: 760 }}>
      <div>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Regras da blitz</h3>
        <p className="soft" style={{ fontSize: "0.82rem", margin: "0.25rem 0 0" }}>
          Valem para as próximas blitz. O que já foi lançado e as tratativas já abertas ficam como estão.
        </p>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
        <label className="label" style={{ marginBottom: 0 }}>Primeira blitz educativa</label>
        <label style={{ ...opcao(r.educativaAtiva), alignItems: "center" }}>
          <input
            type="checkbox" checked={r.educativaAtiva} disabled={!canEdit}
            onChange={(e) => setR({ ...r, educativaAtiva: e.target.checked })}
          />
          <span>A primeira blitz de quem foi contratado a partir de uma data é educativa</span>
        </label>
        {r.educativaAtiva && (
          <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", fontSize: "0.86rem" }}>
            <label htmlFor="regra-educativa-desde">Contratados a partir de</label>
            <input
              id="regra-educativa-desde" className="input" type="date" value={r.educativaDesde} disabled={!canEdit}
              onChange={(e) => setR({ ...r, educativaDesde: e.target.value })} style={{ width: "auto" }}
            />
          </div>
        )}
        <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
          A blitz educativa aparece nos Registros, mas não conta na aderência nem nos resultados, e não abre
          tratativa nem avisa o gestor. A pessoa segue em &quot;Faltam passar&quot; até a primeira blitz que conta.
        </p>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
        <label className="label" style={{ marginBottom: 0 }}>Tratativa da blitz não conforme</label>
        <label style={opcao(r.modo === "ocorrencia")}>
          <input
            type="radio" name="regra-modo" checked={r.modo === "ocorrencia"} disabled={!canEdit}
            onChange={() => setR({ ...r, modo: "ocorrencia" })} style={{ marginTop: 3 }}
          />
          <span>
            <strong>A cada blitz não conforme</strong>
            <span className="soft" style={{ display: "block", fontSize: "0.78rem" }}>
              Cada desvio ou bloqueio abre uma tratativa e avisa o gestor na hora.
            </span>
          </span>
        </label>
        <label style={opcao(r.modo === "recorrencia")}>
          <input
            type="radio" name="regra-modo" checked={r.modo === "recorrencia"} disabled={!canEdit}
            onChange={() => setR({ ...r, modo: "recorrencia" })} style={{ marginTop: 3 }}
          />
          <span>
            <strong>Por recorrência</strong>
            <span className="soft" style={{ display: "block", fontSize: "0.78rem" }}>
              A tratativa abre quando a pessoa acumula blitz não conformes, e cobre todas elas.
              Blitz que já entrou numa tratativa não conta de novo.
            </span>
          </span>
        </label>
        {r.modo === "recorrencia" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem", paddingLeft: "0.2rem" }}>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", fontSize: "0.86rem" }}>
              <span>Abrir ao chegar a</span>
              <input
                className="input" type="number" inputMode="numeric" aria-label="Quantidade de blitz não conformes"
                min={LIMITES_DA_RECORRENCIA.qtd.min} max={LIMITES_DA_RECORRENCIA.qtd.max}
                value={qtd} disabled={!canEdit} onChange={(e) => setQtd(e.target.value)} style={{ width: 80 }}
              />
              <span>blitz não conformes em</span>
              <input
                className="input" type="number" inputMode="numeric" aria-label="Período em dias"
                min={LIMITES_DA_RECORRENCIA.dias.min} max={LIMITES_DA_RECORRENCIA.dias.max}
                value={dias} disabled={!canEdit} onChange={(e) => setDias(e.target.value)} style={{ width: 90 }}
              />
              <span>dias</span>
            </div>
            <label style={{ display: "flex", gap: "0.55rem", alignItems: "center", fontSize: "0.86rem", cursor: canEdit ? "pointer" : "default" }}>
              <input
                type="checkbox" checked={r.bloqueioImediato} disabled={!canEdit}
                onChange={(e) => setR({ ...r, bloqueioImediato: e.target.checked })}
              />
              <span>Bloqueio abre tratativa na hora, sem esperar a recorrência</span>
            </label>
            <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
              Resumo: tratativa ao chegar a {Number(qtd) > 0 && Number(dias) > 0 ? textoDaRecorrencia(atual) : "…"}
              {r.bloqueioImediato ? ", e na hora quando houver bloqueio." : ", bloqueio inclusive."}
            </p>
          </div>
        )}
      </section>

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
