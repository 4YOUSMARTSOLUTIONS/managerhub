"use client";

import { useActionState, useEffect, useState } from "react";
import { setOpenAISettings } from "@/lib/actions/ai";
import { initialActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TRANSCRIBE_MODELS, TRANSCRIBE_MODEL_LABEL } from "@/lib/constants";

const MODELS = [
  { value: "gpt-4.1-mini", label: "GPT-4.1 mini (padrão)" },
  { value: "gpt-4.1", label: "GPT-4.1" },
  { value: "gpt-4.1-nano", label: "GPT-4.1 nano" },
  { value: "gpt-4o-mini", label: "GPT-4o mini" },
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-5.1-mini", label: "GPT-5.1 mini" },
  { value: "gpt-5.1", label: "GPT-5.1" },
];

export function OpenAISettingsForm({
  hasKey,
  model,
  transcribeModel,
  canEdit,
}: {
  hasKey: boolean;
  model: string;
  transcribeModel: string;
  canEdit: boolean;
}) {
  const [state, action] = useActionState(setOpenAISettings, initialActionState);
  const [saved, setSaved] = useState("");
  const [modelSel, setModelSel] = useState(MODELS.some((m) => m.value === model) ? model : "gpt-4.1-mini");
  const [transcribeSel, setTranscribeSel] = useState(
    (TRANSCRIBE_MODELS as readonly string[]).includes(transcribeModel) ? transcribeModel : "gpt-4o-mini-transcribe",
  );

  // ressincroniza os selects com o valor persistido após salvar (revalidação)
  useEffect(() => {
    setModelSel(MODELS.some((m) => m.value === model) ? model : "gpt-4.1-mini");
  }, [model]);
  useEffect(() => {
    setTranscribeSel((TRANSCRIBE_MODELS as readonly string[]).includes(transcribeModel) ? transcribeModel : "gpt-4o-mini-transcribe");
  }, [transcribeModel]);

  useEffect(() => {
    if (state.ok) {
      setSaved(state.message ?? "Salvo");
      const t = setTimeout(() => setSaved(""), 2500);
      return () => clearTimeout(t);
    }
  }, [state]);

  if (!canEdit) {
    return (
      <div className="soft" style={{ fontSize: "0.85rem" }}>
        {hasKey ? "✓ Chave da OpenAI configurada. " : "Integração com IA não configurada. "}
        Apenas o proprietário pode configurar a chave da OpenAI.
      </div>
    );
  }

  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: "0.8rem", maxWidth: 460 }}>
      <p className="soft" style={{ fontSize: "0.82rem", margin: 0 }}>
        Usada para gerar Anotações e Decisões das reuniões com IA. A chave fica guardada de forma isolada e
        nunca é exibida novamente — só é usada no servidor.
      </p>

      <div>
        <label className="label">
          Chave da API OpenAI{" "}
          <span className={`badge ${hasKey ? "badge-green" : "badge-gray"}`} style={{ marginLeft: 6 }}>
            {hasKey ? "✓ Configurada" : "Não configurada"}
          </span>
        </label>
        <input
          name="openai_api_key"
          type="password"
          className="input"
          placeholder={hasKey ? "•••••••• (deixe em branco para manter)" : "sk-…"}
          autoComplete="off"
        />
      </div>

      <div>
        <label className="label">Modelo</label>
        <select name="openai_model" className="input" value={modelSel} onChange={(e) => setModelSel(e.target.value)}>
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <p className="soft" style={{ fontSize: "0.78rem", marginTop: "0.3rem" }}>
          Padrão: gpt-4.1-mini (econômico e suficiente para organizar texto).
        </p>
      </div>

      <div>
        <label className="label">Modelo de transcrição</label>
        <select name="openai_transcribe_model" className="input" value={transcribeSel} onChange={(e) => setTranscribeSel(e.target.value)}>
          {TRANSCRIBE_MODELS.map((m) => (
            <option key={m} value={m}>{TRANSCRIBE_MODEL_LABEL[m]}</option>
          ))}
        </select>
        <p className="soft" style={{ fontSize: "0.78rem", marginTop: "0.3rem" }}>
          Usado para transcrever o áudio das reuniões gravadas. O diarize identifica os locutores.
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <SubmitButton>Salvar</SubmitButton>
        {hasKey && (
          <button
            type="submit"
            name="clear"
            value="1"
            className="btn btn-ghost"
            formNoValidate
          >
            Remover chave
          </button>
        )}
        {saved && <span className="badge badge-green">{saved}</span>}
        {state.error && <span className="badge badge-red">{state.error}</span>}
      </div>
    </form>
  );
}
