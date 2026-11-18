"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle, Ban, CalendarPlus, Check, Download, FileSpreadsheet, FileText, Mail, Paperclip, Pencil, Send, Sparkles, Stethoscope, X,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { DetailSection, Field, FieldGrid } from "@/components/ui/Field";
import { DetailModal } from "@/components/ui/DetailModal";
import { Tabs, type Tab } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { ExportButton } from "@/components/ui/ExportButton";
import { Dropdown } from "@/components/ui/Dropdown";
import { IconImport } from "@/components/ui/ImpExpIcons";
import { PeoplePicker } from "@/components/PeoplePicker";
import { confirmDialog } from "@/components/ui/confirm";
import { formatDate, normalizar, shortName } from "@/lib/format";
import { formatCpf } from "@/lib/cpf";
import {
  ABSENCE_KIND_LABEL, ABSENCE_KIND_TONE,
  ABSENTEISMO_STATUS, ABSENTEISMO_STATUS_TONE, GRAUS_PARENTESCO, SEM_RETORNO,
} from "@/lib/constants";
import {
  anexarDocumentoAbsenteismo, buscarCid, cancelarAbsenteismo, comunicarAberturaPendente, confirmarAbsenteismo, continuaAusente,
  encerrarFaltaSemTermino,
  decidirAbsenteismo, getAlertaInss, getAtestado, getCpfDoLancamento, getDocumentoAbsenteismoUrl,
  lancarNaoComparecimento, reenviarComunicado, removerDocumentoAbsenteismo,
  salvarConfirmacao,
  lerAtestadoComIA,
  type AlertaInss, type AtestadoLido, type ConfirmacaoInput,
} from "@/lib/actions/absenteismos";
import { RelatorioAbsenteismoDialog } from "@/components/RelatorioAbsenteismoDialog";
import { efeitoNaRv } from "@/lib/absenteismo-efeito-rv";
import { nomeParaBaixar, rotuloTipoDocumento } from "@/lib/absenteismo-documento";
import { ImportarHistoricoAbsenteismo } from "@/components/ImportarHistoricoAbsenteismo";
import { ImportarComunicadosAbsenteismo } from "@/components/ImportarComunicadosAbsenteismo";
// só o tipo: o módulo é de servidor, e "use server" não pode reexportar tipo (quebra o arquivo de actions inteiro)
import type { AtestadoLidoPorIA } from "@/lib/atestado-ia";
import type { Enums } from "@/types/database";

export type AbsenteismoRow = {
  id: string;
  status: Enums<"absenteismo_status">;
  userId: string;
  occurredOn: string;
  reasonNote: string | null;
  absenceTypeId: string | null;
  typeName: string | null;
  kind: Enums<"absence_kind"> | null;
  requiresDocument: boolean;
  requiresMedical: boolean;
  startDate: string | null;
  endDate: string | null;
  discountsRv: boolean | null;
  note: string | null;
  kinship: string | null;
  workAccident: boolean;
  certificateKind: string | null;
  waived: boolean;
  hoursStart: string | null;
  hoursEnd: string | null;
  /** trabalhou parte do dia, com ou sem horário ainda (LUIZ, 12/11/2026) */
  partialDay: boolean;
  /**
   * Primeiro dia do atestado (LUIZ, 12/11/2026): "trabalhou" o dia todo ou
   * "parcial" (horas em hoursStart/hoursEnd). O período segue o documento.
   */
  primeiroDia: PrimeiroDia;
  /** primeiro dia INTEIRO de ausência, calculado no banco */
  ausenciaInicio: string | null;
  /**
   * "Continua ausente" (LUIZ, 17/11/2026): último dia registrado sem comparecer.
   * De occurredOn a ausenteAte são os dias acumulados no lançamento em aberto.
   */
  ausenteAte: string | null;
  fullName: string | null;
  employeeCode: string | null;
  departmentName: string | null;
  subdepartmentName: string | null;
  positionName: string | null;
  managerName: string | null;
  unitName: string | null;
  docPath: string | null;
  docFilename: string | null;
  createdBy: string;
  createdByName: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  cancelledAt: string | null;
  cancelNote: string | null;
  emailStatus: string | null;
  emailAt: string | null;
  /** veio da importação de histórico: aprovado, sem comunicado e sem anexo */
  importado: boolean;
  /**
   * Veio da importação de comunicados (LUIZ, 17/11/2026): entrou em aberto, sem
   * e-mail, no nome do gestor atual (createdBy), e segue o fluxo normal.
   */
  comunicadoImportado: boolean;
  /** quem importou o comunicado */
  importadoPorName: string | null;
  /**
   * Falta sem data de término (LUIZ, 17/11/2026): enquanto segue, endDate é
   * SEM_RETORNO; encerrada, vira o último dia de falta e a marca fica.
   */
  faltaContinua: boolean;
  /** o término veio do desligamento do colaborador */
  faltaEncerradaNoDesligamento: boolean;
};

/** altura dos botões da coluna Ações: todos iguais, para a linha não pular */
const ALTURA_ACAO = 28;

/** a falta sem término que ainda segue (enviada ao RH ou aprovada) */
function semTerminoAberto(r: Pick<AbsenteismoRow, "faltaContinua" | "endDate" | "status">): boolean {
  return r.faltaContinua && r.endDate === SEM_RETORNO && (r.status === "pendente" || r.status === "aprovado");
}

export type Pessoa = {
  id: string;
  name: string;
  matricula: string | null;
  setor: string | null;
  subsetor: string | null;
  funcao: string | null;
  gestor: string | null;
  unidade: string | null;
};

type Tipo = {
  id: string;
  name: string;
  description: string | null;
  kind: Enums<"absence_kind">;
  requiresDocument: boolean;
  requiresMedical: boolean;
  requiresCompanion: boolean;
  requiresKinship: boolean;
  discountsRvDefault: boolean;
  active: boolean;
};

type PrimeiroDia = "integral" | "trabalhou" | "parcial";

type Confirmacao = {
  absenceTypeId: string;
  startDate: string;
  endDate: string;
  note: string;
  parentesco: string;
  acidenteTrabalho: boolean;
  tipoAtestado: string;
  /** afastamento: "medico" | "pericia_inss"; começa em branco e é obrigatório no envio */
  tipoDocumento: string;
  abonada: boolean;
  cid: string;
  cidDescricao: string;
  medico: string;
  crm: string;
  local: string;
  emitidoEm: string;
  emHoras: boolean;
  horaInicio: string;
  horaFim: string;
  /** só vale em período de 2 dias ou mais, fora da ausência de horas */
  primeiroDia: PrimeiroDia;
  acompanhado: string;
  /** falta sem data de término (LUIZ, 17/11/2026); só vale com motivo de falta */
  semTermino: boolean;
};

/**
 * Reduz a foto para a leitura com IA (o anexo guardado continua o original):
 * foto de celular passa de 4000 px e vários MB, e a IA lê bem com 2000 px.
 * PDF e o que o navegador não abre (HEIC fora do Safari) seguem como vieram.
 */
async function reduzirParaLeitura(f: File): Promise<File> {
  if (!f.type.startsWith("image/") || f.size < 1_500_000) return f;
  try {
    const img = await createImageBitmap(f);
    const escala = Math.min(1, 2000 / Math.max(img.width, img.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(img.width * escala);
    cv.height = Math.round(img.height * escala);
    cv.getContext("2d")?.drawImage(img, 0, 0, cv.width, cv.height);
    const blob: Blob | null = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.85));
    return blob ? new File([blob], f.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : f;
  } catch {
    return f;
  }
}

/** Dias corridos do período, contando os dois extremos. */
function diasDoPeriodo(inicio: string, fim: string): number | null {
  if (!inicio || !fim) return null;
  const n = Math.round((Date.parse(fim) - Date.parse(inicio)) / 86400000) + 1;
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/** O dia seguinte de uma data ISO (AAAA-MM-DD), sem passar por fuso. */
function diaSeguinte(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** O dia anterior de uma data ISO (AAAA-MM-DD), sem passar por fuso. */
function diaAnterior(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** "09/11" de uma data ISO. */
const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * Os dias sem comparecer acumulados pelo "Continua ausente" (LUIZ, 17/11/2026),
 * quando passam de um. null = só o dia do lançamento.
 */
function semComparecer(r: Pick<AbsenteismoRow, "occurredOn" | "ausenteAte">): { inicio: string; fim: string; dias: number } | null {
  if (!r.ausenteAte || r.ausenteAte <= r.occurredOn) return null;
  return { inicio: r.occurredOn, fim: r.ausenteAte, dias: diasDoPeriodo(r.occurredOn, r.ausenteAte) ?? 0 };
}

/**
 * Os dias sem comparecer que o documento não cobre: no envio ao RH eles viram
 * falta, num lançamento à parte. Mesma conta da RPC
 * `absenteismo_confirmar_e_separar`. null = o documento não cobre nenhum deles.
 */
function diasForaDoDocumento(
  sem: { inicio: string; fim: string }, inicio: string, fim: string, primeiroDia: PrimeiroDia,
): [string, string][] | null {
  // o primeiro dia trabalhado do documento não cobre ausência
  const cobre = primeiroDia === "trabalhou" ? diaSeguinte(inicio) : inicio;
  if (cobre > fim || cobre > sem.fim || fim < sem.inicio) return null;
  const blocos: [string, string][] = [];
  if (sem.inicio < cobre) blocos.push([sem.inicio, diaAnterior(cobre)]);
  if (sem.fim > fim) blocos.push([diaSeguinte(fim), sem.fim]);
  return blocos;
}

/** "16/11/2026" ou "16/11/2026 a 17/11/2026". */
const intervalo = ([a, b]: [string, string]) => (a === b ? formatDate(a) : `${formatDate(a)} a ${formatDate(b)}`);

/**
 * O primeiro dia que vale de fato: só em período de 2 dias ou mais, e nunca
 * na ausência de horas (que é de um dia só).
 */
function primeiroDiaQueVale(c: Pick<Confirmacao, "emHoras" | "startDate" | "endDate" | "primeiroDia">): PrimeiroDia {
  return !c.emHoras && (diasDoPeriodo(c.startDate, c.endDate) ?? 0) >= 2 ? c.primeiroDia : "integral";
}

/**
 * O resumo do "Enviar ao RH": rótulo e valor em duas colunas, o motivo maior
 * e em negrito, o aviso da falta à parte em amarelo e a trava no fim.
 */
function ResumoDoEnvio({ itens, avisoFalta }: { itens: [string, string, boolean?][]; avisoFalta: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
      <span>Confira antes de enviar:</span>
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.3rem 0.8rem", margin: 0, alignItems: "baseline" }}>
        {itens.map(([rotulo, valor, destaque]) => (
          <div key={rotulo} style={{ display: "contents" }}>
            <dt style={{ fontSize: "0.78rem" }}>{rotulo}</dt>
            <dd style={{
              margin: 0, color: "var(--mh-text-1)", minWidth: 0, overflowWrap: "anywhere",
              fontWeight: destaque ? 700 : 500, fontSize: destaque ? "0.98rem" : "0.86rem",
            }}>
              {valor}
            </dd>
          </div>
        ))}
      </dl>
      {avisoFalta && (
        <p style={{ fontSize: "0.82rem", margin: 0, color: "var(--mh-text-1)", background: "var(--mh-warning-soft)", padding: "0.5rem 0.65rem", borderRadius: 8, borderLeft: "3px solid var(--mh-warning)" }}>
          {avisoFalta}
        </p>
      )}
      <span>Depois de enviado, o lançamento fica congelado até o RH decidir. Para corrigir algo, será preciso pedir a reprovação.</span>
    </div>
  );
}

/** O dia de HOJE do navegador. No servidor, em UTC, viraria amanhã às 21h. */
const hoje = () => {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
};

/**
 * A tela do processo de absenteísmo.
 *
 * Três abas sobre a mesma lista: "Em aberto" é o que foi lançado e ainda não tem
 * motivo confirmado; "Aguardando o RH" é a fila de quem decide; "Histórico" é o
 * que já foi decidido.
 *
 * O bloco de atestado (CID, médico, local) só aparece quando o TIPO exige, e o
 * dado é buscado sob demanda pela RPC, nunca junto da lista.
 */
export function AbsenteismosManager({
  rows, pessoas, tipos, unidades, kindsComRedutor, meuId, podeDecidir, podeCancelarAprovado, podeImportarHistorico,
}: {
  rows: AbsenteismoRow[];
  pessoas: Pessoa[];
  tipos: Tipo[];
  /** para o filtro do relatório do RH */
  unidades: { id: string; name: string }[];
  /**
   * Comportamentos que já têm faixa de redutor ativa em Remuneração variável.
   * A tela usa para dizer ao gestor o efeito real do tipo escolhido, em vez de
   * deixá-lo adivinhar.
   */
  kindsComRedutor: Enums<"absence_kind">[];
  meuId: string;
  podeDecidir: boolean;
  podeCancelarAprovado: boolean;
  /** importação do histórico: só o proprietário (LUIZ, 16/11/2026) */
  podeImportarHistorico: boolean;
}) {
  const [novo, setNovo] = useState<
    {
      userId: string; occurredOn: string; reasonNote: string; emHoras: boolean; horaInicio: string; horaFim: string;
      /**
       * "Já sei o motivo e já recebi o documento" (LUIZ, 11/11/2026): a janela já
       * é o formulário do Efetivar, e o lançamento só nasce no envio ao RH
       */
      comMotivo: boolean;
    } | null
  >(null);
  const [confirmando, setConfirmando] = useState<AbsenteismoRow | null>(null);
  // o lançamento do "Já sei o motivo" que foi gravado mas não chegou ao RH (o
  // envio falhou no meio): ao fechar a janela, sai o aviso de abertura
  const [semComunicado, setSemComunicado] = useState<string | null>(null);
  // o mesmo valor em ref: o fechamento logo depois do envio ainda enxergaria o estado velho
  const semComunicadoRef = useRef<string | null>(null);
  const marcarSemComunicado = (id: string | null) => { semComunicadoRef.current = id; setSemComunicado(id); };
  const [aberto, setAberto] = useState<AbsenteismoRow | null>(null);
  // cancelar um lançamento em aberto direto da lista (LUIZ, 12/11/2026)
  const [cancelando, setCancelando] = useState<AbsenteismoRow | null>(null);
  // "Continua ausente" (LUIZ, 17/11/2026)
  const [continuando, setContinuando] = useState<AbsenteismoRow | null>(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  // os diálogos do menu Planilhas moram fora dele: fechar o menu os desmontaria
  const [relatorioAberto, setRelatorioAberto] = useState(false);
  const [importarAberto, setImportarAberto] = useState(false);
  const [importarComunicados, setImportarComunicados] = useState(false);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const tiposAtivos = tipos.filter((t) => t.active);
  const pessoaPorId = useMemo(() => new Map(pessoas.map((p) => [p.id, p])), [pessoas]);

  // "Faltas sem término" (LUIZ, 17/11/2026): quem segue faltando, sem data
  const [soSemTermino, setSoSemTermino] = useState(false);
  const [aba, setAba] = useState<string | undefined>(undefined);
  const quantosSemTermino = rows.filter(semTerminoAberto).length;

  const filtrar = (lista: AbsenteismoRow[]) => {
    const q = normalizar(busca.trim());
    const base = soSemTermino ? lista.filter(semTerminoAberto) : lista;
    if (!q) return base;
    return base.filter((r) =>
      [r.fullName, r.typeName, r.employeeCode, r.departmentName]
        .some((v) => v && normalizar(v).includes(q)));
  };

  // O reprovado volta ao gestor (LUIZ, 17/11/2026): fica também em "Em aberto",
  // no topo, porque é trabalho dele corrigir e reenviar. Só no Histórico ele
  // sumia no meio do que já foi encerrado.
  const emAberto = filtrar([
    ...rows.filter((r) => r.status === "reprovado"),
    ...rows.filter((r) => r.status === "aberto"),
  ]);
  const fila = filtrar(rows.filter((r) => r.status === "pendente"));
  const historico = filtrar(rows.filter((r) =>
    r.status === "aprovado" || r.status === "reprovado" || r.status === "cancelado"));

  /** "Ainda não sei o motivo": grava e comunica na hora; o resto vem pelo Efetivar. */
  const lancar = () => {
    if (!novo) return;
    setErro("");
    const n = novo;
    iniciar(async () => {
      // o que vai ao servidor é só o que ele grava, e as horas só quando a
      // ausência é de horas: a marcação é estado de tela, não dado do lançamento
      const r = await lancarNaoComparecimento({
        userId: n.userId,
        occurredOn: n.occurredOn,
        reasonNote: n.reasonNote,
        horaInicio: n.emHoras ? n.horaInicio : "",
        horaFim: n.emHoras ? n.horaFim : "",
        parcial: n.emHoras,
      });
      if (r.error) { setErro(r.error); return; }
      setNovo(null);
      if (r.warning) setErro(r.warning);
    });
  };

  /**
   * Fecha o "Lançar ausência". Se o caminho com o motivo gravou o lançamento e o
   * envio ao RH falhou depois, ele fica em aberto como qualquer outro, e o RH
   * precisa saber: sai o aviso de abertura (uma vez só).
   */
  const fecharNovo = () => {
    setNovo(null);
    setErro("");
    const id = semComunicadoRef.current;
    if (!id) return;
    marcarSemComunicado(null);
    void comunicarAberturaPendente(id).then((r) => {
      if (r.error || r.warning) setErro(r.error ?? r.warning ?? "");
      else if (r.message) toast.success(r.message);
      router.refresh();
    });
  };

  const fecharEfetivar = () => { setConfirmando(null); setErro(""); };

  // o registro do Efetivar acompanha a lista: o anexo enviado aparece na hora
  const linhaConfirmando = confirmando ? rows.find((r) => r.id === confirmando.id) ?? confirmando : null;

  const abrirDocumento = async (path: string) => {
    const url = await getDocumentoAbsenteismoUrl(path);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  // O link já volta como download, com o nome no cabeçalho da resposta: a
  // página não sai do lugar e funciona igual no celular (LUIZ, 17/11/2026).
  const baixarDocumento = async (path: string, nome: string) => {
    const url = await getDocumentoAbsenteismoUrl(path, nome);
    if (!url) { toast.error("Não foi possível baixar o documento."); return; }
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const podeMexer = (r: AbsenteismoRow) =>
    (r.status === "aberto" || r.status === "reprovado")
    && (r.createdBy === meuId || podeDecidir);

  /** "09:00 às 11:00", ou vazio quando a ausência é do dia inteiro. */
  const faixaDeHoras = (inicio: string | null, fim: string | null) =>
    inicio ? `${inicio.slice(0, 5)} às ${fim?.slice(0, 5) ?? "?"}` : "";

  /**
   * O horário da linha: o da ausência de horas, ou o do primeiro dia parcial
   * (com o dia na frente, porque os dias inteiros começam no seguinte).
   */
  /**
   * Horário inicial e final da ausência de horas (ou do 1º dia parcial), em duas
   * colunas na planilha (LUIZ, 16/11/2026). Parcial ainda sem horário: "A confirmar".
   */
  const horariosDaLinha = (r: AbsenteismoRow): [string, string] => {
    if (!r.partialDay && r.primeiroDia !== "parcial") return ["", ""];
    if (!r.hoursStart) return [r.partialDay ? "A confirmar" : "", ""];
    return [r.hoursStart.slice(0, 5), r.hoursEnd?.slice(0, 5) ?? ""];
  };

  /**
   * Quanto durou: horas quando é ausência parcial, dias quando cobre o período.
   *
   * As duas unidades na mesma coluna porque a pergunta é uma só, e porque
   * "0 dias" para quem saiu seis horas seria pior que não dizer nada. Horas têm
   * precedência: existindo horário, o período é sempre o mesmo dia.
   */
  const duracao = (r: AbsenteismoRow): string => {
    if (r.partialDay) {
      if (!r.hoursStart || !r.hoursEnd) return "Parcial";
      const minutos = Math.round((Date.parse(`1970-01-01T${r.hoursEnd}`) - Date.parse(`1970-01-01T${r.hoursStart}`)) / 60000);
      if (!Number.isFinite(minutos) || minutos <= 0) return "";
      const h = Math.floor(minutos / 60);
      const m = minutos % 60;
      return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
    }
    // falta sem término: os dias contados até hoje
    if (r.startDate && r.endDate === SEM_RETORNO) {
      const d = diasDoPeriodo(r.ausenciaInicio ?? r.startDate, hoje());
      return d === null ? "" : `${d} dia${d === 1 ? "" : "s"} até hoje`;
    }
    if (r.startDate && r.endDate) {
      // os dias que valem: o primeiro dia trabalhado (todo ou parte) não conta
      const d = diasDoPeriodo(r.ausenciaInicio ?? r.startDate, r.endDate);
      return d === null ? "" : `${d} dia${d === 1 ? "" : "s"}`;
    }
    // em aberto, sem período ainda: os dias acumulados pelo "Continua ausente"
    const sem = r.status === "aberto" ? semComparecer(r) : null;
    if (sem) return `${sem.dias} dias`;
    return "";
  };

  /** o complemento da duração que antes ia numa segunda linha: agora na mesma, cortado se preciso */
  const detalheDaDuracao = (r: AbsenteismoRow): string => {
    if (r.partialDay) return r.hoursStart ? faixaDeHoras(r.hoursStart, r.hoursEnd) : "horário a confirmar";
    if (r.primeiroDia === "trabalhou" && r.startDate) return `trabalhou em ${diaMes(r.startDate)}`;
    if (r.primeiroDia === "parcial" && r.startDate) {
      return r.hoursStart ? `+ ${faixaDeHoras(r.hoursStart, r.hoursEnd)} em ${diaMes(r.startDate)}` : `+ horas em ${diaMes(r.startDate)}`;
    }
    if (!r.startDate && r.status === "aberto" && semComparecer(r)) return "sem comparecer";
    return "";
  };

  /** texto que pode passar da coluna: cortado com reticências, completo na dica */
  const corta = (texto: string | null | undefined, largura: number) =>
    texto
      ? <span className="cell-trunc" style={{ maxWidth: largura }} title={texto}>{texto}</span>
      : <span className="soft">–</span>;

  // Uma linha por lançamento (LUIZ, 17/11/2026): nada quebra; a matrícula tem
  // coluna própria, antes do nome, e o que não cabe vira reticências com o
  // dado completo na dica.
  const linha = (r: AbsenteismoRow, comAutor: boolean) => {
    const dur = duracao(r);
    const det = dur ? detalheDaDuracao(r) : "";
    const autor = r.importado
      ? { texto: "Importação", dica: r.createdByName ? `Importado por ${r.createdByName}` : "Importação" }
      : r.comunicadoImportado
        ? {
            texto: "Importação",
            dica: [r.importadoPorName && `Importado por ${r.importadoPorName}`, r.createdByName && `com ${r.createdByName}`]
              .filter(Boolean).join(", ") || "Importação",
          }
        : r.createdByName ? { texto: shortName(r.createdByName), dica: r.createdByName } : null;
    return (
      <tr key={r.id}>
        {/* As ações na frente (LUIZ, 17/11/2026): no fim da linha elas sumiam
            atrás da rolagem lateral em tela menor. Ordem dele: Efetivar,
            Continua ausente, Cancelar, Ver. Botões compactos (btn-xs), todos na
            mesma altura, e "Continua ausente" em duas linhas para ocupar menos
            largura (LUIZ, 17/11/2026). */}
        {/* centralizada como o cabeçalho: no Histórico, só o Ver fica no meio */}
        <td style={{ textAlign: "center" }}>
          <span style={{ display: "inline-flex", gap: "0.25rem", alignItems: "center" }}>
            {/* Botão com NOME, não ícone: efetivar é o passo central do fluxo, e
                escondê-lo num lápis fez parecer que o comunicado ia direto ao RH. */}
            {podeMexer(r) && (
              <button
                type="button" className="btn btn-primary btn-xs" style={{ height: ALTURA_ACAO }}
                onClick={() => { setErro(""); setConfirmando(r); }}
              >
                <Pencil size={12} /> Efetivar
              </button>
            )}
            {/* segue sem aparecer e sem notícia: mais um dia no MESMO lançamento,
                com aviso aos destinatários (LUIZ, 17/11/2026). A ausência
                parcial é de um dia só. Com o nome (o LUIZ pediu de volta). */}
            {r.status === "aberto" && podeMexer(r) && !r.partialDay && (
              <button
                // mais folga dos lados que o btn-xs (LUIZ, 17/11/2026: ficou espremido)
                type="button" className="btn btn-ghost btn-xs"
                style={{ height: ALTURA_ACAO, paddingInline: "0.7rem", gap: "0.4rem" }}
                title="Continua ausente: o colaborador segue sem comparecer e sem informar o motivo"
                onClick={() => { setErro(""); setContinuando(r); }}
              >
                <CalendarPlus size={12} />
                <span style={{ lineHeight: 1.15, textAlign: "left" }}>Continua<br />ausente</span>
              </button>
            )}
            {/* a ausência não se confirmou (a pessoa chegou depois das primeiras
                horas): cancela e pede ao RH para desconsiderar o comunicado */}
            {r.status === "aberto" && podeMexer(r) && (
              <button
                type="button" className="icon-btn"
                title="Cancelar: a ausência não se confirmou (o colaborador chegou depois, por exemplo)"
                aria-label="Cancelar lançamento"
                style={{ color: "var(--mh-danger)", width: ALTURA_ACAO, height: ALTURA_ACAO }}
                onClick={() => { setErro(""); setCancelando(r); }}
              >
                <Ban size={13} />
              </button>
            )}
            <button
              type="button" className="icon-btn" title="Ver"
              style={{ width: ALTURA_ACAO, height: ALTURA_ACAO }}
              onClick={() => setAberto(r)}
            >
              <FileText size={13} />
            </button>
          </span>
        </td>
        <td className="tabular muted">{r.employeeCode ?? <span className="soft">–</span>}</td>
        {/* o nome reduzido (LUIZ, 12/11/2026); o completo na dica, na planilha e no relatório */}
        <td>
          <span className="cell-trunc" style={{ maxWidth: 150, fontWeight: 600 }} title={r.fullName ?? undefined}>
            {r.fullName ? shortName(r.fullName) : "Sem nome"}
          </span>
        </td>
        <td className="muted">{corta(r.departmentName, 100)}</td>
        <td className="muted">{corta(r.positionName, 120)}</td>
        {/* Só o motivo (LUIZ, 16/11/2026): o comportamento fica na ficha e na planilha. */}
        <td>
          {/* a coluna já se chama Motivo: não repete a palavra (LUIZ, 17/11/2026) */}
          {r.typeName ? corta(r.typeName, 120) : <span className="soft">Não confirmado</span>}
        </td>
        {/* Sem efetivação ainda não há período: o dia do lançamento entra aqui,
            apagado, para a linha não perder a única data que possui. */}
        <td>
          {r.startDate
            ? formatDate(r.startDate)
            : <span className="soft" title="Dia do lançamento. O período é definido na efetivação.">{formatDate(r.occurredOn)}</span>}
        </td>
        <td>
          {r.endDate === SEM_RETORNO
            ? <span title="Falta sem data de término: segue faltando">Sem término</span>
            : r.endDate
            ? formatDate(r.endDate)
            : r.status === "aberto" && r.ausenteAte && r.ausenteAte > r.occurredOn
              ? <span className="soft" title="Último dia registrado sem comparecer. O período é definido na efetivação.">{formatDate(r.ausenteAte)}</span>
              : <span className="soft">–</span>}
        </td>
        <td>
          {dur ? (
            <span className="cell-trunc" style={{ maxWidth: 130 }} title={det ? `${dur}, ${det}` : dur}>
              {dur}{det && <span className="soft"> · {det}</span>}
            </span>
          ) : <span className="soft">–</span>}
        </td>
        {comAutor && (
          <td className={r.importado || r.comunicadoImportado ? "muted" : undefined}>
            {autor
              ? <span className="cell-trunc" style={{ maxWidth: 125 }} title={autor.dica}>{autor.texto}</span>
              : <span className="soft">–</span>}
          </td>
        )}
        <td>
          {/* o porquê da reprovação à vista, na mesma linha do selo */}
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", maxWidth: 300 }}>
            <Badge tone={ABSENTEISMO_STATUS_TONE[r.status]}>{ABSENTEISMO_STATUS[r.status]}</Badge>
            {r.status === "reprovado" && r.decisionNote && (
              <span className="cell-trunc soft" style={{ maxWidth: 100 }} title={`RH: ${r.decisionNote}`}>
                RH: {r.decisionNote}
              </span>
            )}
          </span>
        </td>
        <td style={{ textAlign: "center" }}>
          {r.docPath && (
            <button
              type="button" className="icon-btn"
              title={`Abrir ${r.docFilename ?? "documento"}`} aria-label={`Abrir ${r.docFilename ?? "documento"}`}
              onClick={() => abrirDocumento(r.docPath as string)}
            >
              <Paperclip size={14} />
            </button>
          )}
        </td>
        <td style={{ textAlign: "center" }}>
          {/* Os três estados do comunicado se leem pela cor, sem abrir nada:
              verde saiu, vermelho falhou, apagado não tinha para quem mandar. */}
          {r.emailStatus === "sent" && (
            <span title="Comunicado enviado" style={{ color: "var(--mh-success)", display: "inline-flex" }}>
              <Mail size={14} aria-label="Comunicado enviado" />
            </span>
          )}
          {r.emailStatus === "failed" && (
            <span title="O comunicado não pôde ser enviado" style={{ color: "var(--mh-danger)", display: "inline-flex" }}>
              <Mail size={14} />
            </span>
          )}
          {r.emailStatus === "skipped" && (
            <span title="Nenhum destinatário configurado" className="soft" style={{ display: "inline-flex" }}>
              <Mail size={14} />
            </span>
          )}
        </td>
      </tr>
    );
  };

  const tabela = (lista: AbsenteismoRow[], comAutor: boolean, vazio: string) =>
    lista.length === 0 ? (
      <EmptyState title="Nada por aqui" description={vazio} />
    ) : (
      // a rolagem lateral mora aqui dentro, e não no corpo da página
      <div style={{ overflowX: "auto" }}>
      <table className="table table-linha">
        <thead>
          <tr>
            <th style={{ textAlign: "center" }}>Ações</th>
            <th>Matrícula</th>
            <th>Colaborador</th>
            <th>Setor</th>
            <th>Função</th>
            <th>Motivo</th>
            <th>Início</th>
            <th>Fim</th>
            <th title="Horas quando a ausência é parcial; dias quando cobre o período inteiro">Duração</th>
            {comAutor && <th>Lançado por</th>}
            <th>Situação</th>
            {/* quem já tem documento, sem abrir a ficha (LUIZ, 17/11/2026) */}
            <th style={{ textAlign: "center" }} title="Clipe: o lançamento tem documento anexado. Clique para abrir.">
              Anexo
            </th>
            {/* Escrito, e não o ícone sozinho: o cabeçalho é onde a pessoa
                descobre o que a coluna significa. */}
            <th style={{ textAlign: "center" }} title="Comunicado por e-mail. Verde: enviado. Vermelho: falhou. Apagado: sem destinatário cadastrado.">
              Comunicado
            </th>
          </tr>
        </thead>
        <tbody>{lista.map((r) => linha(r, comAutor))}</tbody>
      </table>
      </div>
    );

  const abas: Tab[] = [
    {
      id: "abertos", label: `Em aberto (${emAberto.length})`,
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
            Comunicados registrados, ainda sem definição. Nada daqui foi ao RH nem conta como
            ausência: quando a situação estiver confirmada (atestado em mãos, falta assumida),
            use <strong>Efetivar</strong> para informar o motivo, o período real e os documentos.
            Os lançamentos reprovados pelo RH também voltam para cá, no topo: corrija pelo
            <strong> Efetivar</strong> e envie de novo.
          </p>
          {tabela(emAberto, true, "Nenhuma ausência em aberto. Quando alguém faltar ou sair por algumas horas, lance por aqui.")}
        </div>
      ),
    },
  ];
  if (podeDecidir) {
    abas.push({
      id: "fila", label: `Aguardando o RH (${fila.length})`,
      content: tabela(fila, true, "Nenhum lançamento aguardando decisão."),
    });
  }
  abas.push({
    id: "historico", label: `Histórico (${historico.length})`,
    content: tabela(historico, true, "Nenhum lançamento decidido ainda."),
  });

  const pessoaEscolhida = novo?.userId ? pessoaPorId.get(novo.userId) ?? null : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input" placeholder="Buscar por colaborador, motivo ou setor…"
          value={busca} onChange={(e) => setBusca(e.target.value)} style={{ maxWidth: 340 }}
        />
        {(quantosSemTermino > 0 || soSemTermino) && (
          <button
            type="button"
            className={`btn btn-sm ${soSemTermino ? "btn-primary" : "btn-ghost"}`}
            aria-pressed={soSemTermino}
            title="Faltas lançadas sem data de término, que seguem em aberto"
            onClick={() => {
              const liga = !soSemTermino;
              setSoSemTermino(liga);
              // as aprovadas moram no Histórico
              if (liga) setAba("historico");
            }}
          >
            Faltas sem término ({quantosSemTermino})
          </button>
        )}
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginLeft: "auto", flexWrap: "wrap" }}>
          {(() => {
            /* Sem CID nem médico na planilha: o arquivo sai do sistema e vai
               parar em pasta compartilhada, e-mail e pen drive. */
            const exportar = (
              <ExportButton
                filename="absenteismos.xlsx"
                sheetName="Absenteísmos"
                colunasDeData={["Dia", "Início", "Término"]}
                // mesma sequência do Relatório completo (LUIZ, 16/11/2026), com
                // as colunas que o gestor pode ver
                headers={["Unidade", "Matrícula", "Colaborador", "Setor", "Função", "Dia", "Início", "Término", "Duração", "Horário inicial", "Horário final", "Motivo", "Situação", "Efeito na RV", "Lançado por", "Decidido por", "Observação da decisão"]}
                rows={rows.map((r) => {
                  const [horaIni, horaFim] = horariosDaLinha(r);
                  return [
                    r.unitName ?? "", r.employeeCode ?? "", r.fullName ?? "", r.departmentName ?? "", r.positionName ?? "",
                    r.occurredOn,
                    // em aberto com "Continua ausente": os dias sem comparecer
                    r.startDate ?? (r.status === "aberto" && semComparecer(r) ? r.occurredOn : ""),
                    r.endDate === SEM_RETORNO ? "" : r.endDate ?? (r.status === "aberto" && semComparecer(r) ? r.ausenteAte ?? "" : ""),
                    duracao(r), horaIni, horaFim,
                    r.typeName ?? "", ABSENTEISMO_STATUS[r.status],
                    efeitoNaRv({
                      status: r.status, kind: r.kind, descontaRv: r.discountsRv, abonada: r.waived, horas: r.partialDay,
                    }, kindsComRedutor),
                    r.importado || r.comunicadoImportado ? "Importação" : r.createdByName ?? "",
                    r.decidedByName ?? "", r.decisionNote ?? "",
                  ];
                })}
              />
            );
            // A exportação simples é a do GESTOR, que não vê CPF nem dado de
            // saúde. Quem decide (proprietário, administrador, RH) usa só o
            // Relatório completo, que tem tudo o que a simples tinha (LUIZ,
            // 16/11/2026): as duas lado a lado só confundiam.
            if (!podeDecidir) return exportar;
            // Planilhas num menu só (LUIZ, 16/11/2026): botões lado a lado
            // pesavam na barra
            return (
              <Dropdown rotulo="Planilhas" pequeno alinharDireita largura={250}>
                {(fechar) => (
                  <>
                    {podeDecidir && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRelatorioAberto(true); fechar(); }}>
                        <FileSpreadsheet size={15} /> Relatório completo
                      </button>
                    )}
                    {podeImportarHistorico && (
                      <>
                        <div style={{ borderTop: "1px solid var(--border)", margin: "0.15rem 0" }} />
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setImportarAberto(true); fechar(); }}>
                          <IconImport /> Importar histórico
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setImportarComunicados(true); fechar(); }}>
                          <IconImport /> Importar comunicados
                        </button>
                      </>
                    )}
                  </>
                )}
              </Dropdown>
            );
          })()}
          <button
            type="button" className="btn btn-primary btn-sm"
            onClick={() => { setErro(""); setNovo({ userId: "", occurredOn: hoje(), reasonNote: "", emHoras: false, horaInicio: "", horaFim: "", comMotivo: false }); }}
          >
            + Lançar ausência
          </button>
        </div>
      </div>

      {podeDecidir && (
        <RelatorioAbsenteismoDialog unidades={unidades} aberto={relatorioAberto} onFechar={() => setRelatorioAberto(false)} />
      )}
      {podeImportarHistorico && (
        <ImportarHistoricoAbsenteismo aberto={importarAberto} onFechar={() => setImportarAberto(false)} />
      )}
      {podeImportarHistorico && (
        <ImportarComunicadosAbsenteismo aberto={importarComunicados} onFechar={() => setImportarComunicados(false)} />
      )}

      {erro && !novo && !confirmando && !aberto && (
        <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>
      )}

      <Tabs tabs={abas} active={aba} onActiveChange={setAba} />

      {/* ---------------- lançamento da ausência ---------------- */}
      {novo && (
        <Dialogo titulo="Lançar ausência" onFechar={fecharNovo}>
          {/* dois caminhos num botão só (LUIZ, 11/11/2026) */}
          <div role="group" aria-label="Você já sabe o motivo?" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.5rem" }}>
            {([
              [false, "Ainda não sei o motivo e/ou ainda não recebi o atestado/documento comprobatório", "Comunica agora. O motivo e o documento entram depois, pelo Efetivar."],
              [true, "Já sei o motivo e já recebi o atestado/documento comprobatório", "Lança e envia ao RH de uma vez."],
            ] as [boolean, string, string][]).map(([v, titulo, texto]) => {
              const ativo = novo.comMotivo === v;
              return (
                <button
                  key={titulo} type="button" aria-pressed={ativo}
                  // depois de gravado (envio que falhou no meio), o caminho não troca mais
                  disabled={Boolean(semComunicado) && !ativo}
                  onClick={() => setNovo((n) => (n ? { ...n, comMotivo: v } : n))}
                  style={{
                    textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", padding: "0.65rem 0.8rem",
                    borderRadius: "var(--mh-radius-lg)", display: "flex", flexDirection: "column", gap: "0.2rem",
                    border: `1px solid ${ativo ? "var(--mh-primary-500)" : "var(--border)"}`,
                    background: ativo ? "var(--mh-primary-soft)" : "var(--surface)",
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: "0.86rem" }}>{titulo}</span>
                  <span className="soft" style={{ fontSize: "0.76rem", lineHeight: 1.35 }}>{texto}</span>
                </button>
              );
            })}
          </div>

          <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>
            {novo.comMotivo
              ? "Preencha o motivo, o período e o documento. O lançamento é gravado no envio, e um comunicado só sai para o RH."
              : <>
                  {novo.emHoras
                    ? "Use quando o colaborador trabalhou parte do dia (chegou atrasado ou saiu mais cedo) e o motivo ainda não é conhecido ou o atestado ainda não foi entregue."
                    : "Use quando o colaborador não apareceu e o motivo ainda não é conhecido, ou o atestado ainda não foi entregue."}{" "}
                  O comunicado por e-mail sai na hora, para os endereços definidos em Configurações.
                  Quando o motivo estiver confirmado, volte na aba Em aberto e use Efetivar.
                </>}
          </p>

          <div>
            <label className="label">Colaborador <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            {semComunicado ? (
              // já gravado para esta pessoa (o envio falhou no meio): ela não troca mais
              <div className="input" style={{ background: "var(--surface-2)" }}>{pessoaEscolhida?.name ?? "—"}</div>
            ) : (
              <PeoplePicker
                people={pessoas.map((p) => ({ id: p.id, name: p.name }))}
                selected={novo.userId ? [novo.userId] : []}
                onChange={(ids) => setNovo((n) => (n ? { ...n, userId: ids[0] ?? "" } : n))}
                placeholder="Buscar na sua equipe…"
                single
              />
            )}
          </div>

          {pessoaEscolhida && (
            <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", background: "var(--surface-2)", padding: "0.75rem" }}>
              <p className="soft" style={{ fontSize: "0.72rem", margin: "0 0 0.4rem" }}>
                Do cadastro do colaborador, congelado no lançamento.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.5rem 1rem" }}>
                <Campo rotulo="Matrícula" valor={pessoaEscolhida.matricula} />
                <Campo rotulo="Setor" valor={pessoaEscolhida.setor} />
                <Campo rotulo="Função" valor={pessoaEscolhida.funcao} />
                <Campo rotulo="Gestor imediato" valor={pessoaEscolhida.gestor} />
                <Campo rotulo="Unidade" valor={pessoaEscolhida.unidade} />
              </div>
            </div>
          )}

          {novo.comMotivo ? (
            novo.userId ? (
              <PainelConfirmacao
                key={novo.userId}
                linha={null}
                novoPara={{ userId: novo.userId, nome: pessoaEscolhida?.name }}
                tipos={tiposAtivos}
                kindsComRedutor={kindsComRedutor}
                onErro={setErro}
                erro={erro}
                onAbrirDocumento={abrirDocumento}
                onBaixarDocumento={baixarDocumento}
                onCriado={marcarSemComunicado}
                // enviado ao RH: o comunicado saiu no envio, não há aviso pendente
                onEnviado={() => { marcarSemComunicado(null); setNovo(null); setErro(""); }}
                onFechar={fecharNovo}
              />
            ) : (
              <>
                <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>Escolha o colaborador para preencher o motivo e o documento.</p>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={fecharNovo}>Cancelar</button>
                </div>
              </>
            )
          ) : (
            <>
          {/* Dia e horário juntos, porque são a mesma pergunta: QUANDO.
              A marcação usa a mesma frase do Efetivar de propósito: quem lança
              aqui vai reencontrá-la lá, já preenchida, e duas palavras diferentes
              para a mesma coisa fariam parecer que são duas coisas. Aqui o
              horário é opcional (LUIZ, 12/11/2026): o gestor sabe que a pessoa
              trabalhou parte do dia, nem sempre as horas; no Efetivar ele vira
              obrigatório. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.8rem", alignItems: "end" }}>
            <div>
              <label className="label">Dia <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input
                type="date" className="input" value={novo.occurredOn}
                onChange={(e) => setNovo((n) => (n ? { ...n, occurredOn: e.target.value } : n))}
              />
            </div>
            {novo.emHoras && (
              <>
                <div>
                  <label className="label">Das <span className="soft" style={{ textTransform: "none", fontWeight: 400 }}>(se souber)</span></label>
                  <input
                    type="time" className="input" value={novo.horaInicio}
                    onChange={(e) => setNovo((n) => (n ? { ...n, horaInicio: e.target.value } : n))}
                  />
                </div>
                <div>
                  <label className="label">Até <span className="soft" style={{ textTransform: "none", fontWeight: 400 }}>(se souber)</span></label>
                  <input
                    type="time" className="input" value={novo.horaFim}
                    onChange={(e) => setNovo((n) => (n ? { ...n, horaFim: e.target.value } : n))}
                  />
                </div>
              </>
            )}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.82rem", cursor: "pointer" }}>
            <input
              type="checkbox" checked={novo.emHoras}
              onChange={(e) => {
                const emHoras = e.target.checked;
                setNovo((n) => (n ? { ...n, emHoras, horaInicio: emHoras ? n.horaInicio : "", horaFim: emHoras ? n.horaFim : "" } : n));
              }}
            />
            O colaborador trabalhou parte do dia (chegou atrasado ou saiu mais cedo)
          </label>

          {novo.emHoras && (
            <p className="soft" style={{ fontSize: "0.78rem", margin: 0, background: "var(--surface-2)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
              Se souber o horário, informe; senão, ele entra no Efetivar, onde passa a ser obrigatório.
              O horário sai no relatório do RH, para o desconto ser feito na folha. Ausência parcial
              não entra no cálculo da remuneração variável.
            </p>
          )}

          <div>
            <label className="label">O que se sabe até agora</label>
            <textarea
              className="input" rows={3} value={novo.reasonNote}
              placeholder="Ex.: não avisou nada até agora; avisou por mensagem que passaria no médico."
              onChange={(e) => setNovo((n) => (n ? { ...n, reasonNote: e.target.value } : n))}
            />
            {/* escreveu que já tem o atestado: o caminho completo poupa a volta pelo Efetivar */}
            {/\b(atestado|declara[çc][ãa]o)\b/i.test(novo.reasonNote) && (
              <p style={{ fontSize: "0.78rem", margin: "0.4rem 0 0", display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
                <span className="soft">Já está com o atestado?</span>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => setNovo((n) => (n ? { ...n, comMotivo: true } : n))}>
                  Lançar já com o motivo
                </button>
              </p>
            )}
          </div>

          {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>}

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={pendente} onClick={lancar}>
              {pendente ? "Lançando…" : "Lançar e comunicar"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={fecharNovo}>Cancelar</button>
          </div>
            </>
          )}
        </Dialogo>
      )}

      {/* ---------------- efetivação ---------------- */}
      {linhaConfirmando && (
        <Dialogo titulo="Efetivar a ausência" onFechar={fecharEfetivar}>
          <PainelConfirmacao
            key={linhaConfirmando.id}
            linha={linhaConfirmando}
            tipos={tiposAtivos}
            kindsComRedutor={kindsComRedutor}
            onErro={setErro}
            erro={erro}
            onAbrirDocumento={abrirDocumento}
            onBaixarDocumento={baixarDocumento}
            onFechar={fecharEfetivar}
          />
        </Dialogo>
      )}

      {/* ---------------- ficha ---------------- */}
      {aberto && (
        <Dialogo titulo="Absenteísmo" onFechar={() => { setAberto(null); setErro(""); }}>
          <Ficha
            // a linha da lista, para o anexo recém-enviado ao importado aparecer
            linha={rows.find((r) => r.id === aberto.id) ?? aberto}
            kindsComRedutor={kindsComRedutor}
            podeDecidir={podeDecidir}
            podeCancelarAprovado={podeCancelarAprovado}
            podeCancelarProprio={aberto.createdBy === meuId || podeDecidir}
            erro={erro}
            onErro={setErro}
            onAbrirDocumento={abrirDocumento}
            onBaixarDocumento={baixarDocumento}
            onEfetivar={podeMexer(aberto) ? () => { const r = aberto; setAberto(null); setErro(""); setConfirmando(r); } : undefined}
            onFechar={() => { setAberto(null); setErro(""); }}
          />
        </Dialogo>
      )}

      {cancelando && <CancelarAberto linha={cancelando} onFechar={() => setCancelando(null)} />}
      {continuando && <ContinuaAusente linha={continuando} onFechar={() => setContinuando(null)} />}
    </div>
  );
}

/**
 * "Continua ausente" (LUIZ, 17/11/2026): o colaborador do lançamento em aberto
 * segue sem aparecer e sem dar notícia. O dia entra no MESMO lançamento (um
 * segundo "não comparecimento" virava outra ausência, com outro Efetivar) e os
 * destinatários do comunicado recebem o aviso do novo dia.
 */
function ContinuaAusente({ linha, onFechar }: { linha: AbsenteismoRow; onFechar: () => void }) {
  const ultimo = linha.ausenteAte && linha.ausenteAte > linha.occurredOn ? linha.ausenteAte : linha.occurredOn;
  const minimo = diaSeguinte(ultimo);
  const maximo = hoje();
  const emDia = minimo > maximo;
  const [ate, setAte] = useState(emDia ? "" : maximo);
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const dias = ate ? diasDoPeriodo(linha.occurredOn, ate) : null;

  const registrar = () => {
    if (!ate) { setErro("Informe até que dia o colaborador segue sem comparecer."); return; }
    setErro("");
    iniciar(async () => {
      const r = await continuaAusente(linha.id, ate);
      if (r.error) { setErro(r.error); return; }
      if (r.warning) toast.warning(r.warning);
      else toast.success(r.message ?? "Registrado.");
      onFechar();
    });
  };

  return (
    <DetailModal
      open onClose={onFechar} width="sm" title="Continua ausente"
      footer={
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="button" className="btn btn-primary btn-sm" disabled={pendente || emDia} onClick={registrar}>
            <CalendarPlus size={14} /> {pendente ? "Registrando…" : "Registrar e avisar"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={onFechar}>Voltar</button>
        </div>
      }
    >
      <p style={{ margin: 0, fontSize: "0.88rem" }}>
        <strong title={linha.fullName ?? undefined}>{shortName(linha.fullName)}</strong>, sem comparecer desde{" "}
        {formatDate(linha.occurredOn)}
        {ultimo !== linha.occurredOn ? `, registrado até ${formatDate(ultimo)}` : ""}.
      </p>
      {emDia ? (
        <p className="soft" style={{ margin: 0, fontSize: "0.82rem" }}>
          A ausência já está registrada até hoje. Amanhã, se o colaborador continuar sem comparecer, registre de novo.
        </p>
      ) : (
        <>
          <div style={{ maxWidth: 220 }}>
            <label className="label">Sem comparecer até <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <input
              type="date" className="input" value={ate} min={minimo} max={maximo}
              onChange={(e) => setAte(e.target.value)}
            />
          </div>
          {dias !== null && dias > 1 && (
            <p style={{ margin: 0, fontSize: "0.84rem" }}>
              Fica <strong>{formatDate(linha.occurredOn)} a {formatDate(ate)} ({dias} dias)</strong> no mesmo
              lançamento. No Efetivar, o período já vem com esses dias.
            </p>
          )}
          <p className="soft" style={{ margin: 0, fontSize: "0.82rem" }}>
            Use quando o colaborador não compareceu em nenhum dia desde {formatDate(linha.occurredOn)}. Se ele
            veio em algum dia no meio, efetive este lançamento até o último dia de ausência e lance a nova
            ausência à parte. Os destinatários do comunicado recebem um e-mail avisando que ele continua ausente.
          </p>
        </>
      )}
      {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>}
    </DetailModal>
  );
}

/**
 * Cancelar um lançamento em aberto (LUIZ, 12/11/2026): o colaborador não veio
 * nas primeiras horas, o gestor comunicou, e depois ele chegou. O lançamento
 * fica como cancelado e, se o comunicado tinha saído, os mesmos destinatários
 * recebem o pedido para desconsiderá-lo.
 */
function CancelarAberto({ linha, onFechar }: { linha: AbsenteismoRow; onFechar: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const comunicou = linha.emailStatus === "sent";

  const cancelar = () => {
    if (!motivo.trim()) { setErro("Informe o motivo do cancelamento."); return; }
    setErro("");
    const fd = new FormData();
    fd.set("id", linha.id);
    fd.set("nota", motivo);
    iniciar(async () => {
      const r = await cancelarAbsenteismo(fd);
      if (r.error) { setErro(r.error); return; }
      if (r.warning) toast.warning(r.warning);
      else toast.success(r.message ?? "Lançamento cancelado.");
      onFechar();
    });
  };

  return (
    <DetailModal
      open onClose={onFechar} width="sm" title="Cancelar o lançamento"
      footer={
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="button" className="btn btn-danger btn-sm" disabled={pendente} onClick={cancelar}>
            <Ban size={14} /> {pendente ? "Cancelando…" : "Cancelar o lançamento"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={onFechar}>Voltar</button>
        </div>
      }
    >
      <p style={{ margin: 0, fontSize: "0.88rem" }}>
        <strong title={linha.fullName ?? undefined}>{shortName(linha.fullName)}</strong>, ausência comunicada
        em {formatDate(linha.occurredOn)}.
      </p>
      <p className="soft" style={{ margin: 0, fontSize: "0.82rem" }}>
        Use quando a ausência não se confirmou, por exemplo quando o colaborador chegou depois das
        primeiras horas. O lançamento fica registrado como cancelado.
        {comunicou
          ? " Quem recebeu o comunicado recebe um e-mail pedindo para desconsiderá-lo."
          : " Nenhum comunicado tinha saído, então nenhum e-mail é enviado."}
      </p>
      <div>
        <label className="label">Motivo do cancelamento <span style={{ color: "var(--mh-danger)" }}>*</span></label>
        <textarea
          className="input" rows={2} value={motivo} autoFocus
          placeholder="O colaborador chegou às 10h; não houve ausência."
          onChange={(e) => setMotivo(e.target.value)}
        />
      </div>
      {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>}
    </DetailModal>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  // delega para a primitiva da ficha (DESIGN.md): rótulo uppercase fraco,
  // valor no tom pleno, vazio = travessão
  return <Field label={rotulo}>{valor}</Field>;
}

/** Fecha por X ou pelo botão, nunca por clique no fundo. */
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
      <div className="card" style={{ width: "100%", maxWidth: 760, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>{titulo}</h2>
          <button type="button" onClick={onFechar} className="muted" aria-label="Fechar"
            style={{ background: "none", border: "none", cursor: "pointer", lineHeight: 1, display: "flex" }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Busca na tabela CID-10 oficial (DATASUS), no servidor: são ~14 mil códigos,
 * e mandar o catálogo inteiro ao navegador por causa de um campo não faz
 * sentido. Escolher preenche código E descrição; digitada, a descrição chegava
 * errada ao RH.
 */
function BuscaCid({
  code, onEscolha, destaque,
}: {
  code: string;
  onEscolha: (code: string, descricao: string) => void;
  /** veio da leitura com IA: borda amarela até o gestor mexer */
  destaque?: boolean;
}) {
  const [q, setQ] = useState("");
  const [opcoes, setOpcoes] = useState<{ code: string; description: string }[]>([]);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    const termo = q.trim();
    if (termo.length < 2) return;
    let vivo = true;
    const h = setTimeout(() => {
      buscarCid(termo).then((r) => { if (vivo) setOpcoes(r); });
    }, 250);
    return () => { vivo = false; clearTimeout(h); };
  }, [q]);

  const visiveis = q.trim().length >= 2 ? opcoes : [];

  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) { setAberto(false); setQ(""); }
  };

  return (
    <div onBlur={handleBlur} style={{ position: "relative" }}>
      {code ? (
        <div className="input" style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", overflow: "hidden",
          ...(destaque ? { borderColor: "var(--mh-warning)", boxShadow: "0 0 0 1px var(--mh-warning)" } : {}),
        }}>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{code}</span>
          <button
            type="button" onClick={() => onEscolha("", "")} aria-label="Limpar"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "1rem", lineHeight: 1, flexShrink: 0 }}
          >
            ×
          </button>
        </div>
      ) : (
        <input
          className="input"
          value={q}
          placeholder="Código ou doença…"
          onFocus={() => setAberto(true)}
          onChange={(e) => { setQ(e.target.value); setAberto(true); }}
        />
      )}
      {aberto && !code && visiveis.length > 0 && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, minWidth: 260, zIndex: 20, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, boxShadow: "var(--mh-shadow-e3)", maxHeight: 240, overflowY: "auto" }}>
          {visiveis.map((o) => (
            <button
              key={o.code}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onEscolha(o.code, o.description); setQ(""); setAberto(false); }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "0.45rem 0.7rem", background: "none", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer", fontSize: "0.85rem" }}
            >
              <strong>{o.code}</strong> <span className="soft">{o.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * O que a confirmação descobriu.
 *
 * As exigências vêm do tipo escolhido, e não da tela: escolher "Atestado" abre o
 * bloco clínico e trava o envio sem o documento.
 */
function PainelConfirmacao({
  linha, novoPara, tipos, kindsComRedutor, erro, onErro, onAbrirDocumento, onBaixarDocumento, onCriado, onEnviado, onFechar,
}: {
  /** o lançamento a efetivar; null no lançamento novo já com o motivo */
  linha: AbsenteismoRow | null;
  /** "Já sei o motivo" (LUIZ, 11/11/2026): para quem é; o lançamento só nasce no envio */
  novoPara?: { userId: string; nome?: string };
  tipos: Tipo[];
  kindsComRedutor: Enums<"absence_kind">[];
  erro: string;
  onErro: (m: string) => void;
  onAbrirDocumento: (path: string) => void;
  onBaixarDocumento: (path: string, nome: string) => void;
  /** o lançamento novo foi gravado (o envio pode ainda falhar depois) */
  onCriado?: (id: string) => void;
  /** chamado depois do envio ao RH dar certo, antes de fechar */
  onEnviado?: () => void;
  onFechar: () => void;
}) {
  const userId = linha?.userId ?? novoPara?.userId ?? "";
  // O motivo começa em branco nos dois caminhos (LUIZ, 16 e 17/11/2026): vindo
  // preenchido com o primeiro do catálogo ("Licença"), passava sem ninguém
  // conferir e um atestado foi ao RH como licença. Só volta o que já foi
  // gravado (rascunho ou reprovado). No lançamento novo as datas também
  // começam em branco; no Efetivar elas partem do dia já lançado.
  const [c, setC] = useState<Confirmacao>({
    absenceTypeId: linha?.absenceTypeId ?? "",
    startDate: linha?.startDate ?? linha?.occurredOn ?? "",
    // com "Continua ausente", o período parte dos dias sem comparecer; a falta
    // sem término guarda 9999, que não é data para o campo
    endDate: (linha?.endDate === SEM_RETORNO ? null : linha?.endDate) ?? linha?.ausenteAte ?? linha?.occurredOn ?? "",
    note: linha?.note ?? "",
    parentesco: linha?.kinship ?? "",
    acidenteTrabalho: linha?.workAccident ?? false,
    // a mesma coluna guarda o tipo do atestado e o do documento do afastamento:
    // cada campo só aproveita o valor que é dele
    tipoAtestado: linha?.certificateKind === "odontologico" ? "odontologico" : "medico",
    tipoDocumento: linha?.kind === "afastamento"
      && (linha.certificateKind === "medico" || linha.certificateKind === "pericia_inss")
      ? linha.certificateKind : "",
    abonada: linha?.waived ?? false,
    cid: "", cidDescricao: "", medico: "", crm: "", local: "", emitidoEm: "",
    // só o marcador: com o primeiro dia parcial há horário sem o lançamento ser de horas
    emHoras: Boolean(linha?.partialDay),
    horaInicio: linha?.hoursStart?.slice(0, 5) ?? "",
    horaFim: linha?.hoursEnd?.slice(0, 5) ?? "",
    primeiroDia: linha?.primeiroDia ?? "integral",
    acompanhado: "",
    semTermino: Boolean(linha?.faltaContinua && linha.endDate === SEM_RETORNO),
  });
  const [inss, setInss] = useState<AlertaInss | null>(null);
  const [temDoc, setTemDoc] = useState(Boolean(linha?.docPath));
  // no lançamento novo o arquivo fica na tela até o envio (ainda não há onde guardá-lo)
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [arquivoSubiu, setArquivoSubiu] = useState(false);
  const [criadoId, setCriadoId] = useState<string | null>(null);
  // leitura do atestado com IA (LUIZ, 11/11/2026): opcional; os campos que vieram
  // dela ficam marcados até o gestor mexer, e o aviso amarelo fica até o fim
  const [camposIA, setCamposIA] = useState<Set<string>>(new Set());
  const [usouIA, setUsouIA] = useState(false);
  const [lendoIA, setLendoIA] = useState(false);
  const [avisoIA, setAvisoIA] = useState("");
  const seletorIA = useRef<HTMLInputElement>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  const ehNovo = !linha;

  const tipo = tipos.find((t) => t.id === c.absenceTypeId) ?? null;
  // afastamento: o documento é médico ou da perícia do INSS (LUIZ, 17/11/2026)
  const pedeTipoDocumento = tipo?.kind === "afastamento" && !tipo.requiresMedical;
  // falta sem término (LUIZ, 17/11/2026): só com motivo de falta; o fim vai 9999
  const semTermino = c.semTermino && tipo?.kind === "falta";
  const fimEfetivo = semTermino ? SEM_RETORNO : c.endDate;
  const primeiroDia = semTermino ? "integral" : primeiroDiaQueVale(c);
  const diasNoDocumento = semTermino ? null : diasDoPeriodo(c.startDate, c.endDate);
  // Dias sem comparecer que o documento não cobre (LUIZ, 17/11/2026): no envio
  // viram falta à parte. null = não cobre nenhum, e o envio é recusado.
  const sem = linha ? semComparecer(linha) : null;
  const foraDoDocumento = sem && c.startDate && fimEfetivo && fimEfetivo >= c.startDate
    ? diasForaDoDocumento(sem, c.startDate, fimEfetivo, primeiroDia)
    : [];
  const tipoFalta = tipos.find((t) => t.kind === "falta" && !t.requiresDocument) ?? null;
  const umDiaFora = foraDoDocumento?.length === 1 && foraDoDocumento[0][0] === foraDoDocumento[0][1];
  const avisoFalta = foraDoDocumento?.length
    ? `O período informado não cobre ${foraDoDocumento.map(intervalo).join(" e ")}. ${umDiaFora ? "Esse dia será lançado" : "Esses dias serão lançados"} como ${tipoFalta?.name ?? "falta"}, num lançamento à parte que vai ao RH junto.`
    : "";
  // o horário vai ao servidor na ausência de horas e no primeiro dia parcial
  const levaHoras = c.emHoras || primeiroDia === "parcial";

  // O dado clínico já gravado vem pela RPC, uma vez, ao abrir. Não viaja na
  // listagem justamente para isso.
  const idDoAtestado = linha?.requiresMedical ? linha.id : null;
  useEffect(() => {
    if (!idDoAtestado) return;
    let vivo = true;
    getAtestado(idDoAtestado).then((a: AtestadoLido | null) => {
      if (!vivo || !a) return;
      setC((x) => ({
        ...x,
        cid: a.cid ?? "", cidDescricao: a.cidDescricao ?? "",
        medico: a.medico ?? "", crm: a.crm ?? "", local: a.local ?? "",
        emitidoEm: a.emitidoEm ?? "",
        acompanhado: a.acompanhado ?? "",
      }));
    });
    return () => { vivo = false; };
  }, [idDoAtestado]);

  // O alerta dos 15 dias vem do banco: a conta precisa do histórico inteiro do
  // colaborador, e não só do que está nesta tela.
  useEffect(() => {
    if (!userId) return;
    let vivo = true;
    getAlertaInss(userId, c.endDate || undefined).then((r) => { if (vivo) setInss(r); });
    return () => { vivo = false; };
  }, [userId, c.endDate]);

  const dados = (id: string): ConfirmacaoInput => ({
    id,
    absenceTypeId: c.absenceTypeId,
    startDate: c.startDate,
    endDate: fimEfetivo,
    semTermino,
    note: c.note,
    parentesco: c.parentesco,
    acidenteTrabalho: c.acidenteTrabalho,
    tipoAtestado: c.tipoAtestado,
    tipoDocumento: c.tipoDocumento,
    abonada: c.abonada,
    horaInicio: levaHoras ? c.horaInicio : "",
    horaFim: levaHoras ? c.horaFim : "",
    parcial: c.emHoras,
    primeiroDia,
    atestado: tipo?.requiresMedical ? {
      cid: c.cid, cidDescricao: c.cidDescricao, medico: c.medico, crm: c.crm,
      local: c.local, emitidoEm: c.emitidoEm, acompanhado: c.acompanhado,
    } : undefined,
  });

  const salvar = (depois?: () => void) => {
    if (!linha) return;
    onErro("");
    iniciar(async () => {
      const r = await salvarConfirmacao(dados(linha.id));
      if (r.error) { onErro(r.error); return; }
      // Sem isto o botão não dizia nada: o diálogo fica aberto de propósito
      // (salvar sem enviar é para continuar depois), então nada na tela mudava
      // e a gravação parecia não ter acontecido.
      if (!depois) toast.success("Rascunho salvo. O lançamento segue em aberto, sem ir ao RH.");
      if (depois) depois();
    });
  };

  /**
   * O que vai ao RH, para conferir antes do envio (LUIZ, 17/11/2026): com só
   * as datas, um atestado foi como "Licença" sem ninguém perceber. O motivo
   * vem primeiro e em destaque.
   */
  const resumoDoEnvio = (): [string, string, boolean?][] => {
    const itens: [string, string, boolean?][] = [];
    const nome = linha?.fullName ?? novoPara?.nome;
    if (nome) itens.push(["Colaborador", nome]);
    itens.push(["Motivo", tipo?.name ?? "", true]);
    const dias = diasDoPeriodo(c.startDate, c.endDate) ?? 0;
    itens.push(semTermino
      ? ["Período", `Desde ${formatDate(c.startDate)}, sem data de término`, true]
      : [
          tipo?.requiresMedical ? "Período do atestado" : "Período",
          `${intervalo([c.startDate, c.endDate])} (${dias} dia${dias === 1 ? "" : "s"})`,
        ]);
    if (semTermino) itens.push(["Falta sem término", "Conta todos os dias até o DP encerrar. O desligamento encerra sozinho."]);
    const horario = c.horaInicio ? `das ${c.horaInicio} às ${c.horaFim || "?"}` : "horário a informar";
    if (c.emHoras) itens.push(["Ausência de horas", horario]);
    if (primeiroDia === "trabalhou") {
      itens.push(["Primeiro dia", `Trabalhou normalmente em ${formatDate(c.startDate)}`]);
      const d = dias - 1;
      itens.push(["Ausência considerada", `${intervalo([diaSeguinte(c.startDate), c.endDate])} (${d} dia${d === 1 ? "" : "s"})`]);
    } else if (primeiroDia === "parcial") {
      itens.push(["Primeiro dia", `Trabalhou parte de ${formatDate(c.startDate)}, ausente ${horario}`]);
    }
    if (tipo?.requiresMedical) itens.push(["Tipo de atestado", c.tipoAtestado === "odontologico" ? "Odontológico" : "Médico"]);
    else if (pedeTipoDocumento) itens.push(["Tipo de documento", rotuloTipoDocumento(c.tipoDocumento) ?? ""]);
    if (tipo?.requiresCompanion && c.acompanhado.trim()) itens.push(["Acompanhado", c.acompanhado.trim()]);
    if (tipo?.requiresKinship && c.parentesco.trim()) itens.push(["Parentesco do falecido", c.parentesco.trim()]);
    if (c.acidenteTrabalho) itens.push(["Acidente de trabalho", "Sim"]);
    return itens;
  };

  const enviar = async () => {
    // antes de criar o lançamento: um erro depois dele deixaria um lançamento em aberto pela metade
    if (!c.absenceTypeId) { onErro("Escolha o motivo."); return; }
    if (!c.startDate || (!semTermino && !c.endDate)) { onErro("Informe o início e o término."); return; }
    if (!semTermino && c.endDate < c.startDate) { onErro("O término não pode ser antes do início."); return; }
    if (pedeTipoDocumento && !c.tipoDocumento) {
      onErro("Informe o tipo de documento do afastamento: Médico ou Perícia INSS.");
      return;
    }
    if (sem && foraDoDocumento === null) {
      onErro(`O período informado não cobre nenhum dos dias sem comparecer (${intervalo([sem.inicio, sem.fim])}).`);
      return;
    }
    const ok = await confirmDialog({
      title: ehNovo ? "Lançar e enviar ao RH" : "Enviar ao RH",
      confirmLabel: "Enviar",
      message: <ResumoDoEnvio itens={resumoDoEnvio()} avisoFalta={avisoFalta} />,
    });
    if (!ok) return;
    onErro("");
    iniciar(async () => {
      // lançamento novo: nasce agora, sem comunicado; o único sai no envio
      let id = linha?.id ?? criadoId;
      if (!id) {
        const r = await lancarNaoComparecimento({
          userId,
          // trabalhou no primeiro dia: a ausência começa no seguinte
          occurredOn: primeiroDia === "trabalhou" ? diaSeguinte(c.startDate) : c.startDate,
          reasonNote: "",
          horaInicio: c.emHoras ? c.horaInicio : "",
          horaFim: c.emHoras ? c.horaFim : "",
          parcial: c.emHoras,
          comunicar: false,
        });
        if (r.error || !r.id) { onErro(r.error ?? "Não foi possível lançar a ausência."); return; }
        id = r.id;
        setCriadoId(r.id);
        onCriado?.(r.id);
      }

      // salva antes de enviar: a RPC valida o que está GRAVADO, não o que está
      // na tela, e o gestor não deveria descobrir isso por uma mensagem estranha
      const s = await salvarConfirmacao(dados(id));
      if (s.error) { onErro(s.error); return; }

      if (ehNovo && arquivo && !arquivoSubiu) {
        const fd = new FormData();
        fd.set("id", id);
        fd.set("file", arquivo);
        const a = await anexarDocumentoAbsenteismo(fd);
        if (a.error) { onErro(a.error); return; }
        setArquivoSubiu(true);
      }

      const fd = new FormData();
      fd.set("id", id);
      const r = await confirmarAbsenteismo(fd);
      if (r.error) { onErro(r.error); return; }
      onEnviado?.();
      onFechar();
      if (r.warning) toast.warning(r.warning);
      else toast.success(ehNovo ? "Ausência lançada e enviada ao RH." : "Enviado ao RH.");
    });
  };

  const docOk = ehNovo ? Boolean(arquivo) : temDoc;

  const doIA = (campo: string) => camposIA.has(campo);
  /** o gestor mexeu no campo: a marca de "veio da IA" sai dele (o aviso geral fica) */
  const revisado = (campo: string) => setCamposIA((atual) => {
    if (!atual.has(campo)) return atual;
    const n = new Set(atual);
    n.delete(campo);
    return n;
  });
  const bordaIA = (campo: string): React.CSSProperties | undefined =>
    doIA(campo) ? { borderColor: "var(--mh-warning)", boxShadow: "0 0 0 1px var(--mh-warning)" } : undefined;
  const marcaIA = (campo: string) => doIA(campo)
    ? <span title="Preenchido pela leitura com IA: confira" style={{ color: "var(--mh-warning)", fontWeight: 800, fontSize: "0.66rem", marginLeft: 5, letterSpacing: "0.04em" }}>IA</span>
    : null;

  const aplicarLeitura = (d: AtestadoLidoPorIA) => {
    const campos: Partial<Confirmacao> = {};
    const lidos = new Set<string>();
    if (d.tipoAtestado) { campos.tipoAtestado = d.tipoAtestado; lidos.add("tipoAtestado"); }
    if (d.cid) { campos.cid = d.cid; campos.cidDescricao = d.cidDescricao ?? ""; lidos.add("cid"); }
    if (d.medico) { campos.medico = d.medico; lidos.add("medico"); }
    if (d.crm) { campos.crm = d.crm; lidos.add("crm"); }
    if (d.local) { campos.local = d.local; lidos.add("local"); }
    if (d.emitidoEm) { campos.emitidoEm = d.emitidoEm; lidos.add("emitidoEm"); }
    if (d.acompanhado && tipo?.requiresCompanion) { campos.acompanhado = d.acompanhado; lidos.add("acompanhado"); }
    setC((x) => ({ ...x, ...campos }));
    setCamposIA(lidos);
    // o que a IA leu sem certeza não entra: fica em branco, com o aviso de onde olhar
    const incertos = d.acompanhado || tipo?.requiresCompanion ? d.incertos : d.incertos.filter((r) => r !== "Acompanhado");
    setAvisoIA([
      incertos.length
        ? `A IA não teve certeza e deixou em branco: ${incertos.join(", ")}. Preencha olhando o atestado.`
        : "",
      d.cidNaoEncontrado
        ? `A IA leu o CID "${d.cidNaoEncontrado}", que não existe na tabela oficial, e o campo ficou vazio. Busque o CID certo.`
        : "",
    ].filter(Boolean).join(" "));
    if (lidos.size === 0) {
      if (!incertos.length && !d.cidNaoEncontrado) toast.warning("A IA não conseguiu ler os dados deste documento. Preencha manualmente.");
      return;
    }
    setUsouIA(true);
  };

  /**
   * Lê o atestado com IA: o arquivo que acabou de ser escolhido, o anexo do
   * lançamento novo (ainda na tela) ou o anexo já guardado. Sem nenhum, abre a
   * escolha da foto, que vira também o documento comprobatório.
   */
  const lerComIA = (escolhido?: File) => {
    onErro("");
    const fd = new FormData();
    const local = escolhido ?? (ehNovo ? arquivo : null);
    if (!local && !(!ehNovo && temDoc && linha)) { seletorIA.current?.click(); return; }
    setLendoIA(true);
    void (async () => {
      if (local) fd.set("file", await reduzirParaLeitura(local));
      else if (linha) fd.set("id", linha.id);
      return lerAtestadoComIA(fd);
    })().then((r) => {
      setLendoIA(false);
      if (r.error || !r.data) { onErro(r.error ?? "A leitura falhou. Preencha manualmente."); return; }
      aplicarLeitura(r.data);
    });
  };

  const escolherParaIA = (f: File) => {
    if (ehNovo) { setArquivo(f); lerComIA(f); return; }
    if (!linha) return;
    // no Efetivar, a foto escolhida para a leitura já sobe como o anexo
    const fd = new FormData();
    fd.set("id", linha.id);
    fd.set("file", f);
    setLendoIA(true);
    void anexarDocumentoAbsenteismo(fd).then((a) => {
      setLendoIA(false);
      if (a.error) { onErro(a.error); return; }
      setTemDoc(true);
      router.refresh();
      lerComIA(f);
    });
  };
  const temArquivoParaIA = ehNovo ? Boolean(arquivo) : temDoc;

  return (
    <>
      {linha && (
        <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.6rem 1rem" }}>
        <Campo rotulo="Colaborador" valor={linha.fullName} />
        {sem
          ? <Campo rotulo="Sem comparecer" valor={`${intervalo([sem.inicio, sem.fim])} (${sem.dias} dias)`} />
          : <Campo rotulo="Dia" valor={formatDate(linha.occurredOn)} />}
        <Campo rotulo="Setor" valor={linha.departmentName} />
        <Campo rotulo="Função" valor={linha.positionName} />
      </div>
      {linha.reasonNote && <Campo rotulo="O que se sabia no lançamento" valor={linha.reasonNote} />}
        </>
      )}

      {/* devolvido pelo RH: o que corrigir vem antes de tudo */}
      {linha?.status === "reprovado" && (
        <p style={{ fontSize: "0.84rem", margin: 0, color: "var(--mh-text-1)", background: "var(--mh-danger-soft)", padding: "0.6rem 0.7rem", borderRadius: 8, borderLeft: "3px solid var(--mh-danger)" }}>
          <strong>
            Reprovado pelo RH{linha.decidedByName ? ` (${shortName(linha.decidedByName)}` : ""}
            {linha.decidedByName && linha.decidedAt ? `, ${formatDate(linha.decidedAt)})` : linha.decidedByName ? ")" : ""}:
          </strong>{" "}
          {linha.decisionNote ?? "sem observação."} Corrija o que for preciso e envie de novo.
        </p>
      )}

      {/* Quatro colunas do mesmo tamanho: o Motivo ocupava metade da linha e
          empurrava o Término para baixo, separando o par de datas. O mínimo é
          150px porque com 160 a quarta coluna não cabe na largura do diálogo. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.8rem" }}>
        <div style={{ minWidth: 0 }}>
          <label className="label">Motivo <span style={{ color: "var(--mh-danger)" }}>*</span></label>
          <select
            className="select" value={c.absenceTypeId}
            onChange={(e) => setC((x) => ({ ...x, absenceTypeId: e.target.value }))}
          >
            {!c.absenceTypeId && <option value="" disabled>Selecione…</option>}
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Início <span style={{ color: "var(--mh-danger)" }}>*</span></label>
          <input
            type="date" className="input" value={c.startDate}
            onChange={(e) => setC((x) => ({ ...x, startDate: e.target.value, endDate: x.emHoras ? e.target.value : x.endDate }))}
          />
        </div>
        <div>
          <label className="label">Término {!semTermino && <span style={{ color: "var(--mh-danger)" }}>*</span>}</label>
          {semTermino ? (
            <div className="input" style={{ display: "flex", alignItems: "center", background: "var(--surface-2)" }}>
              Sem término
            </div>
          ) : (
            <input
              type="date" className="input" value={c.endDate}
              min={c.startDate || undefined}
              disabled={c.emHoras}
              title={c.emHoras ? "Ausência de horas vale para um único dia." : undefined}
              onChange={(e) => setC((x) => ({ ...x, endDate: e.target.value }))}
            />
          )}
        </div>
        {/* A conta é feita aqui e gravada pelo servidor: dias digitados à mão
            divergiam das datas que o RH aprova. */}
        <div>
          <label className="label">Dias de afastamento</label>
          <div className="input" style={{ display: "flex", alignItems: "center", background: "var(--surface-2)" }}>
            {c.emHoras
              ? "Em horas"
              : semTermino
              ? "Até o DP encerrar"
              : (() => {
                  if (diasNoDocumento === null) return "…";
                  // o primeiro dia trabalhado (todo ou parte) não conta como dia inteiro
                  const d = diasNoDocumento - (primeiroDia === "integral" ? 0 : 1);
                  return `${d} dia${d === 1 ? "" : "s"}`;
                })()}
          </div>
        </div>
        {tipo?.requiresKinship && (
          <div style={{ gridColumn: "span 2", minWidth: 0 }}>
            <label className="label">Parentesco do falecido <span style={{ color: "var(--mh-danger)" }}>*</span></label>
            <select
              className="select" value={c.parentesco}
              onChange={(e) => setC((x) => ({ ...x, parentesco: e.target.value }))}
            >
              <option value="">Selecione…</option>
              {GRAUS_PARENTESCO.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* O comportamento e a explicação do tipo saem do grid: dentro da célula
          do Motivo, um texto longo esticava a linha inteira. */}
      {tipo && (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginTop: "-0.4rem" }}>
          <Badge variant="quiet" tone={ABSENCE_KIND_TONE[tipo.kind]}>{ABSENCE_KIND_LABEL[tipo.kind]}</Badge>
          {tipo.description && (
            <span className="soft" style={{ fontSize: "0.78rem" }}>{tipo.description}</span>
          )}
        </div>
      )}

      {/* Falta sem término (LUIZ, 17/11/2026): quem parou de vir e não vai
          justificar, sem data para acabar. O DP encerra depois, pela ficha. */}
      {tipo?.kind === "falta" && !c.emHoras && (
        <label style={{ display: "flex", alignItems: "flex-start", gap: "0.45rem", fontSize: "0.84rem", cursor: "pointer" }}>
          <input
            type="checkbox" checked={c.semTermino} style={{ marginTop: 3 }}
            onChange={(e) => {
              const liga = e.target.checked;
              setC((x) => ({ ...x, semTermino: liga, primeiroDia: liga ? "integral" : x.primeiroDia }));
            }}
          />
          <span>
            Continua faltando, sem data de término
            <span className="soft" style={{ display: "block", fontSize: "0.76rem" }}>
              Conta como falta todos os dias até o DP encerrar pela ficha. O desligamento do colaborador encerra sozinho.
            </span>
          </span>
        </label>
      )}

      {/* Dias sem comparecer fora do documento (LUIZ, 17/11/2026): viram falta
          à parte no envio. Avisado aqui, antes, e repetido na confirmação. */}
      {sem && foraDoDocumento === null && c.startDate && c.endDate && (
        <p style={{ fontSize: "0.82rem", margin: 0, color: "var(--mh-danger)", background: "var(--mh-danger-soft)", padding: "0.6rem 0.7rem", borderRadius: 8 }}>
          O período informado não cobre nenhum dos dias sem comparecer ({intervalo([sem.inicio, sem.fim])}). Ajuste o
          início e o término.
        </p>
      )}
      {avisoFalta && (
        <p style={{ fontSize: "0.82rem", margin: 0, color: "var(--mh-text-1)", background: "var(--mh-warning-soft)", padding: "0.6rem 0.7rem", borderRadius: 8, borderLeft: "3px solid var(--mh-warning)" }}>
          <strong>Dias sem comparecer: {intervalo([sem!.inicio, sem!.fim])}.</strong> {avisoFalta} Se não for isso, ajuste o período.
        </p>
      )}

      {/* Primeiro dia (LUIZ, 12/11/2026): atestado de 09 a 11 de quem foi ao
          médico depois do expediente do dia 09 descontava um dia trabalhado.
          O período segue o documento; a resposta decide a ausência que vale.
          "Não trabalhou" vem marcado: é o caso comum, e o RH revisa. */}
      {!c.emHoras && (diasNoDocumento ?? 0) >= 2 && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", padding: "0.7rem 0.8rem", display: "flex", flexDirection: "column", gap: "0.45rem" }}>
          <span className="label" style={{ margin: 0 }}>
            {tipo?.requiresMedical ? "No primeiro dia do atestado" : "No primeiro dia"} ({formatDate(c.startDate)}), o colaborador:
          </span>
          {([
            ["integral", "Não trabalhou"],
            ["trabalhou", tipo?.requiresMedical ? "Trabalhou o dia todo e foi ao médico depois do expediente" : "Trabalhou o dia todo"],
            ["parcial", "Trabalhou parte do dia"],
          ] as [PrimeiroDia, string][]).map(([v, rotulo]) => (
            <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.84rem", cursor: "pointer" }}>
              <input
                type="radio" name={`primeiro-dia-${linha?.id ?? "novo"}`} value={v}
                checked={c.primeiroDia === v}
                onChange={() => setC((x) => ({ ...x, primeiroDia: v }))}
              />
              {rotulo}
            </label>
          ))}
          {c.primeiroDia === "parcial" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 160px))", gap: "0.8rem", paddingLeft: "1.4rem" }}>
              <div>
                <label className="label">Ausente das <span style={{ color: "var(--mh-danger)" }}>*</span></label>
                <input
                  type="time" className="input" value={c.horaInicio}
                  onChange={(e) => setC((x) => ({ ...x, horaInicio: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Até <span style={{ color: "var(--mh-danger)" }}>*</span></label>
                <input
                  type="time" className="input" value={c.horaFim}
                  onChange={(e) => setC((x) => ({ ...x, horaFim: e.target.value }))}
                />
              </div>
            </div>
          )}
          {primeiroDia !== "integral" && c.endDate && (
            <p style={{ fontSize: "0.8rem", margin: 0, background: "var(--surface-2)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
              {(() => {
                const inicio = diaSeguinte(c.startDate);
                const d = diasNoDocumento! - 1;
                const inteiros = `${formatDate(inicio)} a ${formatDate(c.endDate)} (${d} dia${d === 1 ? "" : "s"})`;
                if (primeiroDia === "trabalhou") {
                  return <>Conta como ausência: <strong>{inteiros}</strong>. O dia {formatDate(c.startDate)} não é descontado.</>;
                }
                const faixa = c.horaInicio && c.horaFim ? `das ${c.horaInicio} às ${c.horaFim}` : "(horário a informar)";
                return (
                  <>
                    Conta como ausência: <strong>{formatDate(c.startDate)} {faixa}</strong> e <strong>{inteiros}</strong>.
                    As horas do primeiro dia não entram no cálculo da remuneração variável: saem no relatório do RH, com o horário, para o desconto ser feito na folha.
                  </>
                );
              })()}
            </p>
          )}
        </div>
      )}

      {/* A ausência de horas vale para QUALQUER motivo: no atestado ela é o
          meio período no consultório; na falta, é o horário que a folha vai
          descontar. Por isso ela mora aqui, e não no bloco clínico. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.8rem", alignItems: "end" }}>
        {!semTermino && (c.emHoras || (diasNoDocumento ?? 1) <= 1) && (
          <label style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.82rem", cursor: "pointer", gridColumn: "span 2" }}>
            <input
              type="checkbox" checked={c.emHoras}
              onChange={(e) => {
                const emHoras = e.target.checked;
                // o horário fica guardado ao desmarcar: se o atestado tiver mais
                // dias, ele vira o horário do primeiro dia parcial
                setC((x) => ({ ...x, emHoras, endDate: emHoras ? x.startDate : x.endDate }));
              }}
            />
            O colaborador trabalhou parte do dia (chegou atrasado ou saiu mais cedo)
          </label>
        )}
        {c.emHoras && (
          <>
            <div>
              <label className="label">Das <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input
                type="time" className="input" value={c.horaInicio}
                onChange={(e) => setC((x) => ({ ...x, horaInicio: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Até <span style={{ color: "var(--mh-danger)" }}>*</span></label>
              <input
                type="time" className="input" value={c.horaFim}
                onChange={(e) => setC((x) => ({ ...x, horaFim: e.target.value }))}
              />
            </div>
          </>
        )}
        {tipo?.kind === "falta" && (
          <label style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.82rem", cursor: "pointer", gridColumn: "span 2" }}>
            <input
              type="checkbox" checked={c.abonada}
              onChange={(e) => setC((x) => ({ ...x, abonada: e.target.checked }))}
            />
            Abonar a falta (fica registrada, mas não pesa na remuneração variável)
          </label>
        )}
      </div>

      {c.emHoras && (
        <p className="soft" style={{ fontSize: "0.78rem", margin: 0, background: "var(--surface-2)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
          Ausência de horas não entra no cálculo da remuneração variável: ela sai no relatório do
          RH, com o horário, para o desconto ser feito na folha.
        </p>
      )}

      {/* O alerta legal mais importante do processo: passando de 15 dias, quem
          paga do 16º em diante é o INSS. */}
      {inss?.atinge && (
        <p style={{ fontSize: "0.8rem", margin: 0, color: "var(--mh-warning)", background: "var(--mh-warning-soft)", padding: "0.6rem 0.7rem", borderRadius: 8 }}>
          <strong>Atenção: {inss.dias} dias de atestado.</strong>{" "}
          {inss.motivo === "mesma_doenca"
            ? "São períodos da mesma doença dentro de 60 dias, que a lei manda somar."
            : "São períodos contínuos, que a lei manda somar."}{" "}
          A empresa paga os 15 primeiros dias; do 16º em diante o pagamento é do INSS. Encaminhe o
          colaborador para a perícia.
        </p>
      )}

      {/* O efeito na remuneração variável é POLÍTICA do tipo, definida em
          Configurações, e não escolha de quem lança: se cada gestor marcasse
          por conta, o mesmo atestado descontaria numa equipe e não na outra.
          Aqui a tela só INFORMA o que vai acontecer. */}
      {tipo && (
        <p className="soft" style={{ fontSize: "0.78rem", margin: 0, background: "var(--surface-2)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
          {kindsComRedutor.includes(tipo.kind)
            ? <>Efeito na remuneração variável: este motivo já entra no <strong>redutor por faixa de dias</strong> configurado em Remuneração variável. Para não descontar duas vezes o mesmo dia, os dias do período não são descontados de novo na proporcionalidade.</>
            : tipo.discountsRvDefault
              ? <>Efeito na remuneração variável: os dias do período <strong>descontam proporcionalmente</strong> o valor do mês, conforme definido para este tipo em Configurações.</>
              : <>Efeito na remuneração variável: <strong>nenhum</strong>, conforme definido para este tipo em Configurações.</>}
        </p>
      )}

      {tipo?.requiresMedical && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", background: "var(--surface-2)", padding: "0.9rem" }}>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "0.3rem", flexWrap: "wrap" }}>
            <Stethoscope size={15} />
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Dados do atestado</span>
            {/* leitura com IA: opcional, quem quiser preenche à mão (LUIZ, 11/11/2026) */}
            <button
              type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }}
              disabled={lendoIA || pendente || arquivoSubiu}
              title="Lê a foto ou o PDF do atestado e preenche o que conseguir. Confira tudo depois."
              onClick={() => lerComIA()}
            >
              <Sparkles size={14} aria-hidden />
              {lendoIA ? "Lendo o atestado…" : temArquivoParaIA ? "Preencher com IA" : "Preencher com IA pela foto"}
            </button>
            <input
              ref={seletorIA} type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) escolherParaIA(f); e.target.value = ""; }}
            />
          </div>
          <p className="soft" style={{ fontSize: "0.74rem", margin: "0 0 0.7rem" }}>
            Ficam guardados à parte, com acesso restrito a você e ao RH. Não saem em e-mail, não
            entram na planilha exportada e não aparecem em Logs do sistema. O &quot;Preencher com IA&quot;
            é opcional: ele envia a foto ou o PDF do atestado à OpenAI só para a leitura, e só preenche
            o que três leituras confirmarem; o que ficar em dúvida fica em branco
            {temArquivoParaIA ? "" : ". A foto escolhida vira também o documento comprobatório"}.
          </p>

          {usouIA && (
            <div role="alert" style={{
              display: "flex", gap: "0.65rem", alignItems: "flex-start", margin: "0 0 0.8rem", padding: "0.75rem 0.9rem",
              borderRadius: 10, border: "2px solid var(--mh-warning)",
              background: "color-mix(in srgb, var(--mh-warning) 22%, var(--surface))", color: "var(--mh-text-1)",
            }}>
              <AlertTriangle size={22} aria-hidden style={{ color: "var(--mh-warning)", flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: "0.82rem", lineHeight: 1.45 }}>
                <strong style={{ display: "block", fontSize: "0.9rem" }}>Revise os dados antes de enviar</strong>
                Os campos marcados com IA foram preenchidos por leitura com inteligência artificial, que
                pode errar. Confira cada um com o atestado e corrija o que estiver diferente.
                <strong style={{ display: "block", marginTop: "0.3rem" }}>
                  A responsabilidade pelo preenchimento continua sendo sua.
                </strong>
              </div>
            </div>
          )}
          {avisoIA && (
            <p style={{ fontSize: "0.8rem", margin: "0 0 0.8rem", color: "var(--mh-warning)", fontWeight: 600 }}>{avisoIA}</p>
          )}
          <div style={{ display: "flex", gap: "1.2rem", flexWrap: "wrap", marginBottom: "0.8rem" }}>
            <div>
              <label className="label">Tipo de atestado <span style={{ color: "var(--mh-danger)" }}>*</span>{marcaIA("tipoAtestado")}</label>
              <div style={{ display: "flex", gap: "1rem", alignItems: "center", height: 34 }}>
                {[["medico", "Médico"], ["odontologico", "Odontológico"]].map(([v, r]) => (
                  <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.82rem", cursor: "pointer" }}>
                    <input
                      type="radio" name={`tipo-atestado-${linha?.id ?? "novo"}`} value={v}
                      checked={c.tipoAtestado === v}
                      onChange={() => { setC((x) => ({ ...x, tipoAtestado: v })); revisado("tipoAtestado"); }}
                    />
                    {r}
                  </label>
                ))}
              </div>
            </div>
            {/* O caso que gera CAT. Fica no lançamento (e não no dado clínico)
                porque é fato trabalhista: sai no relatório e no indicador. */}
            <label style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.82rem", cursor: "pointer", alignSelf: "end", height: 34 }}>
              <input
                type="checkbox" checked={c.acidenteTrabalho}
                onChange={(e) => setC((x) => ({ ...x, acidenteTrabalho: e.target.checked }))}
              />
              Acidente de trabalho ou de trajeto
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.8rem" }}>
            <div>
              <label className="label">CID{marcaIA("cid")}</label>
              <BuscaCid
                code={c.cid}
                destaque={doIA("cid")}
                onEscolha={(code, descricao) => { setC((x) => ({ ...x, cid: code, cidDescricao: descricao })); revisado("cid"); }}
              />
            </div>
            <div style={{ gridColumn: "span 2", minWidth: 0 }}>
              <label className="label">Descrição do CID</label>
              {/* Vem da tabela oficial junto com o código; digitada, ela chegava
                  errada ao RH ("gripe" onde o documento diz outra coisa). */}
              <div className="input" style={{ background: "var(--surface-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.cidDescricao || undefined}>
                {c.cidDescricao || <span className="soft">Preenchida ao escolher o CID</span>}
              </div>
            </div>
            {tipo?.requiresCompanion && (
              <div style={{ gridColumn: "span 2", minWidth: 0 }}>
                <label className="label">Acompanhado (quem foi acompanhado) <span style={{ color: "var(--mh-danger)" }}>*</span>{marcaIA("acompanhado")}</label>
                <input
                  className="input" value={c.acompanhado} placeholder="Ex.: filho, Pedro, 4 anos" style={bordaIA("acompanhado")}
                  onChange={(e) => { setC((x) => ({ ...x, acompanhado: e.target.value })); revisado("acompanhado"); }}
                />
              </div>
            )}
            <div style={{ gridColumn: "span 2", minWidth: 0 }}>
              <label className="label">Profissional <span style={{ color: "var(--mh-danger)" }}>*</span>{marcaIA("medico")}</label>
              <input
                className="input" value={c.medico} placeholder="Dra. Marina Alves" style={bordaIA("medico")}
                onChange={(e) => { setC((x) => ({ ...x, medico: e.target.value })); revisado("medico"); }}
              />
            </div>
            <div>
              <label className="label">CRM ou registro{marcaIA("crm")}</label>
              <input
                className="input" value={c.crm} placeholder="CRM-BA 12345" style={bordaIA("crm")}
                onChange={(e) => { setC((x) => ({ ...x, crm: e.target.value })); revisado("crm"); }}
              />
            </div>
            <div style={{ gridColumn: "span 2", minWidth: 0 }}>
              <label className="label">Hospital, clínica ou local{marcaIA("local")}</label>
              <input
                className="input" value={c.local} placeholder="Hospital Santa Izabel" style={bordaIA("local")}
                onChange={(e) => { setC((x) => ({ ...x, local: e.target.value })); revisado("local"); }}
              />
            </div>
            <div>
              <label className="label">Emitido em <span style={{ color: "var(--mh-danger)" }}>*</span>{marcaIA("emitidoEm")}</label>
              <input
                type="date" className="input" value={c.emitidoEm} style={bordaIA("emitidoEm")}
                onChange={(e) => { setC((x) => ({ ...x, emitidoEm: e.target.value })); revisado("emitidoEm"); }}
              />
            </div>
          </div>
        </div>
      )}

      {/* O anexo aparece para QUALQUER tipo: uma falta pode ter o print da
          conversa em que o colaborador a assume. O que o catálogo controla é a
          obrigatoriedade, não a possibilidade. */}
      {pedeTipoDocumento && (
        <div>
          <label className="label">Tipo de documento <span style={{ color: "var(--mh-danger)" }}>*</span></label>
          <div style={{ display: "flex", gap: "1rem", alignItems: "center", minHeight: 34, flexWrap: "wrap" }}>
            {[["medico", "Médico"], ["pericia_inss", "Perícia INSS"]].map(([v, r]) => (
              <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.82rem", cursor: "pointer" }}>
                <input
                  type="radio" name={`tipo-documento-${linha?.id ?? "novo"}`} value={v}
                  checked={c.tipoDocumento === v}
                  onChange={() => setC((x) => ({ ...x, tipoDocumento: v }))}
                />
                {r}
              </label>
            ))}
          </div>
        </div>
      )}

      {linha ? (
        <Anexo
          linha={linha}
          obrigatorio={Boolean(tipo?.requiresDocument)}
          temDoc={temDoc}
          onMudou={(v) => setTemDoc(v)}
          onErro={onErro}
          onAbrir={onAbrirDocumento}
          onBaixar={onBaixarDocumento}
          // o nome segue o que está NA TELA (motivo e tipo podem ter mudado agora)
          nomeBaixar={linha.docPath ? nomeParaBaixar({
            kind: tipo?.kind ?? null,
            tipoDocumento: tipo?.requiresMedical ? c.tipoAtestado : pedeTipoDocumento ? c.tipoDocumento : null,
            emHoras: c.emHoras,
            inicio: c.startDate || null,
            original: linha.docFilename,
            caminho: linha.docPath,
          }) : ""}
        />
      ) : (
        <AnexoNoEnvio obrigatorio={Boolean(tipo?.requiresDocument)} arquivo={arquivo} onArquivo={setArquivo} travado={arquivoSubiu} />
      )}

      <div>
        <label className="label">Observação</label>
        <textarea
          className="input" rows={2} value={c.note}
          placeholder="O que o RH precisa saber para conferir."
          onChange={(e) => setC((x) => ({ ...x, note: e.target.value }))}
        />
      </div>

      {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>}

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {/* no lançamento novo não há rascunho: quem ainda não tem tudo usa o outro caminho */}
        {!ehNovo && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={() => salvar()}>
            {pendente ? "Salvando…" : "Salvar sem enviar"}
          </button>
        )}
        <button
          type="button" className="btn btn-primary btn-sm"
          disabled={pendente || !userId || (Boolean(tipo?.requiresDocument) && !docOk)}
          title={tipo?.requiresDocument && !docOk ? "Anexe o documento primeiro" : undefined}
          onClick={enviar}
        >
          <Send size={15} /> {pendente && ehNovo ? "Enviando…" : ehNovo ? "Lançar e enviar ao RH" : "Enviar ao RH"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onFechar}>{ehNovo ? "Cancelar" : "Fechar"}</button>
      </div>

      <p className="soft" style={{ fontSize: "0.75rem", margin: 0 }}>
        Enquanto o RH não aprovar, este lançamento não conta como ausência e não altera
        remuneração variável.
      </p>
    </>
  );
}

function Anexo({
  linha, obrigatorio, temDoc, onMudou, onErro, onAbrir, onBaixar, nomeBaixar,
}: {
  linha: AbsenteismoRow;
  obrigatorio: boolean;
  temDoc: boolean;
  onMudou: (v: boolean) => void;
  onErro: (m: string) => void;
  onAbrir: (path: string) => void;
  onBaixar: (path: string, nome: string) => void;
  /** ATD_2026_11_16.pdf e afins; ver `nomeParaBaixar` */
  nomeBaixar: string;
}) {
  const [enviando, iniciar] = useTransition();
  const [nome, setNome] = useState(linha.docFilename);

  const subir = (file: File) => {
    onErro("");
    const fd = new FormData();
    fd.set("id", linha.id);
    fd.set("file", file);
    iniciar(async () => {
      const r = await anexarDocumentoAbsenteismo(fd);
      if (r.error) { onErro(r.error); return; }
      setNome(file.name);
      onMudou(true);
    });
  };

  const remover = () => {
    const fd = new FormData();
    fd.set("id", linha.id);
    iniciar(async () => {
      const r = await removerDocumentoAbsenteismo(fd);
      if (r.error) { onErro(r.error); return; }
      onMudou(false);
    });
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", padding: "0.75rem" }}>
      <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.3rem" }}>
        Documento comprobatório
        {obrigatorio
          ? <span style={{ color: "var(--mh-danger)" }}> *</span>
          : <span className="soft" style={{ fontWeight: 400 }}> (opcional)</span>}
      </div>
      <p className="soft" style={{ fontSize: "0.75rem", margin: "0 0 0.6rem" }}>
        O atestado digitalizado ou, no caso de falta, um comprovante como o print da conversa em
        que o colaborador confirma. PDF ou foto, até 10 MB. Fica em área restrita, e só quem pode
        ver este lançamento consegue abrir.
      </p>
      {temDoc && linha.docPath ? (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAbrir(linha.docPath as string)}>
            <Paperclip size={15} /> {nome ?? "Ver documento"}
          </button>
          <button
            type="button" className="btn btn-ghost btn-sm" title={`Baixar como ${nomeBaixar}`}
            onClick={() => onBaixar(linha.docPath as string, nomeBaixar)}
          >
            <Download size={15} /> Baixar
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={enviando} onClick={remover}>
            Remover
          </button>
        </div>
      ) : (
        <input
          type="file" className="input" disabled={enviando}
          accept="application/pdf,image/*"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f); e.target.value = ""; }}
        />
      )}
      {enviando && <p className="soft" style={{ fontSize: "0.75rem", margin: "0.4rem 0 0" }}>Enviando…</p>}
    </div>
  );
}

/**
 * O anexo do lançamento novo: o arquivo fica na tela e sobe no envio, depois que
 * o lançamento existe (o armazenamento é por lançamento).
 */
function AnexoNoEnvio({ obrigatorio, arquivo, onArquivo, travado }: {
  obrigatorio: boolean;
  arquivo: File | null;
  onArquivo: (f: File | null) => void;
  /** já subiu (envio que falhou depois): não troca mais */
  travado: boolean;
}) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", padding: "0.75rem" }}>
      <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.3rem" }}>
        Documento comprobatório
        {obrigatorio
          ? <span style={{ color: "var(--mh-danger)" }}> *</span>
          : <span className="soft" style={{ fontWeight: 400 }}> (opcional)</span>}
      </div>
      <p className="soft" style={{ fontSize: "0.75rem", margin: "0 0 0.6rem" }}>
        O atestado digitalizado ou, no caso de falta, um comprovante como o print da conversa em
        que o colaborador confirma. PDF ou foto, até 10 MB. Sobe junto com o envio e fica em área
        restrita.
      </p>
      {arquivo ? (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.82rem" }}>
            <Paperclip size={15} aria-hidden /> {arquivo.name}
          </span>
          {!travado && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onArquivo(null)}>Remover</button>
          )}
        </div>
      ) : (
        <input
          type="file" className="input" accept="application/pdf,image/*"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onArquivo(f); e.target.value = ""; }}
        />
      )}
    </div>
  );
}

/**
 * Encerrar, corrigir ou reabrir a falta sem término (LUIZ, 17/11/2026). Só o DP.
 *
 * Encerrar pede o último dia de falta (até hoje) e manda o comunicado de
 * encerramento. Já encerrada, dá para corrigir a data ou reabrir, por exemplo
 * quando o desligamento foi lançado errado.
 */
function EncerrarFalta({ linha, onErro }: { linha: AbsenteismoRow; onErro: (m: string) => void }) {
  const segue = linha.endDate === SEM_RETORNO;
  const [editando, setEditando] = useState(segue);
  const [dia, setDia] = useState(segue ? hoje() : linha.endDate ?? hoje());
  const [pendente, iniciar] = useTransition();
  const inicio = linha.ausenciaInicio ?? linha.startDate ?? undefined;

  const aplicar = async (ultimoDia: string | null) => {
    if (ultimoDia !== null && !dia) { onErro("Informe o último dia de falta."); return; }
    const ok = await confirmDialog(ultimoDia === null
      ? {
          title: "Reabrir a falta",
          confirmLabel: "Reabrir",
          message: `A falta de ${linha.fullName ?? "colaborador"} volta a seguir sem data de término e a contar até hoje.`,
        }
      : {
          title: segue ? "Encerrar as faltas" : "Corrigir o término",
          confirmLabel: segue ? "Encerrar" : "Corrigir",
          message: `Último dia de falta de ${linha.fullName ?? "colaborador"}: ${formatDate(ultimoDia)}. Os destinatários de sempre recebem o comunicado de encerramento.`,
        });
    if (!ok) return;
    onErro("");
    iniciar(async () => {
      const r = await encerrarFaltaSemTermino({ id: linha.id, ultimoDia });
      if (r.error) { onErro(r.error); return; }
      if (r.warning) toast.warning(r.warning);
      else if (r.message) toast.success(r.message);
      setEditando(false);
    });
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.55rem" }}>
      <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>Falta sem término</div>
      <p className="soft" style={{ fontSize: "0.78rem", margin: 0 }}>
        {segue
          ? "Conta como falta todos os dias até ser encerrada. Quando a situação se resolver, informe o último dia de falta. O desligamento do colaborador encerra sozinho, na data dele."
          : "A falta já foi encerrada. Corrija a data se ela estiver errada, ou reabra se a pessoa segue faltando."}
      </p>
      {editando ? (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label className="label" htmlFor={`ultimo-dia-${linha.id}`}>Último dia de falta</label>
            <input
              id={`ultimo-dia-${linha.id}`} type="date" className="input" value={dia}
              min={inicio} max={hoje()} onChange={(e) => setDia(e.target.value)}
            />
          </div>
          <button type="button" className="btn btn-primary btn-sm" disabled={pendente} onClick={() => aplicar(dia)}>
            {segue ? "Encerrar as faltas" : "Salvar término"}
          </button>
          {!segue && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={() => setEditando(false)}>
              Cancelar
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={() => setEditando(true)}>
            Corrigir término
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={() => aplicar(null)}>
            Reabrir (segue faltando)
          </button>
        </div>
      )}
    </div>
  );
}

/** A ficha completa, com a decisão do RH quando for o caso. */
function Ficha({
  linha, kindsComRedutor, podeDecidir, podeCancelarAprovado, podeCancelarProprio, erro, onErro, onAbrirDocumento, onBaixarDocumento, onEfetivar, onFechar,
}: {
  linha: AbsenteismoRow;
  kindsComRedutor: Enums<"absence_kind">[];
  podeDecidir: boolean;
  podeCancelarAprovado: boolean;
  podeCancelarProprio: boolean;
  erro: string;
  onErro: (m: string) => void;
  onAbrirDocumento: (path: string) => void;
  onBaixarDocumento: (path: string, nome: string) => void;
  /** presente quando o lançamento ainda pode ser efetivado por quem está olhando */
  onEfetivar?: () => void;
  onFechar: () => void;
}) {
  const [medico, setMedico] = useState<AtestadoLido | null>(null);
  const [verMedico, setVerMedico] = useState(false);
  // ATD_/ATH_/PERÍCIA_INSS_ + início do documento (LUIZ, 17/11/2026)
  const nomeBaixar = linha.docPath ? nomeParaBaixar({
    kind: linha.kind,
    tipoDocumento: linha.certificateKind,
    emHoras: linha.partialDay,
    inicio: linha.startDate ?? linha.occurredOn,
    original: linha.docFilename,
    caminho: linha.docPath,
  }) : "";
  const [motivo, setMotivo] = useState("");
  // separado de `erro` porque o reenvio bem-sucedido é notícia boa, e notícia
  // boa em vermelho faz a pessoa achar que quebrou
  const [avisoEmail, setAvisoEmail] = useState("");
  const [pendente, iniciar] = useTransition();

  const abrirMedico = async () => {
    setVerMedico(true);
    if (!medico) setMedico(await getAtestado(linha.id));
  };

  // CPF só no "Ver" (LUIZ, 12/11/2026): vem por RPC com a guarda de quem vê o
  // lançamento, porque o CPF não é legível direto da tabela de perfis
  const [cpf, setCpf] = useState<{ id: string; valor: string | null } | null>(null);
  useEffect(() => {
    let vivo = true;
    getCpfDoLancamento(linha.id).then((v) => { if (vivo) setCpf({ id: linha.id, valor: v }); });
    return () => { vivo = false; };
  }, [linha.id]);
  const cpfDaLinha = cpf?.id === linha.id ? cpf.valor : undefined;

  const decidir = (aprovar: boolean) => {
    onErro("");
    const fd = new FormData();
    fd.set("id", linha.id);
    fd.set("aprovar", aprovar ? "1" : "0");
    fd.set("nota", motivo);
    iniciar(async () => {
      const r = await decidirAbsenteismo(fd);
      if (r.error) { onErro(r.error); return; }
      onFechar();
    });
  };

  const aprovar = async () => {
    const ok = await confirmDialog({
      title: "Aprovar absenteísmo",
      confirmLabel: "Aprovar",
      message: `Aprovar ${(linha.typeName ?? "a ausência").toLowerCase()} de ${linha.fullName ?? "colaborador"}? A partir daqui ela passa a valer e entra no cálculo da remuneração variável do período.`,
    });
    if (ok) decidir(true);
  };

  const reprovar = () => {
    if (!motivo.trim()) { onErro("Informe o motivo da reprovação."); return; }
    decidir(false);
  };

  const cancelar = async () => {
    if (!motivo.trim()) { onErro("Informe o motivo do cancelamento."); return; }
    const ok = await confirmDialog({
      title: "Cancelar lançamento",
      tone: "danger",
      confirmLabel: "Cancelar o lançamento",
      message: linha.status === "aprovado"
        ? `Cancelar ${(linha.typeName ?? "a ausência").toLowerCase()} de ${linha.fullName ?? "colaborador"}? Ela deixa de contar para a remuneração variável, e o lançamento fica registrado como cancelado.`
        : linha.status === "aberto" && linha.emailStatus === "sent"
          ? "O lançamento fica registrado como cancelado, e quem recebeu o comunicado recebe um e-mail pedindo para desconsiderá-lo."
          : "O lançamento fica registrado como cancelado.",
    });
    if (!ok) return;
    onErro("");
    const fd = new FormData();
    fd.set("id", linha.id);
    fd.set("nota", motivo);
    iniciar(async () => {
      const r = await cancelarAbsenteismo(fd);
      if (r.error) { onErro(r.error); return; }
      if (r.warning) toast.warning(r.warning);
      else if (r.message) toast.success(r.message);
      onFechar();
    });
  };

  const decidindo = podeDecidir && linha.status === "pendente";
  // a importação entra sem anexo: o DP anexa o atestado depois (LUIZ, 17/11/2026)
  const anexandoImportado = podeDecidir && linha.importado && linha.status === "aprovado";
  const cancelandoAprovado = podeCancelarAprovado && linha.status === "aprovado";
  const cancelandoAberto = podeCancelarProprio && (linha.status === "aberto" || linha.status === "reprovado");

  return (
    <>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <Badge tone={ABSENTEISMO_STATUS_TONE[linha.status]}>{ABSENTEISMO_STATUS[linha.status]}</Badge>
        {linha.kind && <Badge variant="quiet" tone={ABSENCE_KIND_TONE[linha.kind]}>{ABSENCE_KIND_LABEL[linha.kind]}</Badge>}
      </div>

      <DetailSection title="Colaborador">
        <FieldGrid min={150}>
        <Campo rotulo="Colaborador" valor={linha.fullName} />
        <Campo rotulo="Matrícula" valor={linha.employeeCode} />
        <Campo rotulo="CPF" valor={cpfDaLinha === undefined ? "…" : cpfDaLinha ? formatCpf(cpfDaLinha) : null} />
        <Campo rotulo="Setor" valor={linha.departmentName} />
        <Campo rotulo="Subsetor" valor={linha.subdepartmentName} />
        <Campo rotulo="Função" valor={linha.positionName} />
        <Campo rotulo="Gestor imediato" valor={linha.managerName} />
        <Campo rotulo="Unidade" valor={linha.unitName} />
        <Campo rotulo="Dia" valor={formatDate(linha.occurredOn)} />
        {/* em aberto com "Continua ausente": os dias acumulados */}
        {linha.status === "aberto" && semComparecer(linha) && (
          <Campo rotulo="Sem comparecer" valor={`${intervalo([linha.occurredOn, linha.ausenteAte!])} (${semComparecer(linha)!.dias} dias)`} />
        )}
        </FieldGrid>
      </DetailSection>

      {linha.reasonNote && <Campo rotulo="O que se sabia no lançamento" valor={linha.reasonNote} />}

      <DetailSection title="A ausência">
        <FieldGrid min={150}>
        <Campo rotulo="Motivo" valor={linha.typeName} />
        <Campo
          rotulo={linha.primeiroDia === "integral" ? "Período" : "Período do atestado"}
          valor={linha.startDate && linha.endDate === SEM_RETORNO
            ? (() => {
                const d = diasDoPeriodo(linha.ausenciaInicio ?? linha.startDate, hoje()) ?? 0;
                return `Desde ${formatDate(linha.startDate)}, sem término (${d} dia${d === 1 ? "" : "s"} até hoje)`;
              })()
            : linha.startDate && linha.endDate ? `${formatDate(linha.startDate)} a ${formatDate(linha.endDate)}` : null}
        />
        {linha.faltaContinua && linha.endDate !== SEM_RETORNO && linha.endDate && (
          <Campo
            rotulo="Falta sem término"
            valor={linha.faltaEncerradaNoDesligamento
              ? `Encerrada no desligamento, em ${formatDate(linha.endDate)}`
              : `Encerrada pelo DP, último dia ${formatDate(linha.endDate)}`}
          />
        )}
        {linha.primeiroDia !== "integral" && linha.startDate && linha.endDate && linha.ausenciaInicio && (
          <>
            <Campo
              rotulo="Primeiro dia"
              valor={linha.primeiroDia === "trabalhou"
                ? `Trabalhou normalmente em ${formatDate(linha.startDate)}`
                : `Trabalhou parte de ${formatDate(linha.startDate)}, ausente ${linha.hoursStart ? `das ${linha.hoursStart.slice(0, 5)} às ${linha.hoursEnd?.slice(0, 5) ?? "?"}` : "(horário a informar)"}`}
            />
            <Campo
              rotulo="Ausência considerada"
              valor={(() => {
                const d = diasDoPeriodo(linha.ausenciaInicio!, linha.endDate!) ?? 0;
                return `${formatDate(linha.ausenciaInicio)} a ${formatDate(linha.endDate)} (${d} dia${d === 1 ? "" : "s"})`;
              })()}
            />
          </>
        )}
        <Campo
          rotulo="Efeito na RV"
          valor={efeitoNaRv({
            status: linha.status, kind: linha.kind, descontaRv: linha.discountsRv,
            abonada: linha.waived, horas: linha.partialDay,
          }, kindsComRedutor)}
        />
        {linha.kinship && <Campo rotulo="Parentesco do falecido" valor={linha.kinship} />}
        {linha.partialDay && (
          <Campo
            rotulo="Horário da ausência"
            valor={linha.hoursStart
              ? `${linha.hoursStart.slice(0, 5)} às ${linha.hoursEnd?.slice(0, 5) ?? "?"}`
              : "Parcial, horário a confirmar"}
          />
        )}
        {linha.certificateKind && (
          <Campo
            rotulo={linha.kind === "afastamento" ? "Tipo de documento" : "Tipo de atestado"}
            valor={rotuloTipoDocumento(linha.certificateKind)}
          />
        )}
        {linha.workAccident && <Campo rotulo="Acidente de trabalho" valor="Sim" />}
        {linha.waived && <Campo rotulo="Falta abonada" valor="Sim" />}
        {linha.note && (
          <div style={{ gridColumn: "1 / -1" }}>
            <Campo rotulo="Observação" valor={linha.note} />
          </div>
        )}
        </FieldGrid>
      </DetailSection>

      {/* O dado clínico não vem na lista: quem quiser ver pede, e a leitura passa
          pela RPC que confere a alçada. */}
      {linha.requiresMedical && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--mh-radius-lg)", padding: "0.75rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <span style={{ display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.85rem", fontWeight: 600 }}>
              <Stethoscope size={15} /> Dados do atestado
            </span>
            {!verMedico && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={abrirMedico}>Mostrar</button>
            )}
          </div>
          {verMedico && (
            <div style={{ marginTop: "0.7rem" }}>
            <FieldGrid min={150}>
              <Campo rotulo="CID" valor={medico?.cid ?? null} />
              <Campo rotulo="Descrição" valor={medico?.cidDescricao ?? null} />
              {medico?.acompanhado && <Campo rotulo="Acompanhado" valor={medico.acompanhado} />}
              <Campo rotulo="Profissional" valor={medico?.medico ?? null} />
              <Campo rotulo="CRM ou registro" valor={medico?.crm ?? null} />
              <Campo rotulo="Local" valor={medico?.local ?? null} />
              <Campo rotulo="Emitido em" valor={medico?.emitidoEm ? formatDate(medico.emitidoEm) : null} />
              <Campo rotulo="Dias de afastamento" valor={medico?.diasAfastamento?.toString() ?? null} />
            </FieldGrid>
            </div>
          )}
        </div>
      )}

      <DetailSection title="Trâmite">
        <FieldGrid min={150}>
        {linha.importado ? (
          <>
            {/* sem envio ao RH nem decisão: entrou aprovado pela importação de histórico */}
            <Campo rotulo="Origem" valor="Importação de histórico, sem comunicado" />
            <Campo rotulo="Importado por" valor={linha.createdByName} />
            <Campo rotulo="Importado em" valor={linha.decidedAt ? formatDate(linha.decidedAt) : null} />
          </>
        ) : (
          <>
            {linha.comunicadoImportado ? (
              <>
                {/* entrou em aberto pela importação de comunicados, no nome do gestor */}
                <Campo rotulo="Origem" valor="Comunicado importado, sem e-mail na importação" />
                <Campo rotulo="Importado por" valor={linha.importadoPorName} />
                <Campo rotulo="Com o gestor" valor={linha.createdByName} />
              </>
            ) : (
              <Campo rotulo="Lançado por" valor={linha.createdByName} />
            )}
            <Campo rotulo="Enviado ao RH em" valor={linha.submittedAt ? formatDate(linha.submittedAt) : null} />
            <Campo rotulo="Decidido por" valor={linha.decidedByName} />
            <Campo rotulo="Decidido em" valor={linha.decidedAt ? formatDate(linha.decidedAt) : null} />
          </>
        )}
        {linha.decisionNote && !linha.importado && (
          <div style={{ gridColumn: "1 / -1" }}>
            <Campo rotulo="Motivo da decisão" valor={linha.decisionNote} />
          </div>
        )}
        {linha.cancelNote && (
          <div style={{ gridColumn: "1 / -1" }}>
            <Campo rotulo="Motivo do cancelamento" valor={linha.cancelNote} />
          </div>
        )}
        </FieldGrid>
      </DetailSection>

      {podeDecidir && linha.faltaContinua && (linha.status === "aprovado" || linha.status === "pendente") && (
        <EncerrarFalta linha={linha} onErro={onErro} />
      )}

      {anexandoImportado && (
        <Anexo
          linha={linha}
          obrigatorio={false}
          temDoc={Boolean(linha.docPath)}
          onMudou={() => {}}
          onErro={onErro}
          onAbrir={onAbrirDocumento}
          onBaixar={onBaixarDocumento}
          nomeBaixar={nomeBaixar}
        />
      )}

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        {onEfetivar && (
          <button type="button" className="btn btn-primary btn-sm" onClick={onEfetivar}>
            <Pencil size={15} /> Efetivar
          </button>
        )}
        {linha.docPath && !anexandoImportado && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAbrirDocumento(linha.docPath as string)}>
            <Paperclip size={15} /> {linha.docFilename ?? "Documento"}
          </button>
        )}
        {nomeBaixar && !anexandoImportado && (
          <button
            type="button" className="btn btn-ghost btn-sm" title={`Baixar como ${nomeBaixar}`}
            onClick={() => onBaixarDocumento(linha.docPath as string, nomeBaixar)}
          >
            <Download size={15} /> Baixar
          </button>
        )}
        {linha.emailStatus && (
          <span className="soft" style={{ fontSize: "0.78rem", display: "inline-flex", gap: "0.3rem", alignItems: "center" }}>
            <Mail size={14} />
            {linha.emailStatus === "sent" && `Comunicado enviado${linha.emailAt ? " em " + formatDate(linha.emailAt) : ""}`}
            {linha.emailStatus === "failed" && "O comunicado não pôde ser enviado"}
            {linha.emailStatus === "skipped" && "Sem destinatário configurado, nenhum comunicado saiu"}
          </span>
        )}
        {/* Sem fila e sem retry automático, reenviar é a única recuperação. O
            cancelado não reenvia: o e-mail de "desconsidere" já saiu no cancelamento. */}
        {/* o comunicado importado não teve e-mail (decisão do LUIZ): o primeiro sai no envio ao RH */}
        {linha.status !== "cancelado" && !linha.importado && !(linha.comunicadoImportado && !linha.emailStatus) && <button
          type="button" className="btn btn-ghost btn-sm" disabled={pendente}
          onClick={() => {
            onErro("");
            setAvisoEmail("");
            const fd = new FormData();
            fd.set("id", linha.id);
            iniciar(async () => {
              const r = await reenviarComunicado(fd);
              if (r.error) { onErro(r.error); return; }
              setAvisoEmail(r.warning ?? r.message ?? "");
            });
          }}
        >
          <Mail size={15} /> Reenviar comunicado
        </button>}
      </div>
      {avisoEmail && (
        <p className="soft" style={{ fontSize: "0.8rem", margin: 0 }}>{avisoEmail}</p>
      )}

      {(decidindo || cancelandoAprovado || cancelandoAberto) && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <div>
            <label className="label">
              {decidindo ? "Motivo da reprovação" : "Motivo do cancelamento"}
              <span className="soft" style={{ fontWeight: 400 }}> (obrigatório)</span>
            </label>
            <textarea
              className="input" rows={2} value={motivo}
              placeholder={decidindo
                ? "O que o gestor precisa corrigir antes de reenviar."
                : "Por que este lançamento deixou de valer."}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
          {erro && <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {decidindo && (
              <>
                <button type="button" className="btn btn-primary btn-sm" disabled={pendente} onClick={aprovar}>
                  <Check size={15} /> Aprovar
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={pendente} onClick={reprovar}>
                  <Ban size={15} /> Reprovar
                </button>
              </>
            )}
            {(cancelandoAprovado || cancelandoAberto) && (
              <button type="button" className="btn btn-danger btn-sm" disabled={pendente} onClick={cancelar}>
                <Ban size={15} /> Cancelar o lançamento
              </button>
            )}
          </div>
        </div>
      )}

      {erro && !decidindo && !cancelandoAprovado && !cancelandoAberto && (
        <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0 }}>{erro}</p>
      )}
    </>
  );
}
