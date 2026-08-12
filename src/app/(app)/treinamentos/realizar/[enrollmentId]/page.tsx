import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { moduleGate } from "@/lib/module-gate";
import { getConteudoParaFazer } from "@/lib/actions/training-content";
import { getResumoDaProva } from "@/lib/actions/training-exams";
import { TrainingPlayer } from "@/components/TrainingPlayer";
import { TrainingExamRunner } from "@/components/TrainingExamRunner";
import { cargaHoraria } from "@/lib/training-schedule";
import { formatDateTime } from "@/lib/format";

/**
 * Subrota própria, e não um modal na lista: o player carrega vídeo, controle de
 * progresso e leitor de conteúdo, e nada disso precisa entrar no pacote de quem
 * só quer ver os treinamentos pendentes.
 */
export default async function RealizarTreinamentoPage({
  params,
}: {
  params: Promise<{ enrollmentId: string }>;
}) {
  const gate = await moduleGate("treinamentos");
  if (gate) return gate;

  const { enrollmentId } = await params;
  const conteudo = await getConteudoParaFazer(enrollmentId);
  if (!conteudo) notFound();

  const prova = await getResumoDaProva(conteudo.trainingId, enrollmentId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div>
        <Link href="/treinamentos" className="btn btn-ghost btn-sm" style={{ marginBottom: "0.6rem" }}>
          <ArrowLeft size={14} style={{ marginRight: "0.35rem" }} />
          Voltar
        </Link>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, margin: 0 }}>{conteudo.trainingName}</h1>
        <p className="soft" style={{ fontSize: "0.85rem", margin: "0.3rem 0 0" }}>
          Carga horária de {cargaHoraria(conteudo.workloadMinutes)}.
          {conteudo.description ? ` ${conteudo.description}` : ""}
        </p>
      </div>

      {conteudo.bloqueadoPorPreRequisito ? (
        <div className="card" style={{ padding: "1.5rem", textAlign: "center" }}>
          <p style={{ margin: 0, fontWeight: 600 }}>Este treinamento faz parte de uma trilha.</p>
          <p className="soft" style={{ fontSize: "0.85rem", margin: "0.5rem 0 0" }}>
            {conteudo.trilhaNome}: conclua &quot;{conteudo.preRequisitoNome}&quot; para liberar este.
          </p>
        </div>
      ) : conteudo.bloqueadoPorTurma ? (
        <div className="card" style={{ padding: "1.5rem", textAlign: "center" }}>
          <p style={{ margin: 0, fontWeight: 600 }}>Este treinamento acontece em turma.</p>
          <p className="soft" style={{ fontSize: "0.85rem", margin: "0.5rem 0 0" }}>
            O conteúdo abre quando o instrutor liberar o início
            {conteudo.turmaQuando ? `, previsto para ${formatDateTime(conteudo.turmaQuando)}` : ""}.
          </p>
        </div>
      ) : (
        <>
          <TrainingPlayer conteudo={conteudo} temProva={!!prova} />
          {prova && <TrainingExamRunner enrollmentId={enrollmentId} resumo={prova} />}
        </>
      )}
    </div>
  );
}
