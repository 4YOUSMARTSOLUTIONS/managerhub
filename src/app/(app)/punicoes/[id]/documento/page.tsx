import { notFound } from "next/navigation";
import { requireContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { moduleGate } from "@/lib/module-gate";
import { formatCpf } from "@/lib/cpf";
import { formatDate } from "@/lib/format";
import { INFRACTION_SEVERITY } from "@/lib/constants";
import { PrintButton } from "@/components/ui/PrintButton";
import type { Enums } from "@/types/database";

/**
 * O papel que vai à assinatura.
 *
 * Fica dentro de `(app)` para herdar sessão, empresa e o gate do módulo; o CSS
 * de impressão (`@media print`, em globals.css) tira a casca do sistema e deixa
 * só o documento. Não há geração de PDF no servidor: o navegador imprime ou
 * salva em PDF, e é esse PDF assinado que volta como anexo.
 *
 * Sem permissão devolve 404, e não 403, para a tela não confirmar a existência
 * de um lançamento que o leitor não pode ver.
 *
 * O CPF vem da RPC `punicao_documento`, e não de `profiles`: a coluna é
 * revogada de `authenticated` (ver AGENTS.md), e nem `tenant_dados_pessoais`
 * serviria aqui, porque ela exige um papel que o gestor de equipe não tem.
 */
type Documento = {
  status: Enums<"punicao_status">;
  empresa: string | null;
  unidade: string | null;
  colaborador: {
    nome: string | null; cpf: string | null; matricula: string | null;
    setor: string | null; subsetor: string | null; funcao: string | null; gestor: string | null;
  };
  infracao: {
    codigo: string | null; nome: string | null; descricao: string | null;
    gravidade: Enums<"infraction_severity"> | null;
  };
  punicao: string | null;
  aplicadaEm: string | null;
  informacaoComplementar: string | null;
  lancadoPor: string | null;
  decididoPor: string | null;
  motivoDaDecisao: string | null;
};

const TARJA: Partial<Record<Enums<"punicao_status">, string>> = {
  rascunho: "RASCUNHO SEM VALIDADE",
  pendente: "AGUARDANDO APROVAÇÃO DO RH",
  reprovada: "REPROVADO, SEM VALIDADE",
  cancelada: "CANCELADO, SEM VALIDADE",
};

export default async function DocumentoDePunicaoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const gate = await moduleGate("punicoes");
  if (gate) return gate;

  await requireContext();
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase.rpc("punicao_documento", { p_id: id });
  const doc = data as Documento | null;
  if (!doc) notFound();

  const tarja = TARJA[doc.status];

  return (
    <div className="doc-page">
      <div className="no-print" style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <PrintButton />
      </div>

      <article className="doc-folha">
        <header className="doc-cabecalho">
          <div>
            <div className="doc-empresa">{doc.empresa ?? ""}</div>
            {doc.unidade && <div className="doc-unidade">Unidade {doc.unidade}</div>}
          </div>
          <div className="doc-titulo">
            <div>COMUNICADO DE PUNIÇÃO</div>
            <div className="doc-tipo">{(doc.punicao ?? "").toUpperCase()}</div>
          </div>
        </header>

        {tarja && <p className="doc-tarja">{tarja}</p>}

        <section>
          <h2 className="doc-secao">Identificação do colaborador</h2>
          <dl className="doc-grade">
            <Linha rotulo="Nome" valor={doc.colaborador.nome} largo />
            <Linha rotulo="CPF" valor={doc.colaborador.cpf ? formatCpf(doc.colaborador.cpf) : null} />
            <Linha rotulo="Matrícula" valor={doc.colaborador.matricula} />
            <Linha rotulo="Setor" valor={doc.colaborador.setor} />
            <Linha rotulo="Subsetor" valor={doc.colaborador.subsetor} />
            <Linha rotulo="Função" valor={doc.colaborador.funcao} />
            <Linha rotulo="Gestor imediato" valor={doc.colaborador.gestor} />
          </dl>
        </section>

        <section>
          <h2 className="doc-secao">Ocorrência</h2>
          <dl className="doc-grade">
            <Linha rotulo="Data da aplicação" valor={doc.aplicadaEm ? formatDate(doc.aplicadaEm) : null} />
            <Linha rotulo="Código da infração" valor={doc.infracao.codigo} />
            <Linha rotulo="Tipo de infração" valor={doc.infracao.nome} largo />
            {/* gravidade por extenso: o papel sai em preto e branco, e uma
                tarja colorida não diria nada depois de impressa */}
            <Linha rotulo="Gravidade" valor={doc.infracao.gravidade ? INFRACTION_SEVERITY[doc.infracao.gravidade] : null} />
          </dl>
          {doc.infracao.descricao && (
            <p className="doc-texto"><strong>Descrição:</strong> {doc.infracao.descricao}</p>
          )}
          {doc.informacaoComplementar && (
            <p className="doc-texto"><strong>Informação complementar:</strong> {doc.informacaoComplementar}</p>
          )}
        </section>

        <section>
          <h2 className="doc-secao">Punição aplicada</h2>
          <p className="doc-destaque">{doc.punicao ?? "Não informada"}</p>
          <p className="doc-texto">
            Declaro estar ciente da ocorrência acima e da punição aplicada, bem como de que a
            reincidência poderá acarretar medidas disciplinares mais severas, nos termos das normas
            internas da empresa e da legislação trabalhista vigente.
          </p>
        </section>

        <section className="doc-assinaturas">
          {["Colaborador", "Gestor imediato", "Recursos Humanos", "Diretoria"].map((quem) => (
            <div key={quem} className="doc-assinatura">
              <div className="doc-linha-assinatura" />
              <div className="doc-quem">{quem}</div>
              <div className="doc-data">Data: ____ / ____ / ________</div>
            </div>
          ))}
        </section>

        <footer className="doc-rodape">
          <span>Lançado por {doc.lancadoPor ?? "não informado"}</span>
          {doc.decididoPor && <span> · Decidido por {doc.decididoPor}</span>}
          {doc.motivoDaDecisao && <span> · {doc.motivoDaDecisao}</span>}
        </footer>
      </article>
    </div>
  );
}

function Linha({ rotulo, valor, largo }: { rotulo: string; valor: string | null; largo?: boolean }) {
  return (
    <div className={largo ? "doc-campo doc-campo-largo" : "doc-campo"}>
      <dt>{rotulo}</dt>
      <dd>{valor ?? "-"}</dd>
    </div>
  );
}
