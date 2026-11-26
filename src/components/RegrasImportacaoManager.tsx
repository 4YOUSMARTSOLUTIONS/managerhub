"use client";

/**
 * Configurações > Colaboradores > Regras da importação (LUIZ, 26/11/2026).
 *
 * Substitui as abas que o DP mantinha à mão na planilha de importação
 * ("Hierarquia", "Código Gestor - Funcionários", a lista de e-mails
 * corporativos): o arquivo do Domínio sobe como sai, e o que ele não traz a
 * importação SUGERE a partir daqui. Nada aqui grava em colaborador; só muda a
 * sugestão das próximas importações.
 *
 * Três subabas (pedido do LUIZ, 26/11). O estado de cada uma mora aqui em cima:
 * trocar de subaba desmonta o conteúdo, e o que acabou de ser salvo não pode
 * voltar ao valor antigo.
 */

import { useState } from "react";
import { toast } from "sonner";
import { salvarConfigImportacao, salvarRegraFuncao, salvarRegraSubsetor } from "@/lib/actions/importacao";
import { Tabs } from "@/components/ui/Tabs";
import { SearchSelect, type SelOpt } from "./SearchSelect";

type Opcao = { id: string; name: string };
type Valores = Record<string, string>;
type Empresa = { codigo: string; unidade: string };

export type GrupoSubsetor = {
  subsetorId: string; subsetorNome: string; setorNome: string;
  unidadeId: string; unidadeNome: string;
  /** ativos hoje no subsetor, nesta unidade */
  pessoas: number;
};

const canon = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const chaveGrupo = (sub: string, un: string) => `${sub}|${un}`;

export function RegrasImportacaoManager({
  canEdit,
  config,
  unidades,
  funcoes,
  hierarquias,
  grupos,
  gestores,
  regrasFuncao,
  regrasSubsetor,
}: {
  canEdit: boolean;
  config: { empresasDominio: Record<string, string>; dominiosEmail: string[] };
  unidades: Opcao[];
  /** funções ativas do catálogo, com quantos ativos ocupam cada uma */
  funcoes: (Opcao & { pessoas: number })[];
  hierarquias: Opcao[];
  grupos: GrupoSubsetor[];
  gestores: SelOpt[];
  regrasFuncao: { positionId: string; hierarchyId: string }[];
  regrasSubsetor: { subdepartmentId: string; unitId: string; managerId: string }[];
}) {
  const [empresas, setEmpresas] = useState<Empresa[]>(() => {
    const inicial = Object.entries(config.empresasDominio).map(([codigo, unidade]) => ({ codigo, unidade }));
    return inicial.length ? inicial : [{ codigo: "", unidade: "" }];
  });
  const [dominios, setDominios] = useState(config.dominiosEmail.join(", "));
  const [porFuncao, setPorFuncao] = useState<Valores>(
    () => Object.fromEntries(regrasFuncao.map((r) => [r.positionId, r.hierarchyId])),
  );
  const [porSubsetor, setPorSubsetor] = useState<Valores>(
    () => Object.fromEntries(regrasSubsetor.map((r) => [chaveGrupo(r.subdepartmentId, r.unitId), r.managerId])),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>
        A importação de colaboradores aceita o arquivo do Domínio como ele sai do sistema da folha.
        O que o arquivo não traz (subsetor, gestor e hierarquia) a importação sugere a partir destas
        regras, e quem importa confere antes de gravar. Mudar uma regra não altera nenhum colaborador:
        vale para as próximas importações.
      </p>
      <Tabs
        variant="sub"
        tabs={[
          {
            id: "regras-arquivo",
            label: "Arquivo do Domínio e e-mail",
            content: (
              <ParametrosDoArquivo
                canEdit={canEdit} unidades={unidades}
                empresas={empresas} setEmpresas={setEmpresas} dominios={dominios} setDominios={setDominios}
              />
            ),
          },
          {
            id: "regras-funcao",
            label: "Hierarquia de cada função",
            content: (
              <RegrasPorFuncao canEdit={canEdit} funcoes={funcoes} hierarquias={hierarquias} valores={porFuncao} setValores={setPorFuncao} />
            ),
          },
          {
            id: "regras-subsetor",
            label: "Gestor de cada subsetor",
            content: (
              <RegrasPorSubsetor canEdit={canEdit} grupos={grupos} gestores={gestores} valores={porSubsetor} setValores={setPorSubsetor} />
            ),
          },
        ]}
      />
    </div>
  );
}

function ParametrosDoArquivo({ canEdit, unidades, empresas, setEmpresas, dominios, setDominios }: {
  canEdit: boolean;
  unidades: Opcao[];
  empresas: Empresa[];
  setEmpresas: React.Dispatch<React.SetStateAction<Empresa[]>>;
  dominios: string;
  setDominios: (v: string) => void;
}) {
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    const r = await salvarConfigImportacao({
      empresasDominio: Object.fromEntries(empresas.filter((e) => e.codigo || e.unidade).map((e) => [e.codigo, e.unidade])),
      dominiosEmail: dominios.split(/[,;\s]+/),
    });
    setSalvando(false);
    if (r.error) toast.error(r.error);
    else toast.success(r.message ?? "Salvo.");
  }

  return (
    <div className="card card-pad">
      <p className="soft" style={{ fontSize: "0.8rem", margin: "0 0 0.8rem" }}>
        No arquivo do Domínio a empresa vem como um número (coluna Cód Emp). Diga a qual unidade cada
        número corresponde. O e-mail corporativo de quem já tem um não é trocado pelo e-mail pessoal
        que vem do arquivo.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxWidth: 420 }}>
        <span className="muted" style={{ fontSize: "0.82rem" }}>Código de empresa no Domínio e a unidade</span>
        {empresas.map((e, i) => (
          <div key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              className="input" inputMode="numeric" placeholder="Código" value={e.codigo}
              aria-label="Código de empresa no Domínio" disabled={!canEdit || salvando} style={{ width: 90 }}
              onChange={(ev) => setEmpresas((xs) => xs.map((x, j) => (j === i ? { ...x, codigo: ev.target.value } : x)))}
            />
            <select
              className="select" value={e.unidade} aria-label="Unidade" disabled={!canEdit || salvando}
              onChange={(ev) => setEmpresas((xs) => xs.map((x, j) => (j === i ? { ...x, unidade: ev.target.value } : x)))}
            >
              <option value="">Unidade…</option>
              {unidades.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
            </select>
            {canEdit && empresas.length > 1 && (
              <button
                type="button" className="btn btn-ghost btn-sm" aria-label="Remover código" disabled={salvando}
                onClick={() => setEmpresas((xs) => xs.filter((_, j) => j !== i))}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {canEdit && (
          <div>
            <button type="button" className="btn btn-ghost btn-sm" disabled={salvando}
              onClick={() => setEmpresas((xs) => [...xs, { codigo: "", unidade: "" }])}>
              + Código de empresa
            </button>
          </div>
        )}
        <label style={{ fontSize: "0.82rem", marginTop: "0.4rem" }}>
          <span className="muted">Domínios do e-mail corporativo (separe por vírgula)</span>
          <input
            className="input" value={dominios} placeholder="empresa.com.br" disabled={!canEdit || salvando}
            onChange={(e) => setDominios(e.target.value)}
          />
        </label>
      </div>
      {canEdit && (
        <div style={{ marginTop: "0.7rem" }}>
          <button type="button" className="btn btn-primary btn-sm" disabled={salvando} onClick={salvar}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      )}
    </div>
  );
}

function RegrasPorFuncao({ canEdit, funcoes, hierarquias, valores, setValores }: {
  canEdit: boolean;
  funcoes: (Opcao & { pessoas: number })[];
  hierarquias: Opcao[];
  valores: Valores;
  setValores: React.Dispatch<React.SetStateAction<Valores>>;
}) {
  const [busca, setBusca] = useState("");
  // As funções sem ninguém ativo são histórico: em 26/11/2026 eram 112 de 208,
  // quase todas de quem saiu antes de a hierarquia existir. Mostrá-las por
  // padrão fazia parecer que as regras tinham se perdido.
  const [comAtivos, setComAtivos] = useState(true);
  const [soSemRegra, setSoSemRegra] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);

  async function trocar(positionId: string, hierarchyId: string) {
    const antes = valores[positionId] ?? "";
    setValores((v) => ({ ...v, [positionId]: hierarchyId }));
    setSalvando(positionId);
    const r = await salvarRegraFuncao(positionId, hierarchyId || null);
    setSalvando(null);
    if (r.error) {
      toast.error(r.error);
      setValores((v) => ({ ...v, [positionId]: antes }));
    }
  }

  const q = canon(busca);
  const lista = funcoes.filter((f) =>
    (!q || canon(f.name).includes(q)) && (!comAtivos || f.pessoas > 0) && (!soSemRegra || !valores[f.id]));
  const semRegra = funcoes.filter((f) => f.pessoas > 0 && !valores[f.id]).length;
  const historicas = funcoes.filter((f) => f.pessoas === 0).length;

  return (
    <div className="card">
      <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
        <p className="soft" style={{ fontSize: "0.8rem", margin: "0 0 0.6rem" }}>
          Sugerida para quem é admitido e para quem muda de função.
          {semRegra > 0
            ? ` ${semRegra} função(ões) com gente hoje ainda sem regra.`
            : " Todas as funções com gente hoje têm regra."}
        </p>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <input className="input" placeholder="Buscar função…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 280 }} />
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem", cursor: "pointer" }}>
            <input type="checkbox" checked={!comAtivos} onChange={(e) => setComAtivos(!e.target.checked)} />
            Mostrar também as {historicas} sem ninguém ativo
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem", cursor: "pointer" }}>
            <input type="checkbox" checked={soSemRegra} onChange={(e) => setSoSemRegra(e.target.checked)} />
            Só as sem regra
          </label>
        </div>
      </div>
      <table className="table table-linha">
        <thead>
          <tr><th>Função</th><th style={{ textAlign: "right" }}>Ativos</th><th style={{ width: 240 }}>Hierarquia sugerida</th></tr>
        </thead>
        <tbody>
          {lista.map((f) => (
            <tr key={f.id}>
              <td><span className="cell-trunc" title={f.name} style={{ maxWidth: 380 }}>{f.name}</span></td>
              <td style={{ textAlign: "right" }}>{f.pessoas}</td>
              <td>
                <select
                  className="select" value={valores[f.id] ?? ""} aria-label={`Hierarquia de ${f.name}`}
                  disabled={!canEdit || salvando === f.id}
                  onChange={(e) => trocar(f.id, e.target.value)}
                >
                  <option value="">Sem regra</option>
                  {hierarquias.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </td>
            </tr>
          ))}
          {lista.length === 0 && (
            <tr><td colSpan={3} className="soft" style={{ textAlign: "center", padding: "1rem" }}>Nenhuma função encontrada.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RegrasPorSubsetor({ canEdit, grupos, gestores, valores, setValores }: {
  canEdit: boolean;
  grupos: GrupoSubsetor[];
  gestores: SelOpt[];
  valores: Valores;
  setValores: React.Dispatch<React.SetStateAction<Valores>>;
}) {
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState<string | null>(null);

  async function trocar(g: GrupoSubsetor, managerId: string) {
    const k = chaveGrupo(g.subsetorId, g.unidadeId);
    const antes = valores[k] ?? "";
    setValores((v) => ({ ...v, [k]: managerId }));
    setSalvando(k);
    const r = await salvarRegraSubsetor(g.subsetorId, g.unidadeId, managerId || null);
    setSalvando(null);
    if (r.error) {
      toast.error(r.error);
      setValores((v) => ({ ...v, [k]: antes }));
    }
  }

  const q = canon(busca);
  const lista = grupos.filter((g) => !q || canon(`${g.setorNome} ${g.subsetorNome} ${g.unidadeNome}`).includes(q));

  return (
    <div className="card">
      <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
        <p className="soft" style={{ fontSize: "0.8rem", margin: "0 0 0.6rem" }}>
          Sugerido para quem é admitido no subsetor e para quem muda para ele. O próprio líder do
          subsetor e as exceções continuam com o gestor que estiver na ficha.
        </p>
        <input className="input" placeholder="Buscar setor, subsetor ou unidade…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 320 }} />
      </div>
      <table className="table table-linha">
        <thead>
          <tr><th>Setor</th><th>Subsetor</th><th>Unidade</th><th style={{ textAlign: "right" }}>Ativos</th><th style={{ width: 280 }}>Gestor sugerido</th></tr>
        </thead>
        <tbody>
          {lista.map((g) => {
            const k = chaveGrupo(g.subsetorId, g.unidadeId);
            return (
              <tr key={k}>
                <td><span className="cell-trunc" title={g.setorNome} style={{ maxWidth: 160 }}>{g.setorNome}</span></td>
                <td><span className="cell-trunc" title={g.subsetorNome} style={{ maxWidth: 200 }}>{g.subsetorNome}</span></td>
                <td>{g.unidadeNome}</td>
                <td style={{ textAlign: "right" }}>{g.pessoas}</td>
                <td>
                  <SearchSelect
                    options={gestores}
                    value={valores[k] ?? ""}
                    onChange={(v) => trocar(g, v)}
                    placeholder="Sem regra (digite para buscar)"
                    disabled={!canEdit || salvando === k}
                    maxVisible={gestores.length}
                  />
                </td>
              </tr>
            );
          })}
          {lista.length === 0 && (
            <tr><td colSpan={5} className="soft" style={{ textAlign: "center", padding: "1rem" }}>Nenhum subsetor encontrado.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
