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
  // "gpt-5.1-mini" não existe na OpenAI (testado em 12/11/2026): o mini da família 5 é o gpt-5-mini
  { value: "gpt-5-mini", label: "GPT-5 mini" },
  { value: "gpt-5.1", label: "GPT-5.1" },
];

/**
 * Para ler atestados (foto ou PDF), do mais indicado ao mais caro. Todos testados
 * num atestado fictício em 12/11/2026: os 4.x respondem em 2 a 3 s; os 5.x
 * (raciocínio) em 8 a 12 s.
 */
const VISION_MODELS = [
  { value: "gpt-4.1", label: "GPT-4.1 (recomendado)" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 mini (econômico)" },
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-5-mini", label: "GPT-5 mini (mais lento)" },
  { value: "gpt-5.1", label: "GPT-5.1 (mais preciso, mais lento)" },
];

export function OpenAISettingsForm({
  hasKey,
  model,
  transcribeModel,
  visionModel,
  canEdit,
}: {
  hasKey: boolean;
  model: string;
  transcribeModel: string;
  visionModel: string;
  canEdit: boolean;
}) {
  const [state, action] = useActionState(setOpenAISettings, initialActionState);
  const modeloOuPadrao = (m: string) => (MODELS.some((x) => x.value === m) ? m : "gpt-4.1-mini");
  const imagemOuPadrao = (m: string) => (VISION_MODELS.some((x) => x.value === m) ? m : "gpt-4.1");
  const transcricaoOuPadrao = (m: string) => ((TRANSCRIBE_MODELS as readonly string[]).includes(m) ? m : "gpt-4o-mini-transcribe");
  const [modelSel, setModelSel] = useState(modeloOuPadrao(model));
  const [visionSel, setVisionSel] = useState(imagemOuPadrao(visionModel));
  const [transcribeSel, setTranscribeSel] = useState(transcricaoOuPadrao(transcribeModel));

  // depois de salvar, os valores gravados voltam pelas props: os selects acompanham
  // (ajuste durante a renderização, sem efeito)
  const [gravados, setGravados] = useState({ model, visionModel, transcribeModel });
  if (gravados.model !== model || gravados.visionModel !== visionModel || gravados.transcribeModel !== transcribeModel) {
    setGravados({ model, visionModel, transcribeModel });
    setModelSel(modeloOuPadrao(model));
    setVisionSel(imagemOuPadrao(visionModel));
    setTranscribeSel(transcricaoOuPadrao(transcribeModel));
  }

  // o aviso de salvo some sozinho: o estado só muda dentro do timer
  const [avisoVisto, setAvisoVisto] = useState<object | null>(null);
  useEffect(() => {
    if (!state.ok) return;
    const t = setTimeout(() => setAvisoVisto(state), 2500);
    return () => clearTimeout(t);
  }, [state]);
  const saved = state.ok && avisoVisto !== state ? (state.message ?? "Salvo") : "";

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
        Usada para gerar Anotações e Decisões das reuniões e para ler atestados no Absenteísmo. A chave
        fica guardada de forma isolada e nunca é exibida novamente: só é usada no servidor.
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

      <div>
        <label className="label">Modelo de leitura de imagens</label>
        <select name="openai_vision_model" className="input" value={visionSel} onChange={(e) => setVisionSel(e.target.value)}>
          {VISION_MODELS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <p className="soft" style={{ fontSize: "0.78rem", marginTop: "0.3rem" }}>
          Usado no &quot;Preencher com IA&quot; dos atestados. O GPT-4.1 lê documento e letra de mão melhor que o
          mini e responde rápido; o GPT-5.1 erra menos, mas demora mais e custa mais.
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
