"use client";

/**
 * O passo "Completar" da importação (LUIZ, 26/11/2026).
 *
 * O arquivo da folha (Domínio) não traz subsetor, gestor nem hierarquia: o DP
 * completava isso à mão numa planilha paralela. Aqui o sistema pede SÓ para
 * quem precisa, e já vem com a sugestão das regras (Configurações >
 * Colaboradores > Regras da importação):
 *
 * - admissão: subsetor (do setor do arquivo), gestor e hierarquia;
 * - mudança de setor: o subsetor novo (sem ele a importação apaga o atual) e,
 *   se houver regra, o gestor do subsetor;
 * - mudança de função: a hierarquia da regra, quando difere da atual.
 */

import { SearchSelect, type SelOpt } from "./SearchSelect";

export const SEM = "-";

export type ItemACompletar = {
  cpf: string;
  nome: string;
  matricula: string;
  unidade: string;
  /** setor e função como vêm no arquivo */
  setor: string;
  funcao: string;
  tipo: "admissao" | "mudanca";
  mudaSetor: boolean;
  mudaFuncao: boolean;
  /** situação de hoje no sistema (só em mudança) */
  atual?: { gestorId: string | null; gestorNome: string | null; hierarquiaId: string | null; hierarquiaNome: string | null };
};

/**
 * O que o DP respondeu. Vazio = não respondeu (admissão) ou manter o atual
 * (mudança); `SEM` = "sem subsetor", "sem gestor", "sem hierarquia".
 */
export type Escolha = { subsetorId: string; gestorId: string; hierarquiaId: string };

export type OpcoesCompletar = {
  /** subsetores ativos, com o nome do setor para filtrar pelo setor do arquivo */
  subsetores: { id: string; name: string; departmentName: string }[];
  hierarquias: { id: string; name: string }[];
  gestores: SelOpt[];
};

const canon = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** o que falta responder neste item; null = completo */
export function faltaNoItem(item: ItemACompletar, e: Escolha | undefined): string | null {
  if (item.tipo === "admissao") {
    if (!e?.subsetorId) return "Escolha o subsetor";
    if (!e.gestorId) return "Escolha o gestor";
    if (!e.hierarquiaId) return "Escolha a hierarquia";
    return null;
  }
  if (item.mudaSetor && !e?.subsetorId) return "Escolha o subsetor novo";
  return null;
}

export function CompletarImportacao({
  itens,
  escolhas,
  onEscolha,
  opcoes,
  sugestaoGestor,
  lembrar,
  onLembrar,
  disabled,
}: {
  itens: ItemACompletar[];
  escolhas: Record<string, Escolha>;
  onEscolha: (cpf: string, e: Escolha) => void;
  opcoes: OpcoesCompletar;
  /** o gestor da regra para o subsetor na unidade, se houver */
  sugestaoGestor: (subsetorId: string, unidade: string) => string | null;
  lembrar: boolean;
  onLembrar: (v: boolean) => void;
  disabled: boolean;
}) {
  const gestoresComSem: SelOpt[] = [{ id: SEM, name: "Sem gestor" }, ...opcoes.gestores];
  const gestoresComManter = (atual: string | null): SelOpt[] => [
    { id: SEM, name: "Sem gestor" },
    ...opcoes.gestores.map((g) => (g.id === atual ? { ...g, name: `${g.name} (atual)` } : g)),
  ];
  const admissoes = itens.filter((i) => i.tipo === "admissao");
  const mudancas = itens.filter((i) => i.tipo === "mudanca");
  const faltam = itens.filter((i) => faltaNoItem(i, escolhas[i.cpf])).length;

  function trocarSubsetor(item: ItemACompletar, subsetorId: string) {
    const atual = escolhas[item.cpf] ?? { subsetorId: "", gestorId: "", hierarquiaId: "" };
    // o gestor acompanha o subsetor enquanto a pessoa não escolheu outro à mão
    const sugerido = subsetorId && subsetorId !== SEM ? sugestaoGestor(subsetorId, item.unidade) : null;
    const anterior = atual.subsetorId && atual.subsetorId !== SEM ? sugestaoGestor(atual.subsetorId, item.unidade) : null;
    const gestorSegue = !atual.gestorId || atual.gestorId === anterior;
    onEscolha(item.cpf, { ...atual, subsetorId, gestorId: gestorSegue ? sugerido ?? (item.tipo === "admissao" ? "" : atual.gestorId) : atual.gestorId });
  }

  const linha = (item: ItemACompletar) => {
    const e = escolhas[item.cpf] ?? { subsetorId: "", gestorId: "", hierarquiaId: "" };
    const subs = opcoes.subsetores.filter((s) => canon(s.departmentName) === canon(item.setor));
    const falta = faltaNoItem(item, e);
    const pedeSubsetor = item.tipo === "admissao" || item.mudaSetor;
    const pedeHierarquia = item.tipo === "admissao" || item.mudaFuncao;
    return (
      <li key={item.cpf} style={{ padding: "0.7rem 1rem", borderTop: "1px solid var(--border)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{item.nome}</div>
            <div className="soft" style={{ fontSize: "0.75rem" }}>
              Matrícula {item.matricula} · {item.unidade} · {item.funcao} · {item.setor}
            </div>
          </div>
          {falta && <span style={{ fontSize: "0.75rem", color: "var(--mh-danger)" }}>{falta}</span>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.5rem", marginTop: "0.5rem" }}>
          {pedeSubsetor && (
            <label style={{ fontSize: "0.78rem" }}>
              <span className="muted">Subsetor</span>
              <select
                className="select"
                value={e.subsetorId}
                disabled={disabled}
                onChange={(ev) => trocarSubsetor(item, ev.target.value)}
              >
                <option value="">Escolha…</option>
                <option value={SEM}>Sem subsetor</option>
                {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {subs.length === 0 && (
                <span className="soft" style={{ fontSize: "0.72rem" }}>
                  O setor {item.setor} ainda não tem subsetor cadastrado.
                </span>
              )}
            </label>
          )}
          {(item.tipo === "admissao" || item.mudaSetor) && (
            <div style={{ fontSize: "0.78rem" }}>
              <span className="muted">
                {item.tipo === "admissao" ? "Gestor" : "Gestor (vazio mantém o atual)"}
              </span>
              <SearchSelect
                options={item.tipo === "admissao" ? gestoresComSem : gestoresComManter(item.atual?.gestorId ?? null)}
                value={e.gestorId}
                onChange={(v) => onEscolha(item.cpf, { ...e, gestorId: v })}
                placeholder={item.tipo === "admissao" ? "Digite para buscar…" : `Atual: ${item.atual?.gestorNome ?? "sem gestor"}`}
                disabled={disabled}
                maxVisible={gestoresComSem.length}
              />
            </div>
          )}
          {pedeHierarquia && (
            <label style={{ fontSize: "0.78rem" }}>
              <span className="muted">
                {item.tipo === "admissao" ? "Hierarquia" : "Hierarquia (vazio mantém a atual)"}
              </span>
              <select
                className="select"
                value={e.hierarquiaId}
                disabled={disabled}
                onChange={(ev) => onEscolha(item.cpf, { ...e, hierarquiaId: ev.target.value })}
              >
                <option value="">
                  {item.tipo === "admissao" ? "Escolha…" : `Manter: ${item.atual?.hierarquiaNome ?? "sem hierarquia"}`}
                </option>
                <option value={SEM}>Sem hierarquia</option>
                {opcoes.hierarquias.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </label>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="card" style={{ fontSize: "0.88rem", overflow: "hidden" }}>
      <div style={{ padding: "0.85rem 1rem", background: "var(--surface-2)" }}>
        <strong>Completar o que o arquivo não traz ({itens.length})</strong>
        <p className="muted" style={{ fontSize: "0.8rem", margin: "0.25rem 0 0" }}>
          O arquivo da folha não tem subsetor, gestor nem hierarquia. O gestor e a hierarquia já vêm
          sugeridos pelas regras da importação; confira e troque o que precisar. Quem vai liderar uma
          equipe precisa ainda do perfil de acesso, definido por um administrador na ficha.
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.8rem", marginTop: "0.5rem", cursor: "pointer" }}>
          <input type="checkbox" checked={lembrar} disabled={disabled} onChange={(e) => onLembrar(e.target.checked)} />
          Guardar como regra o que eu escolher para função ou subsetor que ainda não tem regra
        </label>
      </div>
      {admissoes.length > 0 && (
        <>
          <div style={{ padding: "0.5rem 1rem", fontSize: "0.78rem", fontWeight: 600, borderTop: "1px solid var(--border)" }}>
            Admissões ({admissoes.length})
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{admissoes.map(linha)}</ul>
        </>
      )}
      {mudancas.length > 0 && (
        <>
          <div style={{ padding: "0.5rem 1rem", fontSize: "0.78rem", fontWeight: 600, borderTop: "1px solid var(--border)" }}>
            Mudança de setor ou de função ({mudancas.length})
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{mudancas.map(linha)}</ul>
        </>
      )}
      {faltam > 0 && (
        <div className="soft" style={{ padding: "0.6rem 1rem", fontSize: "0.78rem", borderTop: "1px solid var(--border)" }}>
          Falta responder {faltam} colaborador(es).
        </div>
      )}
    </div>
  );
}
