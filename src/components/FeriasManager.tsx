"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Ban, CalendarPlus, Check, FileSpreadsheet, Pencil, Plane, Send, Settings, Trash2, Undo2, Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Dropdown, ItemDeMenu } from "@/components/ui/Dropdown";
import { PageHeader } from "@/components/ui/PageHeader";
import { DetailModal } from "@/components/ui/DetailModal";
import { DetailSection, Field, FieldGrid } from "@/components/ui/Field";
import { Tabs, type Tab } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { ExportButton } from "@/components/ui/ExportButton";
import { StatCard } from "@/components/ui/StatCard";
import { confirmDialog } from "@/components/ui/confirm";
import type { Person } from "@/components/PeoplePicker";
import { FeriasSolicitarDialog } from "@/components/FeriasSolicitarDialog";
import { FeriasImportarFolhaDialog } from "@/components/FeriasImportarFolhaDialog";
import { FeriasCalendario } from "@/components/FeriasCalendario";
import { FeriasLancarPlanilhaDialog } from "@/components/FeriasLancarPlanilhaDialog";
import { FeriasAcompanhamento } from "@/components/FeriasAcompanhamento";
import { FeriasProgramacao } from "@/components/FeriasProgramacao";
import { FeriasTimeline, type TimelineLinha } from "@/components/FeriasTimeline";
import { SituacaoBadge, type SituacaoColaborador } from "@/components/SituacaoColaborador";
import { formatDate, formatDateTime, normalizar, shortName, somarDias } from "@/lib/format";
import {
  FERIAS_AQUISITIVO_SITUACAO, FERIAS_AQUISITIVO_TONE, FERIAS_STATUS, FERIAS_STATUS_TONE, aquisitivoSemSaldo,
} from "@/lib/constants";
import {
  rotuloAquisitivo, periodoAquisitivo, type AquisitivoInfo, type FeriadoCustom, type PrazosLegais, type QuemLanca,
} from "@/lib/ferias";
import {
  cancelarFerias, decidirFerias, efetivarFerias, excluirFerias, getContextoEfetivacao,
  type ContextoEfetivacao,
} from "@/lib/actions/ferias";
import type { Enums } from "@/types/database";

/** o retorno de `ferias_painel` (o escopo já vem recortado pela alçada) */
export type FeriasPainel = {
  agora: { userId: string; nome: string | null; setor: string | null; inicio: string; fim: string }[];
  proximas: { userId: string; nome: string | null; inicio: string; fim: string; origem: "efetivada" | "prevista" }[];
  timeline: TimelineLinha[];
  saldos: {
    userId: string; nome: string | null; setor: string | null; saldo: number;
    situacao: string | null; aquisitivoInicio: string | null; aquisitivoFim: string | null;
    gozarAte: string | null;
    /** a empresa importa da folha e a pessoa não veio no relatório */
    semFolha?: boolean;
    /** afastamento/licença em vigor na data; nulo = ativo */
    statusColaborador?: SituacaoColaborador | null;
  }[];
  usaFolha?: boolean;
  janelaInicio: string;
  janelaFim: string;
};

/** a última importação do relatório da folha (só o DP recebe) */
export type UltimaImportacaoFolha = {
  referencia: string;
  dataBase: string | null;
  importadoEm: string;
  importadoPor: string | null;
  pessoas: number;
  periodos: number;
};

export type FeriasRow = {
  id: string;
  status: Enums<"ferias_status">;
  userId: string;
  startDate: string;
  endDate: string;
  dias: number;
  abonoDias: number;
  decimo: boolean;
  aquisitivoInicio: string;
  aquisitivoFim: string;
  reagendadaDe: string | null;
  fullName: string | null;
  employeeCode: string | null;
  departmentName: string | null;
  subdepartmentName: string | null;
  positionName: string | null;
  managerName: string | null;
  unitName: string | null;
  hierarchyName: string | null;
  createdBy: string;
  createdByName: string | null;
  lancadaPeloGestor: boolean;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  efetivadaAt: string | null;
  efetivadaByName: string | null;
  efetivacaoNote: string | null;
  cancelledAt: string | null;
  cancelNote: string | null;
  /** gozo depois do prazo de concessão, lançado pelo DP (art. 137) */
  emDobro: boolean;
  justificativaDobro: string | null;
  /** abono pedido depois de 15 dias antes do fim do aquisitivo (art. 143 §1º) */
  abonoForaPrazo: boolean;
  /** adiantamento do 13º pedido depois de janeiro do ano das férias (Lei 4.749/65) */
  decimoForaPrazo: boolean;
  createdAt: string;
};

/** "Abono fora do prazo", "13º fora do prazo", os dois, ou null. */
function rotuloForaPrazo(r: FeriasRow): string | null {
  if (r.abonoForaPrazo && r.decimoForaPrazo) return "Abono e 13º fora do prazo";
  if (r.abonoForaPrazo) return "Abono fora do prazo";
  if (r.decimoForaPrazo) return "13º fora do prazo";
  return null;
}

/** A explicação da marca, para a ficha e a efetivação. */
function NotaForaPrazo({ row }: { row: FeriasRow }) {
  if (!row.abonoForaPrazo && !row.decimoForaPrazo) return null;
  const partes = [
    row.abonoForaPrazo ? "o abono foi pedido depois de 15 dias antes do fim do período aquisitivo (art. 143 §1º)" : null,
    row.decimoForaPrazo ? "o adiantamento do 13º foi pedido depois de janeiro do ano das férias (Lei 4.749/65)" : null,
  ].filter(Boolean).join(", e ");
  return (
    <p style={{ fontSize: "0.84rem", margin: "0.6rem 0 0", paddingLeft: "0.6rem", borderLeft: "2px solid var(--mh-warning)" }}>
      <strong>Fora do prazo legal:</strong> {partes}. A empresa podia recusar; seguir com a previsão é aceitar.
    </p>
  );
}

/** A data (no fuso do Brasil) em que um pedido foi aberto. */
const dataDoPedido = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));

/**
 * A tela de férias, com as caras que o papel pede:
 *  - todo mundo vê "Minhas férias" (saldo por aquisitivo + as próprias previsões);
 *  - gestor ganha a fila de aprovação e o lançamento para a equipe (o caminho
 *    obrigatório do operacional);
 *  - o DP ganha a fila de efetivação, que é onde a previsão vira ausência real.
 *
 * O recorte de LINHAS já vem pronto da RLS (`pode_ver_ferias`); aqui só se
 * decide quais abas e botões existem.
 */
export function FeriasManager({
  rows, meuId, ehDp, ehOwner, ehGestor, equipe, vejoEmpresa, podeSolicitar, avisoSolicitar,
  pessoasLancar, meusAquisitivos, feriados, hoje, painel, usaFolha, ultimaImportacao, setores, unidades,
  antecedencia, prazos,
}: {
  rows: FeriasRow[];
  meuId: string;
  ehDp: boolean;
  ehOwner: boolean;
  /** lidera equipe de fato (papel + subordinados) */
  ehGestor: boolean;
  /** quem está abaixo de mim no organograma, a cadeia inteira (`my_managed_memberships`) */
  equipe: string[];
  /** a RLS me mostra a empresa toda (DP e Gerencial), não só a minha cadeia */
  vejoEmpresa: boolean;
  podeSolicitar: boolean;
  /** por que o botão Solicitar não aparece (nível bloqueado, sem admissão) */
  avisoSolicitar: string | null;
  pessoasLancar: Person[];
  meusAquisitivos: AquisitivoInfo[];
  feriados: FeriadoCustom[];
  hoje: string;
  painel: FeriasPainel | null;
  /** a empresa importa os aquisitivos da folha */
  usaFolha: boolean;
  ultimaImportacao: UltimaImportacaoFolha | null;
  /** cadastro de setores: a cor de cada um no calendário sai da ordem dele aqui */
  setores: { id: string; name: string }[];
  /** unidades do seletor do topo (null = todas) */
  unidades: string[] | null;
  /** antecedência mínima, em dias, por quem lança (0 = sem); Configurações > Férias */
  antecedencia: Record<QuemLanca, number>;
  /** abono e 13º pedidos fora do prazo legal: alerta ou bloqueio do colaborador */
  prazos: PrazosLegais;
}) {
  const [dialogo, setDialogo] = useState<"solicitar" | "lancar" | null>(null);
  const [importando, setImportando] = useState(false);
  const [loteAberto, setLoteAberto] = useState(false);
  const [reenvio, setReenvio] = useState<FeriasRow | null>(null);
  const [reagendando, setReagendando] = useState<FeriasRow | null>(null);
  const [detalhe, setDetalhe] = useState<FeriasRow | null>(null);
  const [efetivando, setEfetivando] = useState<FeriasRow | null>(null);
  const [nota, setNota] = useState<{ row: FeriasRow; acao: "devolver" | "cancelar" } | null>(null);
  const router = useRouter();

  const minhas = useMemo(() => rows.filter((r) => r.userId === meuId), [rows, meuId]);

  /**
   * De quem é a antecedência mínima no lançamento e no reagendamento, como o
   * banco decide: o DP é sempre DP (mesmo quando é o gestor da pessoa ou
   * reagenda as próprias férias); fora isso, o próprio dono é colaborador e
   * quem mexe na equipe é gestor. O "Solicitar" e a correção do pedido próprio
   * não passam por aqui: são sempre do colaborador.
   */
  const quemNo = (caso: "colaborador" | "lancamento"): QuemLanca =>
    ehDp ? "dp" : caso === "colaborador" ? "colaborador" : "gestor";

  /**
   * Os 13º que a pessoa já pediu (uma vez por ano), sem a linha em edição: o
   * formulário trava a opção nesses anos. O banco confere de novo.
   */
  const decimosDe = (userId: string, excluir?: string) =>
    rows
      .filter((r) => r.userId === userId && r.id !== excluir && r.decimo
        && (r.status === "solicitada" || r.status === "aprovada" || r.status === "efetivada"))
      .map((r) => ({ inicio: r.startDate, fim: r.endDate }));
  /**
   * Minha equipe ou a empresa toda: um recorte da TELA inteira (cartões, filas,
   * todas as previsões e as subabas do painel). Só pergunta a quem enxerga além
   * da própria cadeia E lidera alguém (o dono, o DP que também é gestor, o
   * Gerencial): para os demais as duas respostas seriam a mesma lista.
   * "Minhas férias" e o menu de ações ficam de fora: um é a própria pessoa, o
   * outro é o que ela pode fazer, não o que ela está olhando.
   *
   * É filtro de visão, não de acesso: a RLS continua decidindo o que chega.
   */
  const equipeSet = useMemo(() => new Set(equipe), [equipe]);
  const escolheEscopo = vejoEmpresa && equipe.length > 0;
  // abre na própria equipe (decisão do LUIZ, 05/11/2026): a empresa toda é um clique
  const [escopo, setEscopo] = useState<Escopo>("equipe");
  const soEquipe = escolheEscopo && escopo === "equipe";
  const pessoasNoEscopo = soEquipe ? equipeSet : null;

  const rowsNoEscopo = useMemo(
    () => (soEquipe ? rows.filter((r) => equipeSet.has(r.userId)) : rows),
    [rows, soEquipe, equipeSet]);
  const painelNoEscopo = useMemo<FeriasPainel | null>(() => {
    if (!painel || !soEquipe) return painel;
    const daEquipe = (x: { userId: string }) => equipeSet.has(x.userId);
    return {
      ...painel,
      agora: painel.agora.filter(daEquipe),
      proximas: painel.proximas.filter(daEquipe),
      timeline: painel.timeline.filter(daEquipe),
      saldos: painel.saldos.filter(daEquipe),
    };
  }, [painel, soEquipe, equipeSet]);

  // Quem decide a previsão é o gestor da pessoa ou o DP (`ferias_decidir`). O
  // Gerencial enxerga a empresa toda, mas só decide a própria cadeia: os
  // pedidos dos outros na fila dele virariam botão que só devolve erro.
  const fila = useMemo(
    () => rowsNoEscopo.filter((r) => r.status === "solicitada" && r.userId !== meuId && (ehDp || equipeSet.has(r.userId))),
    [rowsNoEscopo, meuId, ehDp, equipeSet]);
  const filaDp = useMemo(
    () => rowsNoEscopo.filter((r) => r.status === "aprovada").sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [rowsNoEscopo]);

  // o painel traz o FATO (employee_absences, inclusive o histórico pré-módulo);
  // sem ele, cai para as linhas do processo
  const emGozoQtd = painelNoEscopo
    ? painelNoEscopo.agora.length
    : rowsNoEscopo.filter((r) => r.status === "efetivada" && r.startDate <= hoje && r.endDate >= hoje).length;
  const proximasQtd = painelNoEscopo
    ? painelNoEscopo.proximas.length
    : rowsNoEscopo.filter((r) =>
        (r.status === "efetivada" || r.status === "aprovada") && r.startDate > hoje && r.startDate <= somarDias(hoje, 60)).length;
  const aVencerQtd = painelNoEscopo ? painelNoEscopo.saldos.filter((s) => s.situacao === "a_vencer").length : 0;
  const vencidasQtd = painelNoEscopo ? painelNoEscopo.saldos.filter((s) => s.situacao === "vencida").length : 0;

  const podeGerir = ehGestor || ehDp;

  const abas: Tab[] = [
    { id: "minhas", label: "Minhas férias", content: (
      <MinhasFerias
        minhas={minhas} aquisitivos={meusAquisitivos} avisoSolicitar={avisoSolicitar}
        podeSolicitar={podeSolicitar} onSolicitar={() => setDialogo("solicitar")}
        onReenviar={setReenvio} onDetalhe={setDetalhe} onCancelar={(r) => setNota({ row: r, acao: "cancelar" })}
        onReagendar={setReagendando}
        hoje={hoje}
      />
    ) },
  ];
  if (podeGerir) {
    abas.push({ id: "fila", label: `Aprovações${fila.length ? ` (${fila.length})` : ""}`, content: (
      // o aviso de "as outras estão em Toda a empresa" só vale para o DP: o
      // Gerencial não decide as outras equipes, então elas nunca entram na fila dele
      <FilaGestor fila={fila} soEquipe={soEquipe && ehDp}
        onDetalhe={setDetalhe} onDevolver={(r) => setNota({ row: r, acao: "devolver" })} />
    ) });
  }
  if (ehDp) {
    abas.push({ id: "efetivacao", label: `Efetivação${filaDp.length ? ` (${filaDp.length})` : ""}`, content: (
      <FilaDp fila={filaDp} soEquipe={soEquipe} onDetalhe={setDetalhe} onEfetivar={setEfetivando}
        onDevolver={(r) => setNota({ row: r, acao: "devolver" })} />
    ) });
  }
  if (podeGerir) {
    abas.push({ id: "todas", label: "Todas as previsões", content: (
      <TabelaGeral rows={rowsNoEscopo} onDetalhe={setDetalhe} />
    ) });
  }
  if (podeGerir) {
    // As leituras de gestão moram juntas: visão geral, calendário do mês, quem
    // está fora num período e a programação por pessoa. Cada subaba busca o
    // próprio período quando é aberta (o Tabs só monta a aba visível).
    const subabas: Tab[] = [];
    if (painelNoEscopo) {
      subabas.push({ id: "visao", label: "Visão geral", content: (
        // importar períodos mora só no menu Ações (LUIZ, 06/11/2026): aqui
        // fica a leitura, com a data da última importação
        <VisaoGeral painel={painelNoEscopo} hoje={hoje} ultimaImportacao={ehDp ? ultimaImportacao : null} />
      ) });
    }
    subabas.push(
      { id: "calendario", label: "Calendário", content: (
        <FeriasCalendario setores={setores} unidades={unidades} hoje={hoje} soUsuarios={pessoasNoEscopo} />
      ) },
      { id: "acompanhamento", label: "Acompanhamento", content: (
        <FeriasAcompanhamento setores={setores} unidades={unidades} hoje={hoje} soUsuarios={pessoasNoEscopo} />
      ) },
      { id: "programacao", label: "Programação", content: (
        <FeriasProgramacao setores={setores} unidades={unidades} hoje={hoje} soUsuarios={pessoasNoEscopo} />
      ) },
    );
    abas.push({ id: "painel", label: "Painel", content: (
      <div style={{ paddingTop: "0.6rem" }}>
        <Tabs variant="sub" tabs={subabas} />
      </div>
    ) });
  }

  // As ações da tela num menu só, no espaço de ação do cabeçalho: quatro botões
  // soltos disputavam a linha com o subtítulo e passavam por cima dele. Quem
  // tem uma ação só (o colaborador, que só solicita) vê um botão direto.
  const podeLancar = podeGerir && pessoasLancar.length > 0;
  const acoes: { id: string; grupo: "ferias" | "dp"; rotulo: string; icone: React.ReactNode; titulo?: string; fazer: () => void }[] = [];
  if (podeSolicitar) {
    acoes.push({ id: "solicitar", grupo: "ferias", rotulo: "Solicitar férias", icone: <Plane size={14} />, fazer: () => setDialogo("solicitar") });
  }
  if (podeLancar) {
    acoes.push(
      { id: "lancar", grupo: "ferias", rotulo: "Lançar férias", icone: <CalendarPlus size={14} />,
        titulo: "Programar as férias de alguém da equipe", fazer: () => setDialogo("lancar") },
      { id: "lote", grupo: "ferias", rotulo: "Importar programação", icone: <FileSpreadsheet size={14} />,
        titulo: "Lançar as férias da equipe de uma vez, por planilha", fazer: () => setLoteAberto(true) },
    );
  }
  if (ehDp) {
    acoes.push(
      { id: "periodos", grupo: "dp", rotulo: "Importar períodos aquisitivos", icone: <Upload size={14} />,
        titulo: "Modelo do MANAGERHUB ou relatório da folha", fazer: () => setImportando(true) },
      // as regras (antecedência, quem solicita) moram em Configurações; o atalho
      // existe porque lá elas ficavam fora da vista de quem opera o módulo
      { id: "config", grupo: "dp", rotulo: "Configurações de férias", icone: <Settings size={14} />,
        titulo: "Antecedência mínima e quem solicita as próprias férias",
        fazer: () => router.push("/configuracoes?aba=ferias") },
    );
  }
  const tituloGrupo = (texto: string) => (
    <div className="soft" style={{ fontSize: "0.68rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", padding: "0 0.6rem" }}>
      {texto}
    </div>
  );
  const menuDeAcoes = acoes.length === 0 ? null : acoes.length === 1 ? (
    <button type="button" className="btn btn-primary" onClick={acoes[0].fazer} title={acoes[0].titulo}>
      {acoes[0].icone} {acoes[0].rotulo}
    </button>
  ) : (
    <Dropdown rotulo="Ações" variante="primary" alinharDireita largura={270}>
      {(fechar) => (
        <>
          {acoes.some((a) => a.grupo === "ferias") && tituloGrupo("Férias")}
          {acoes.filter((a) => a.grupo === "ferias").map((a) => (
            <ItemDeMenu key={a.id} titulo={a.titulo} onClick={() => { fechar(); a.fazer(); }}>
              <span style={{ display: "inline-flex", marginRight: 8 }}>{a.icone}</span>{a.rotulo}
            </ItemDeMenu>
          ))}
          {acoes.some((a) => a.grupo === "dp") && (
            <div style={{ borderTop: "1px solid var(--mh-border)", paddingTop: "0.6rem" }}>
              {tituloGrupo("Departamento pessoal")}
            </div>
          )}
          {acoes.filter((a) => a.grupo === "dp").map((a) => (
            <ItemDeMenu key={a.id} titulo={a.titulo} onClick={() => { fechar(); a.fazer(); }}>
              <span style={{ display: "inline-flex", marginRight: 8 }}>{a.icone}</span>{a.rotulo}
            </ItemDeMenu>
          ))}
        </>
      )}
    </Dropdown>
  );

  return (
    <>
    <PageHeader
      title="Férias"
      subtitle="A previsão vira planejamento de verdade só depois que o departamento pessoal efetiva"
      action={escolheEscopo ? (
        // ao lado das ações, e não dentro de uma aba: vale para a tela toda
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
          <AlternadorDeEscopo escopo={escopo} onMudar={setEscopo} />
          {menuDeAcoes}
        </div>
      ) : menuDeAcoes}
    />
    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>

      {podeGerir && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.8rem" }}>
          <StatCard label="De férias agora" value={emGozoQtd} tone="green"
            hint={painelNoEscopo?.agora.slice(0, 3).map((r) => shortName(r.nome)).join(", ") || "ninguém em gozo hoje"} />
          <StatCard label="Próximas saídas (60 dias)" value={proximasQtd} tone="blue" />
          <StatCard label="Aguardando aprovação do gestor" value={rowsNoEscopo.filter((r) => r.status === "solicitada").length}
            tone={fila.length > 0 ? "amber" : "gray"} />
          <StatCard label="Aguardando efetivação" value={filaDp.length} tone={filaDp.length > 0 ? "amber" : "gray"}
            hint={ehDp ? "o DP confirma o cálculo na folha" : undefined} />
          {painel && (
            <StatCard label="A vencer (90 dias)" value={aVencerQtd} tone={aVencerQtd > 0 ? "amber" : "gray"}
              hint="período concessivo terminando" />
          )}
          {painel && (
            <StatCard label="Vencidas" value={vencidasQtd} tone={vencidasQtd > 0 ? "red" : "green"}
              hint={vencidasQtd > 0 ? "concessão em dobro (art. 137)" : "nenhum estouro"} />
          )}
        </div>
      )}

      <Tabs tabs={abas} />

      {importando && (
        <FeriasImportarFolhaDialog ultima={ultimaImportacao} onFechar={() => setImportando(false)} />
      )}
      {loteAberto && (
        <FeriasLancarPlanilhaDialog hoje={hoje} onFechar={() => setLoteAberto(false)} />
      )}
      {dialogo && (
        <FeriasSolicitarDialog
          modo={dialogo}
          pessoas={pessoasLancar}
          aquisitivos={dialogo === "solicitar" ? meusAquisitivos : null}
          feriados={feriados}
          hoje={hoje}
          ehDp={ehDp}
          usaFolha={usaFolha}
          // cada um com a sua antecedência (o banco decide igual, pelo papel); no
          // lançamento, os 13º da pessoa escolhida vêm junto com o saldo dela
          // ("Solicitar" é sempre o pedido próprio: a do colaborador, até para o DP)
          antecedencia={antecedencia[dialogo === "solicitar" ? "colaborador" : quemNo("lancamento")]}
          antecedenciaQuem={dialogo === "solicitar" ? "colaborador" : quemNo("lancamento")}
          prazos={prazos}
          decimos={dialogo === "solicitar" ? decimosDe(meuId) : undefined}
          onFechar={() => setDialogo(null)}
        />
      )}
      {reenvio && (
        <FeriasSolicitarDialog
          modo="reenviar"
          aquisitivos={reenvio.userId === meuId ? meusAquisitivos : null}
          feriados={feriados}
          hoje={hoje}
          usaFolha={usaFolha}
          // o pedido do colaborador segue a dele; o lançado pelo gestor/DP, a de
          // quem corrige (o banco aplica a mesma regra)
          antecedencia={antecedencia[reenvio.lancadaPeloGestor ? quemNo("lancamento") : "colaborador"]}
          antecedenciaQuem={reenvio.lancadaPeloGestor ? quemNo("lancamento") : "colaborador"}
          prazos={prazos}
          // o que já vinha pedido conta pela data do pedido original (o banco faz igual)
          pedidoEm={{
            abono: reenvio.abonoDias > 0 ? dataDoPedido(reenvio.createdAt) : null,
            decimo: reenvio.decimo ? dataDoPedido(reenvio.createdAt) : null,
          }}
          decimos={decimosDe(reenvio.userId, reenvio.id)}
          inicial={{
            id: reenvio.id, inicio: reenvio.startDate, fim: reenvio.endDate,
            abono: reenvio.abonoDias, decimo: reenvio.decimo,
          }}
          onFechar={() => setReenvio(null)}
        />
      )}
      {reagendando && (
        <FeriasSolicitarDialog
          modo="reagendar"
          aquisitivos={null}
          feriados={feriados}
          hoje={hoje}
          // o DP com a dele; o próprio dono com a do colaborador; o gestor da equipe com a do gestor
          antecedencia={antecedencia[quemNo(reagendando.userId === meuId ? "colaborador" : "lancamento")]}
          antecedenciaQuem={quemNo(reagendando.userId === meuId ? "colaborador" : "lancamento")}
          prazos={prazos}
          pedidoEm={{
            abono: reagendando.abonoDias > 0 ? dataDoPedido(reagendando.createdAt) : null,
            decimo: reagendando.decimo ? dataDoPedido(reagendando.createdAt) : null,
          }}
          decimos={decimosDe(reagendando.userId, reagendando.id)}
          inicial={{
            id: reagendando.id, inicio: reagendando.startDate, fim: reagendando.endDate,
            abono: reagendando.abonoDias, decimo: reagendando.decimo,
          }}
          onFechar={() => setReagendando(null)}
        />
      )}
      {detalhe && (
        <DetalheFerias
          row={detalhe} meuId={meuId} ehDp={ehDp} ehOwner={ehOwner}
          onFechar={() => setDetalhe(null)}
          onReenviar={(r) => { setDetalhe(null); setReenvio(r); }}
          onReagendar={(r) => { setDetalhe(null); setReagendando(r); }}
          onEfetivar={(r) => { setDetalhe(null); setEfetivando(r); }}
          onDevolver={(r) => { setDetalhe(null); setNota({ row: r, acao: "devolver" }); }}
          onCancelar={(r) => { setDetalhe(null); setNota({ row: r, acao: "cancelar" }); }}
        />
      )}
      {efetivando && (
        <EfetivarDialog row={efetivando} onFechar={() => setEfetivando(null)}
          onDevolver={(r) => { setEfetivando(null); setNota({ row: r, acao: "devolver" }); }} />
      )}
      {nota && (
        <NotaDialog
          titulo={nota.acao === "devolver" ? "Devolver a previsão" : "Cancelar a previsão"}
          descricao={nota.acao === "devolver"
            ? `A previsão de ${shortName(nota.row.fullName)} volta para correção de quem abriu.`
            : `As férias de ${shortName(nota.row.fullName)} de ${formatDate(nota.row.startDate)} a ${formatDate(nota.row.endDate)} serão canceladas.`}
          rotuloConfirmar={nota.acao === "devolver" ? "Devolver" : "Cancelar previsão"}
          onConfirmar={async (texto) => {
            const r = nota.acao === "devolver"
              ? await decidirFerias({ id: nota.row.id, aprovar: false, nota: texto })
              : await cancelarFerias({ id: nota.row.id, nota: texto });
            if (r.error) return r.error;
            toast.success(r.message ?? "Feito.");
            setNota(null);
            router.refresh();
            return null;
          }}
          onFechar={() => setNota(null)}
        />
      )}
    </div>
    </>
  );
}

// ============================================================================
// Minhas férias
// ============================================================================

/**
 * De onde sai o saldo: o direito do aquisitivo menos o que a folha já registrou
 * como gozado e o que está previsto aqui. Escrito por extenso porque "18 dias
 * de saldo" sozinho não explica por que não são 30.
 */
function composicaoDoSaldo(a: AquisitivoInfo): string {
  const previstos = a.diasUsados - a.gozadosFolha - a.abonoUsado;
  const partes: string[] = [];
  if (a.gozadosFolha > 0) partes.push(`${a.gozadosFolha} já gozado(s)`);
  if (previstos > 0) partes.push(`${previstos} previsto(s)`);
  if (a.abonoUsado > 0) partes.push(`${a.abonoUsado} de abono`);
  const direito = `${a.diasDireito} dias de direito`;
  return partes.length ? `${direito}: ${partes.join(", ")}` : direito;
}

function MinhasFerias({
  minhas, aquisitivos, podeSolicitar, avisoSolicitar, onSolicitar, onReenviar, onDetalhe, onCancelar, onReagendar, hoje,
}: {
  minhas: FeriasRow[];
  aquisitivos: AquisitivoInfo[];
  podeSolicitar: boolean;
  avisoSolicitar: string | null;
  onSolicitar: () => void;
  onReenviar: (r: FeriasRow) => void;
  onDetalhe: (r: FeriasRow) => void;
  onCancelar: (r: FeriasRow) => void;
  onReagendar: (r: FeriasRow) => void;
  hoje: string;
}) {
  // sem saldo e sem nada usado é aquisitivo sem direito (faltas, afastamento): não há o que mostrar
  const relevantes = aquisitivos.filter((a) => !aquisitivoSemSaldo(a.situacao) || a.diasUsados > 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", paddingTop: "0.9rem" }}>
      {avisoSolicitar && (
        <div className="card card-pad" style={{ fontSize: "0.85rem" }}>
          {avisoSolicitar}
        </div>
      )}

      {relevantes.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "0.8rem" }}>
          {relevantes.slice(-4).map((a) => (
            <div key={a.aqInicio} className="card card-pad">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>Aquisitivo {rotuloAquisitivo(a)}</span>
                <Badge tone={FERIAS_AQUISITIVO_TONE[a.situacao] ?? "gray"}>
                  {FERIAS_AQUISITIVO_SITUACAO[a.situacao] ?? a.situacao}
                </Badge>
              </div>
              <p className="soft" style={{ fontSize: "0.76rem", margin: "0.25rem 0 0.6rem" }}>
                Gozar até {formatDate(a.concessivoFim)}
              </p>
              <div style={{ fontSize: "1.35rem", fontWeight: 700 }} className="tabular">
                {a.saldo} <span className="soft" style={{ fontSize: "0.8rem", fontWeight: 400 }}>dia(s) de saldo</span>
              </div>
              <p className="soft" style={{ fontSize: "0.76rem", margin: "0.3rem 0 0" }}>
                {composicaoDoSaldo(a)}
              </p>
            </div>
          ))}
        </div>
      )}

      {minhas.length === 0 ? (
        <EmptyState
          title="Nenhuma previsão de férias"
          description={podeSolicitar
            ? "Solicite as suas férias: o pedido vai ao seu gestor e depois ao departamento pessoal."
            : "Quando houver uma previsão para você, ela aparece aqui com o andamento."}
          action={podeSolicitar ? (
            <button type="button" className="btn btn-primary" onClick={onSolicitar}>
              <Plane size={15} aria-hidden /> Solicitar férias
            </button>
          ) : undefined}
        />
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Período</th>
                <th style={{ width: 70, textAlign: "right" }}>Dias</th>
                <th style={{ width: 80, textAlign: "right" }}>Abono</th>
                <th style={{ width: 170 }}>Aquisitivo</th>
                <th style={{ width: 360 }}>Situação</th>
                <th style={{ width: 210, textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {minhas.map((r) => (
                <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => onDetalhe(r)}>
                  <td style={{ fontWeight: 600 }}>
                    {formatDate(r.startDate)} a {formatDate(r.endDate)}
                    {r.status === "efetivada" && r.startDate <= hoje && r.endDate >= hoje && (
                      <span className="soft" style={{ fontWeight: 400 }}> · em gozo</span>
                    )}
                  </td>
                  <td className="tabular" style={{ textAlign: "right" }}>{r.dias}</td>
                  <td className="tabular" style={{ textAlign: "right" }}>{r.abonoDias || "—"}</td>
                  <td className="muted" style={{ fontSize: "0.82rem", whiteSpace: "nowrap" }}>{periodoAquisitivo(r.aquisitivoInicio, r.aquisitivoFim)}</td>
                  <td><SituacaoDoMeuPedido status={r.status} /></td>
                  <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "inline-flex", gap: "0.35rem" }}>
                      {r.status === "reprovada" && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onReenviar(r)}>
                          <Pencil size={13} aria-hidden /> Corrigir
                        </button>
                      )}
                      {(r.status === "solicitada" || r.status === "reprovada") && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onCancelar(r)}>
                          <Ban size={13} aria-hidden /> Cancelar
                        </button>
                      )}
                      {r.status === "efetivada" && r.startDate > hoje && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onReagendar(r)}>
                          <CalendarPlus size={13} aria-hidden /> Reagendar
                        </button>
                      )}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDetalhe(r)}>Detalhe</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * A situação do pedido pelos olhos de quem tirará as férias.
 *
 * Para o DP, "aprovada" é trabalho a fazer, e a tela dele segue em âmbar
 * ("Aguardando efetivação"). Para o colaborador é uma notícia boa pela metade:
 * o gestor já aprovou (verde), e falta o DP efetivar (âmbar, em andamento).
 * São duas pílulas de propósito, exceção à regra de uma por linha do
 * DESIGN.md: cada uma é uma etapa do trâmite (LUIZ, 06/11/2026).
 */
function SituacaoDoMeuPedido({ status }: { status: FeriasRow["status"] }) {
  if (status !== "aprovada") {
    return <Badge tone={FERIAS_STATUS_TONE[status]}>{FERIAS_STATUS[status]}</Badge>;
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
      <Badge tone="green">Aprovada pelo gestor</Badge>
      <Badge tone="amber">Aguardando efetivação do DP</Badge>
    </span>
  );
}

// ============================================================================
// Fila do gestor
// ============================================================================

function FilaGestor({
  fila, onDetalhe, onDevolver, soEquipe,
}: {
  fila: FeriasRow[];
  onDetalhe: (r: FeriasRow) => void;
  onDevolver: (r: FeriasRow) => void;
  /** a tela está em "Minha equipe" e há outra fila em "Toda a empresa" */
  soEquipe?: boolean;
}) {
  const [decidindo, iniciar] = useTransition();
  const router = useRouter();

  const aprovar = async (r: FeriasRow) => {
    const fora = rotuloForaPrazo(r);
    if (!(await confirmDialog({
      title: "Aprovar a previsão",
      message: `${shortName(r.fullName)}: ${formatDate(r.startDate)} a ${formatDate(r.endDate)} (${r.dias} dias${r.abonoDias ? ` + ${r.abonoDias} de abono` : ""}). A previsão segue para a efetivação do departamento pessoal.`
        + (fora ? ` Atenção: ${fora.toLowerCase()} legal, a empresa pode recusar. Aprovar é aceitar.` : ""),
      confirmLabel: "Aprovar",
    }))) return;
    iniciar(async () => {
      const res = await decidirFerias({ id: r.id, aprovar: true });
      if (res.error) { toast.error(res.error); return; }
      toast.success("Previsão aprovada.");
      router.refresh();
    });
  };

  return (
    <div style={{ paddingTop: "0.9rem" }}>
      {fila.length === 0 ? (
        <EmptyState
          title="Nada aguardando você"
          description={soEquipe
            ? "Nenhuma solicitação da sua equipe aguarda decisão. As das outras equipes estão em Toda a empresa."
            : "As solicitações da sua equipe aparecem aqui para aprovar ou devolver."}
        />
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th style={{ width: 150 }}>Setor</th>
                <th style={{ width: 190 }}>Período</th>
                <th style={{ width: 70, textAlign: "right" }}>Dias</th>
                <th style={{ width: 80, textAlign: "right" }}>Abono</th>
                <th style={{ width: 190 }}>Prazo legal</th>
                <th style={{ width: 250, textAlign: "right" }}>Decisão</th>
              </tr>
            </thead>
            <tbody>
              {fila.map((r) => (
                <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => onDetalhe(r)}>
                  <td style={{ fontWeight: 600 }}>{shortName(r.fullName)}</td>
                  <td className="muted" style={{ fontSize: "0.82rem" }}>{r.departmentName ?? "—"}</td>
                  <td>{formatDate(r.startDate)} a {formatDate(r.endDate)}</td>
                  <td className="tabular" style={{ textAlign: "right" }}>{r.dias}</td>
                  <td className="tabular" style={{ textAlign: "right" }}>{r.abonoDias || "—"}</td>
                  <td>
                    {rotuloForaPrazo(r)
                      ? <Badge variant="quiet" tone="amber">{rotuloForaPrazo(r)}</Badge>
                      : <span className="soft">—</span>}
                  </td>
                  <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "inline-flex", gap: "0.35rem" }}>
                      <button type="button" className="btn btn-primary btn-sm" disabled={decidindo} onClick={() => aprovar(r)}>
                        <Check size={13} aria-hidden /> Aprovar
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDevolver(r)}>
                        <Undo2 size={13} aria-hidden /> Devolver
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Minha equipe ou a empresa toda
// ============================================================================

type Escopo = "equipe" | "empresa";

/**
 * O recorte da tela de férias. Começa em "Minha equipe", a cadeia abaixo de
 * mim no organograma, a mesma de `manages_user`, que é quem eu decido como
 * gestor; "Toda a empresa" é o que o DP opera.
 */
function AlternadorDeEscopo({
  escopo, onMudar,
}: {
  escopo: Escopo;
  onMudar: (e: Escopo) => void;
}) {
  const opcoes: { id: Escopo; rotulo: string }[] = [
    { id: "equipe", rotulo: "Minha equipe" },
    { id: "empresa", rotulo: "Toda a empresa" },
  ];
  return (
    <div role="group" aria-label="Quem mostrar"
      style={{ display: "inline-flex", gap: "0.25rem", padding: "0.2rem", background: "var(--mh-surface-2)", borderRadius: "var(--mh-radius-full)", border: "1px solid var(--mh-border)" }}>
      {opcoes.map((o) => (
        <button key={o.id} type="button" aria-pressed={escopo === o.id}
          className={`btn btn-xs ${escopo === o.id ? "btn-primary" : "btn-ghost"}`}
          onClick={() => onMudar(o.id)}>
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// Fila do DP
// ============================================================================

function FilaDp({
  fila, soEquipe, onDetalhe, onEfetivar, onDevolver,
}: {
  fila: FeriasRow[];
  /** a tela está em "Minha equipe": o vazio aqui não quer dizer que a empresa não tem nada */
  soEquipe?: boolean;
  onDetalhe: (r: FeriasRow) => void;
  onEfetivar: (r: FeriasRow) => void;
  onDevolver: (r: FeriasRow) => void;
}) {
  if (fila.length === 0) {
    return (
      <div style={{ paddingTop: "0.9rem" }}>
        <EmptyState
          title="Nada para efetivar"
          description={soEquipe
            ? "Nenhuma previsão da sua equipe aguarda efetivação. As das outras equipes estão em Toda a empresa."
            : "Previsões aprovadas pelo gestor chegam aqui para o cálculo e a efetivação na folha."}
        />
      </div>
    );
  }
  return (
    <div className="card" style={{ overflowX: "auto", marginTop: "0.9rem" }}>
      <table className="table">
        <thead>
          <tr>
            <th>Colaborador</th>
            <th style={{ width: 150 }}>Setor</th>
            <th style={{ width: 190 }}>Período</th>
            <th style={{ width: 70, textAlign: "right" }}>Dias</th>
            <th style={{ width: 110 }}>Origem</th>
            <th style={{ width: 190 }}>Prazo legal</th>
            <th style={{ width: 230, textAlign: "right" }}>Efetivação</th>
          </tr>
        </thead>
        <tbody>
          {fila.map((r) => (
            <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => onDetalhe(r)}>
              <td style={{ fontWeight: 600 }}>{shortName(r.fullName)}</td>
              <td className="muted" style={{ fontSize: "0.82rem" }}>{r.departmentName ?? "—"}</td>
              <td>{formatDate(r.startDate)} a {formatDate(r.endDate)}</td>
              <td className="tabular" style={{ textAlign: "right" }}>{r.dias}</td>
              <td>
                {r.emDobro
                  ? <Badge variant="quiet" tone="red">Em dobro</Badge>
                  : r.reagendadaDe
                    ? <Badge variant="quiet" tone="amber">Reagendamento</Badge>
                    : r.lancadaPeloGestor
                      ? <Badge variant="quiet" tone="blue">Pelo gestor</Badge>
                      : <Badge variant="quiet" tone="gray">Solicitada</Badge>}
              </td>
              <td>
                {rotuloForaPrazo(r)
                  ? <Badge variant="quiet" tone="amber">{rotuloForaPrazo(r)}</Badge>
                  : <span className="soft">—</span>}
              </td>
              <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "inline-flex", gap: "0.35rem" }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => onEfetivar(r)}>
                    <Send size={13} aria-hidden /> Efetivar
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDevolver(r)}>
                    <Undo2 size={13} aria-hidden /> Devolver
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Tabela geral
// ============================================================================

function TabelaGeral({
  rows, onDetalhe,
}: {
  rows: FeriasRow[];
  onDetalhe: (r: FeriasRow) => void;
}) {
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("");

  const filtradas = useMemo(() => rows.filter((r) => {
    if (status && r.status !== status) return false;
    if (busca) {
      const q = normalizar(busca);
      const alvo = normalizar(`${r.fullName ?? ""} ${r.departmentName ?? ""} ${r.unitName ?? ""} ${r.employeeCode ?? ""}`);
      if (!alvo.includes(q)) return false;
    }
    return true;
  }), [rows, busca, status]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem", paddingTop: "0.9rem" }}>
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input" placeholder="Buscar por pessoa, matrícula, setor ou unidade…"
          value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 320 }}
        />
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 210 }}>
          <option value="">Todas as situações</option>
          {Object.entries(FERIAS_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="soft" style={{ fontSize: "0.8rem" }}>{filtradas.length} previsão(ões)</span>
        <div style={{ marginLeft: "auto" }}>
          <ExportButton
            filename="ferias"
            sheetName="Férias"
            headers={["Colaborador", "Matrícula", "Setor", "Unidade", "Início", "Término", "Dias", "Abono", "Aquisitivo", "Situação", "Aberta por"]}
            rows={filtradas.map((r) => [
              r.fullName, r.employeeCode, r.departmentName, r.unitName,
              formatDate(r.startDate), formatDate(r.endDate), r.dias, r.abonoDias,
              periodoAquisitivo(r.aquisitivoInicio, r.aquisitivoFim),
              FERIAS_STATUS[r.status], r.createdByName,
            ])}
          />
        </div>
      </div>

      {filtradas.length === 0 ? (
        <EmptyState title="Nada por aqui" description="Nenhuma previsão de férias com esses filtros." />
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th style={{ width: 140 }}>Setor</th>
                <th style={{ width: 110 }}>Unidade</th>
                <th style={{ width: 180 }}>Período</th>
                <th style={{ width: 64, textAlign: "right" }}>Dias</th>
                <th style={{ width: 170 }}>Aquisitivo</th>
                <th style={{ width: 220 }}>Situação</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((r) => (
                <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => onDetalhe(r)}>
                  <td style={{ fontWeight: 600 }}>{shortName(r.fullName)}</td>
                  <td className="muted" style={{ fontSize: "0.82rem" }}>{r.departmentName ?? "—"}</td>
                  <td className="muted" style={{ fontSize: "0.82rem" }}>{r.unitName ?? "—"}</td>
                  <td>{formatDate(r.startDate)} a {formatDate(r.endDate)}</td>
                  <td className="tabular" style={{ textAlign: "right" }}>{r.dias}</td>
                  <td className="muted" style={{ fontSize: "0.82rem", whiteSpace: "nowrap" }}>{periodoAquisitivo(r.aquisitivoInicio, r.aquisitivoFim)}</td>
                  <td><Badge tone={FERIAS_STATUS_TONE[r.status]}>{FERIAS_STATUS[r.status]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Detalhe
// ============================================================================

function DetalheFerias({
  row, meuId, ehDp, ehOwner, onFechar, onReenviar, onReagendar, onEfetivar, onDevolver, onCancelar,
}: {
  row: FeriasRow;
  meuId: string;
  ehDp: boolean;
  ehOwner: boolean;
  onFechar: () => void;
  onReenviar: (r: FeriasRow) => void;
  onReagendar: (r: FeriasRow) => void;
  onEfetivar: (r: FeriasRow) => void;
  onDevolver: (r: FeriasRow) => void;
  onCancelar: (r: FeriasRow) => void;
}) {
  const [excluindo, iniciar] = useTransition();
  const router = useRouter();

  const excluir = async () => {
    if (!(await confirmDialog({
      title: "Excluir o registro",
      message: "A exclusão apaga o registro do trâmite. O caminho normal é cancelar, que mantém o histórico. Excluir mesmo assim?",
      confirmLabel: "Excluir",
      tone: "danger",
    }))) return;
    iniciar(async () => {
      const r = await excluirFerias(row.id);
      if (r.error) { toast.error(r.error); return; }
      toast.success(r.message ?? "Excluído.");
      onFechar();
      router.refresh();
    });
  };

  const podeCancelar =
    (row.status === "solicitada" && (row.createdBy === meuId || ehDp))
    || (row.status === "reprovada" && (row.createdBy === meuId || ehDp))
    || (row.status === "aprovada" && ehDp)
    || (row.status === "efetivada" && ehOwner);

  return (
    <DetailModal
      open
      onClose={onFechar}
      title={shortName(row.fullName)}
      width="lg"
      badges={
        <>
          {row.userId === meuId
            ? <SituacaoDoMeuPedido status={row.status} />
            : <Badge tone={FERIAS_STATUS_TONE[row.status]}>{FERIAS_STATUS[row.status]}</Badge>}
          {row.emDobro && <Badge variant="quiet" tone="red">Em dobro</Badge>}
          {row.reagendadaDe && <Badge variant="quiet" tone="amber">Reagendamento</Badge>}
          {row.lancadaPeloGestor && <Badge variant="quiet" tone="blue">Lançada pelo gestor</Badge>}
          {row.decimo && <Badge variant="quiet" tone="gray">Adianta o 13º</Badge>}
          {rotuloForaPrazo(row) && <Badge variant="quiet" tone="amber">{rotuloForaPrazo(row)}</Badge>}
        </>
      }
      footer={
        <>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            {ehOwner && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={excluindo} onClick={excluir}>
                <Trash2 size={13} aria-hidden /> Excluir
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {row.status === "reprovada" && row.createdBy === meuId && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onReenviar(row)}>
                <Pencil size={13} aria-hidden /> Corrigir e reenviar
              </button>
            )}
            {row.status === "efetivada" && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onReagendar(row)}>
                <CalendarPlus size={13} aria-hidden /> Reagendar
              </button>
            )}
            {podeCancelar && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onCancelar(row)}>
                <Ban size={13} aria-hidden /> Cancelar
              </button>
            )}
            {row.status === "aprovada" && ehDp && (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDevolver(row)}>
                  <Undo2 size={13} aria-hidden /> Devolver
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => onEfetivar(row)}>
                  <Send size={13} aria-hidden /> Efetivar
                </button>
              </>
            )}
          </div>
        </>
      }
    >
      <FieldGrid>
        <Field label="Colaborador">{row.fullName}</Field>
        <Field label="Matrícula">{row.employeeCode}</Field>
        <Field label="Setor">{row.departmentName}</Field>
        <Field label="Subsetor">{row.subdepartmentName}</Field>
        <Field label="Função">{row.positionName}</Field>
        <Field label="Hierarquia">{row.hierarchyName}</Field>
        <Field label="Gestor">{row.managerName ? shortName(row.managerName) : null}</Field>
        <Field label="Unidade">{row.unitName}</Field>
      </FieldGrid>

      <DetailSection title="O período">
        <FieldGrid min={140}>
          <Field label="Início">{formatDate(row.startDate)}</Field>
          <Field label="Término">{formatDate(row.endDate)}</Field>
          <Field label="Dias de gozo">{String(row.dias)}</Field>
          <Field label="Abono pecuniário">{row.abonoDias ? `${row.abonoDias} dia(s)` : "Não"}</Field>
          <Field label="Aquisitivo">{`${formatDate(row.aquisitivoInicio)} a ${formatDate(row.aquisitivoFim)}`}</Field>
        </FieldGrid>
        {row.emDobro && (
          <p style={{ fontSize: "0.84rem", margin: "0.6rem 0 0", paddingLeft: "0.6rem", borderLeft: "2px solid var(--mh-danger)" }}>
            <strong>Férias em dobro</strong> (gozo depois do prazo de concessão, art. 137).
            {row.justificativaDobro ? ` Justificativa do DP: ${row.justificativaDobro}` : ""}
          </p>
        )}
        <NotaForaPrazo row={row} />
      </DetailSection>

      <DetailSection title="O trâmite">
        <FieldGrid min={180}>
          <Field label="Aberta por">{row.createdByName ? shortName(row.createdByName) : null}</Field>
          <Field label="Aberta em">{formatDateTime(row.createdAt)}</Field>
          {row.decidedAt && (
            <Field label={row.status === "reprovada" ? "Devolvida por" : "Aprovada por"}>
              {`${row.decidedByName ? shortName(row.decidedByName) : "—"} em ${formatDateTime(row.decidedAt)}`}
            </Field>
          )}
          {row.efetivadaAt && (
            <Field label="Efetivada por">{`${row.efetivadaByName ? shortName(row.efetivadaByName) : "—"} em ${formatDateTime(row.efetivadaAt)}`}</Field>
          )}
          {row.cancelledAt && <Field label="Cancelada em">{formatDateTime(row.cancelledAt)}</Field>}
        </FieldGrid>
        {row.decisionNote && (
          <p style={{ fontSize: "0.84rem", margin: "0.6rem 0 0", paddingLeft: "0.6rem", borderLeft: "2px solid var(--border)" }}>
            {row.decisionNote}
          </p>
        )}
        {row.efetivacaoNote && (
          <p className="soft" style={{ fontSize: "0.8rem", margin: "0.5rem 0 0" }}>Efetivação: {row.efetivacaoNote}</p>
        )}
        {row.cancelNote && (
          <p className="soft" style={{ fontSize: "0.8rem", margin: "0.5rem 0 0" }}>Cancelamento: {row.cancelNote}</p>
        )}
      </DetailSection>
    </DetailModal>
  );
}

// ============================================================================
// Efetivação (DP)
// ============================================================================

function EfetivarDialog({
  row, onFechar, onDevolver,
}: {
  row: FeriasRow;
  onFechar: () => void;
  onDevolver: (r: FeriasRow) => void;
}) {
  const [ctx, setCtx] = useState<ContextoEfetivacao | null | "carregando">("carregando");
  const [descontaRv, setDescontaRv] = useState(true);
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, iniciar] = useTransition();
  const router = useRouter();

  // o informativo chega por RPC (o RH não lê employee_absences direto)
  useEffect(() => {
    getContextoEfetivacao(row.id).then((c) => setCtx(c));
  }, [row.id]);

  const efetivar = () => {
    setErro("");
    iniciar(async () => {
      const r = await efetivarFerias({ id: row.id, descontaRv, nota: obs });
      if (r.error) { setErro(r.error); return; }
      toast.success("Férias efetivadas.");
      onFechar();
      router.refresh();
    });
  };

  const c = ctx === "carregando" ? null : ctx;

  return (
    <DetailModal
      open
      onClose={onFechar}
      title={`Efetivar: ${shortName(row.fullName)}`}
      width="md"
      badges={
        <>
          <Badge tone="amber">{FERIAS_STATUS.aprovada}</Badge>
          {row.emDobro && <Badge variant="quiet" tone="red">Em dobro</Badge>}
          {row.reagendadaDe && <Badge variant="quiet" tone="amber">Reagendamento</Badge>}
          {row.decimo && <Badge variant="quiet" tone="gray">Adianta o 13º</Badge>}
          {rotuloForaPrazo(row) && <Badge variant="quiet" tone="amber">{rotuloForaPrazo(row)}</Badge>}
        </>
      }
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDevolver(row)}>
            <Undo2 size={13} aria-hidden /> Devolver
          </button>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button type="button" className="btn btn-ghost" onClick={onFechar}>Cancelar</button>
            <button type="button" className="btn btn-primary" disabled={salvando} onClick={efetivar}>
              {salvando ? "Efetivando…" : "Confirmar efetivação"}
            </button>
          </div>
        </>
      }
    >
      <FieldGrid min={140}>
        <Field label="Período">{`${formatDate(row.startDate)} a ${formatDate(row.endDate)}`}</Field>
        <Field label="Dias de gozo">{String(row.dias)}</Field>
        <Field label="Abono">{row.abonoDias ? `${row.abonoDias} dia(s)` : "Não"}</Field>
        <Field label="Aquisitivo">{periodoAquisitivo(row.aquisitivoInicio, row.aquisitivoFim)}</Field>
        {c && <Field label="Saldo do aquisitivo">{`${c.saldo ?? "—"} dia(s)`}</Field>}
        {c?.concessivoFim && <Field label="Gozar até">{formatDate(c.concessivoFim)}</Field>}
      </FieldGrid>
      {row.emDobro && (
        <p style={{ fontSize: "0.84rem", margin: "0.6rem 0 0", paddingLeft: "0.6rem", borderLeft: "2px solid var(--mh-danger)" }}>
          <strong>Férias em dobro</strong>: o gozo termina depois do prazo de concessão (art. 137).
          {row.justificativaDobro ? ` Justificativa: ${row.justificativaDobro}` : ""}
        </p>
      )}
      <NotaForaPrazo row={row} />

      <DetailSection title={c?.origem === "folha" ? "Dados importados do aquisitivo" : "Informativo do art. 130 (faltas injustificadas)"}>
        {c == null ? (
          <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Carregando…</p>
        ) : (
          <>
            <FieldGrid min={160}>
              {c.origem === "folha" && (
                <>
                  <Field label="Direito no aquisitivo">{`${c.direitoFolha ?? "—"} dias`}</Field>
                  <Field label="Já gozados (importados)">{`${c.gozadosFolha ?? 0} dia(s)`}</Field>
                  {c.referencia && <Field label="Dados de">{formatDate(c.referencia)}</Field>}
                </>
              )}
              <Field label="Faltas registradas aqui">{`${c.faltasDias} dia(s) em ${c.faltasQtd} registro(s)`}</Field>
              {c.origem !== "folha" && <Field label="Direito pela tabela">{`${c.direitoArt130} dias`}</Field>}
            </FieldGrid>
            <p className="soft" style={{ fontSize: "0.76rem", margin: "0.5rem 0 0" }}>
              {c.origem === "folha"
                ? "O direito e os dias gozados vêm da última importação de períodos aquisitivos, que já considera as faltas do art. 130. Ao confirmar, o sistema confere de novo o saldo e o prazo."
                : "Só informação para o cálculo da folha: o sistema não reduz o saldo sozinho."}
              {c.origem !== "folha" && c.direitoArt130 < 30 ? " Atenção: pelas faltas registradas, o direito seria menor que 30 dias." : ""}
            </p>
            {c.irmas.length > 0 && (
              <p className="soft" style={{ fontSize: "0.76rem", margin: "0.4rem 0 0" }}>
                Outros períodos do mesmo aquisitivo: {c.irmas.map((i) => `${formatDate(i.inicio)} a ${formatDate(i.fim)} (${FERIAS_STATUS[i.status as Enums<"ferias_status">] ?? i.status})`).join("; ")}.
              </p>
            )}
          </>
        )}
      </DetailSection>

      <DetailSection title="Efetivação">
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.84rem", cursor: "pointer" }}>
          <input type="checkbox" checked={descontaRv} onChange={(e) => setDescontaRv(e.target.checked)} />
          Os dias contam na proporcionalidade da remuneração variável
        </label>
        <div style={{ marginTop: "0.6rem" }}>
          <label className="label">Observação da efetivação</label>
          <textarea
            className="input" rows={2} value={obs}
            placeholder="Ex.: calculada na folha de setembro."
            onChange={(e) => setObs(e.target.value)}
          />
        </div>
        {erro && (
          <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: "0.6rem 0 0", background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
            {erro}
          </p>
        )}
      </DetailSection>
    </DetailModal>
  );
}

// ============================================================================
// Visão geral (gestor e DP)
// ============================================================================

function VisaoGeral({
  painel, hoje, ultimaImportacao,
}: {
  painel: FeriasPainel;
  hoje: string;
  /** só o DP recebe */
  ultimaImportacao: UltimaImportacaoFolha | null;
}) {
  const comPendencia = painel.saldos.filter((s) => s.situacao === "vencida" || s.situacao === "a_vencer" || s.semFolha);
  const semFolhaQtd = painel.saldos.filter((s) => s.semFolha).length;
  const [mostrarTodos, setMostrarTodos] = useState(false);
  const listaSaldos = mostrarTodos ? painel.saldos : comPendencia;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", paddingTop: "0.9rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "0.8rem" }}>
        <div className="card card-pad">
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 0.6rem" }}>De férias agora</h3>
          {painel.agora.length === 0 ? (
            <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Ninguém em gozo hoje.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {painel.agora.map((a) => (
                <div key={`${a.userId}${a.inicio}`} style={{ display: "flex", gap: "0.5rem", alignItems: "baseline", fontSize: "0.84rem" }}>
                  <span style={{ fontWeight: 600 }}>{shortName(a.nome)}</span>
                  <span className="soft" style={{ fontSize: "0.76rem" }}>{a.setor ?? ""}</span>
                  <span className="soft" style={{ marginLeft: "auto", fontSize: "0.78rem" }}>volta {formatDate(somarDias(a.fim, 1))}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card card-pad">
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 0.6rem" }}>Próximas saídas (60 dias)</h3>
          {painel.proximas.length === 0 ? (
            <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Nenhuma saída marcada para os próximos 60 dias.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {painel.proximas.slice(0, 8).map((p) => (
                <div key={`${p.userId}${p.inicio}`} style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.84rem" }}>
                  <span style={{ fontWeight: 600 }}>{shortName(p.nome)}</span>
                  <Badge variant="quiet" tone={p.origem === "efetivada" ? "green" : "blue"}>
                    {p.origem === "efetivada" ? "Efetivada" : "Prevista"}
                  </Badge>
                  <span className="soft" style={{ marginLeft: "auto", fontSize: "0.78rem" }}>
                    {formatDate(p.inicio)} a {formatDate(p.fim)}
                  </span>
                </div>
              ))}
              {painel.proximas.length > 8 && (
                <p className="soft" style={{ fontSize: "0.76rem", margin: "0.2rem 0 0" }}>
                  e mais {painel.proximas.length - 8} na linha do tempo abaixo.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <FeriasTimeline
        linhas={painel.timeline}
        janelaInicio={painel.janelaInicio}
        janelaFim={painel.janelaFim}
        hoje={hoje}
      />

      <div className="card card-pad">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
          <div>
            <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: 0 }}>Saldos e prazos de concessão</h3>
            <p className="soft" style={{ fontSize: "0.76rem", margin: "0.2rem 0 0" }}>
              O próximo período aquisitivo a programar de cada colaborador. Vencida = a
              concessão passou do prazo e agora é em dobro (art. 137).
              {painel.usaFolha && " Os períodos, os dias de direito e os já gozados vêm da importação de períodos aquisitivos."}
              {" "}O status do colaborador vem dos afastamentos e licenças em vigor, lançados em Configurações.
            </p>
            {ultimaImportacao && (
              <p className="soft" style={{ fontSize: "0.76rem", margin: "0.2rem 0 0" }}>
                Última importação: dados de {formatDate(ultimaImportacao.referencia)}, importados
                em {formatDateTime(ultimaImportacao.importadoEm)}
                {ultimaImportacao.importadoPor ? ` por ${shortName(ultimaImportacao.importadoPor)}` : ""},
                {" "}{ultimaImportacao.pessoas} colaboradores.
                {semFolhaQtd > 0 && ` ${semFolhaQtd} ativo(s) sem período importado.`}
              </p>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMostrarTodos((v) => !v)}>
              {mostrarTodos ? "Ver só as pendências" : `Ver todos (${painel.saldos.length})`}
            </button>
          </div>
        </div>
        {listaSaldos.length === 0 ? (
          <p className="soft" style={{ fontSize: "0.82rem", margin: "0.7rem 0 0" }}>
            Nenhum período a vencer ou vencido, e ninguém sem período importado. Tudo em dia.
          </p>
        ) : (
          <div style={{ overflowX: "auto", marginTop: "0.7rem" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Colaborador</th>
                  <th style={{ width: 150 }}>Setor</th>
                  <th style={{ width: 170 }}>Aquisitivo</th>
                  <th style={{ width: 80, textAlign: "right" }}>Saldo</th>
                  <th style={{ width: 120 }}>Gozar até</th>
                  <th style={{ width: 130 }}>Situação</th>
                  <th style={{ width: 220 }}>Status do colaborador</th>
                </tr>
              </thead>
              <tbody>
                {listaSaldos.slice(0, 60).map((s) => (
                  <tr key={s.userId}>
                    <td style={{ fontWeight: 600 }}>{shortName(s.nome)}</td>
                    <td className="muted" style={{ fontSize: "0.82rem" }}>{s.setor ?? "—"}</td>
                    <td className="muted" style={{ fontSize: "0.82rem", whiteSpace: "nowrap" }}>
                      {s.aquisitivoInicio && s.aquisitivoFim ? periodoAquisitivo(s.aquisitivoInicio, s.aquisitivoFim) : "—"}
                    </td>
                    <td className="tabular" style={{ textAlign: "right" }}>{s.saldo}</td>
                    <td className="muted" style={{ fontSize: "0.82rem" }}>{s.gozarAte ? formatDate(s.gozarAte) : "—"}</td>
                    <td>
                      {s.semFolha ? (
                        // não é "em dia": a pessoa não veio no relatório, e sem ele
                        // não há saldo conferível (pedidos dela são recusados)
                        <Badge tone="amber">Sem período importado</Badge>
                      ) : s.situacao ? (
                        <Badge tone={FERIAS_AQUISITIVO_TONE[s.situacao] ?? "gray"}>
                          {FERIAS_AQUISITIVO_SITUACAO[s.situacao] ?? s.situacao}
                        </Badge>
                      ) : (
                        <Badge variant="quiet" tone="green">Em dia</Badge>
                      )}
                    </td>
                    <td>
                      {/* explica a situação: "Vencida" de quem está aposentado por
                          invalidez há anos não é atraso do gestor */}
                      <SituacaoBadge situacao={s.statusColaborador} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {listaSaldos.length > 60 && (
              <p className="soft" style={{ fontSize: "0.76rem", margin: "0.5rem 0 0" }}>
                Mostrando 60 de {listaSaldos.length}. Use a exportação de Todas as previsões para a lista completa.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Nota (devolver / cancelar)
// ============================================================================

function NotaDialog({
  titulo, descricao, rotuloConfirmar, onConfirmar, onFechar,
}: {
  titulo: string;
  descricao: string;
  rotuloConfirmar: string;
  /** devolve a mensagem de erro, ou null se deu certo */
  onConfirmar: (nota: string) => Promise<string | null>;
  onFechar: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, iniciar] = useTransition();

  const confirmar = () => {
    setErro("");
    if (!texto.trim()) { setErro("Informe o motivo."); return; }
    iniciar(async () => {
      const e = await onConfirmar(texto.trim());
      if (e) setErro(e);
    });
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "8vh 1rem", zIndex: 70, overflowY: "auto",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 480, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: 0 }}>{titulo}</h2>
          <button
            type="button" onClick={onFechar} className="muted" aria-label="Fechar"
            style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: "1.15rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.7rem" }}>
          <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>{descricao}</p>
          <div>
            <label className="label">Motivo <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <textarea className="input" rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} />
          </div>
          {erro && (
            <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
              {erro}
            </p>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onFechar}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={salvando} onClick={confirmar}>
            {salvando ? "Salvando…" : rotuloConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
