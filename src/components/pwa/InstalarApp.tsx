"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Check, CircleCheck, Copy, Download, Ellipsis, EllipsisVertical, MonitorDown, Share, Share2, SquarePlus,
} from "lucide-react";
import { ehAparelhoMovel, type Plataforma } from "@/lib/pwa";
import { useInstalacao } from "./useInstalacao";

/** Ícone no meio da frase, do jeito que a pessoa vai vê-lo na tela dela. */
function Ic({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      style={{ display: "inline-flex", verticalAlign: "-0.2em", margin: "0 0.1rem", color: "var(--mh-text-1)" }}
    >
      {children}
    </span>
  );
}

interface Guia {
  titulo: string;
  intro?: React.ReactNode;
  passos: React.ReactNode[];
  nota?: React.ReactNode;
}

/**
 * O passo a passo de cada aparelho. Os nomes de menu são os que aparecem no
 * celular em português; quando o navegador muda o nome, a nota dá a outra rota.
 */
function guiaDe(p: Plataforma): Guia {
  switch (p) {
    case "ios-safari":
      return {
        titulo: "No iPhone ou iPad",
        passos: [
          <>Toque em <strong>Compartilhar</strong> <Ic><Share size={15} /></Ic>, na barra do Safari.</>,
          <>Role a lista e toque em <strong>Adicionar à Tela de Início</strong> <Ic><SquarePlus size={15} /></Ic>.</>,
          <>Toque em <strong>Adicionar</strong>. O ícone do Manager HUB aparece na tela inicial.</>,
        ],
        nota: (
          <>
            Abriu pelo WhatsApp? Toque em <strong>Abrir no Safari</strong> antes de começar. No
            aplicativo, o login é pedido uma vez, separado do Safari.
          </>
        ),
      };
    case "ios-outro":
      return {
        titulo: "No iPhone ou iPad",
        passos: [
          <>Toque em <strong>Compartilhar</strong> <Ic><Share size={15} /></Ic>, na barra de endereço.</>,
          <>Toque em <strong>Adicionar à Tela de Início</strong> <Ic><SquarePlus size={15} /></Ic>. Se não aparecer, toque em <strong>Mais</strong>.</>,
          <>Toque em <strong>Adicionar</strong>. O ícone do Manager HUB aparece na tela inicial.</>,
        ],
        nota: <>Não encontrou a opção? Copie o link abaixo e abra no Safari, onde a instalação sempre funciona.</>,
      };
    case "app-interno":
      return {
        titulo: "Abra no navegador primeiro",
        intro: <>Este link abriu dentro de outro aplicativo, como o WhatsApp ou o Instagram, e por ali não dá para instalar.</>,
        passos: [
          <>Toque no menu <Ic><EllipsisVertical size={15} /></Ic> ou <Ic><Ellipsis size={15} /></Ic>, no canto da tela.</>,
          <>Escolha <strong>Abrir no navegador</strong>, <strong>Abrir no Chrome</strong> ou <strong>Abrir no Safari</strong>.</>,
          <>Na página que abrir, siga as instruções de instalação.</>,
        ],
        nota: <>Não achou a opção? Copie o link abaixo e cole no navegador.</>,
      };
    case "android":
      return {
        titulo: "No Android",
        passos: [
          <>Toque no menu <Ic><EllipsisVertical size={15} /></Ic>, no canto superior direito do Chrome.</>,
          <>Toque em <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong>.</>,
          <>Confirme em <strong>Instalar</strong>. O ícone do Manager HUB aparece na tela inicial.</>,
        ],
        nota: (
          <>
            Abriu pelo WhatsApp? Toque em <Ic><EllipsisVertical size={14} /></Ic> e escolha{" "}
            <strong>Abrir no Chrome</strong> antes de começar.
          </>
        ),
      };
    case "mac-safari":
      return {
        titulo: "No Mac, pelo Safari",
        passos: [
          <>No menu <strong>Arquivo</strong> do Safari, clique em <strong>Adicionar ao Dock</strong>.</>,
          <>Clique em <strong>Adicionar</strong>. O Manager HUB fica no Dock como um aplicativo.</>,
        ],
        nota: <>Precisa do macOS Sonoma ou mais novo. Pelo Chrome ou pelo Edge também dá para instalar.</>,
      };
    case "firefox-pc":
      return {
        titulo: "Use o Chrome ou o Edge",
        intro: <>O Firefox do computador não instala aplicativos.</>,
        passos: [
          <>Copie o link abaixo.</>,
          <>Abra o Chrome ou o Edge e cole o link na barra de endereço.</>,
          <>Clique no ícone de instalar <Ic><MonitorDown size={15} /></Ic>, no canto direito da barra.</>,
        ],
      };
    default:
      return {
        titulo: "No computador",
        passos: [
          <>Na barra de endereço, clique no ícone de instalar <Ic><MonitorDown size={15} /></Ic>, no canto direito.</>,
          <>Clique em <strong>Instalar</strong>. O Manager HUB abre numa janela própria e fica no menu Iniciar.</>,
        ],
        nota: (
          <>
            Não aparece o ícone? No Chrome, abra o menu <Ic><EllipsisVertical size={14} /></Ic> e vá em{" "}
            <strong>Transmitir, salvar e compartilhar</strong> &gt; <strong>Instalar página como app</strong>.
            No Edge, menu <Ic><Ellipsis size={14} /></Ic> &gt; <strong>Aplicativos</strong> &gt;{" "}
            <strong>Instalar este site como um aplicativo</strong>. Se já instalou, procure o Manager HUB
            no menu Iniciar.
          </>
        ),
      };
  }
}

const caixaSuave: React.CSSProperties = {
  fontSize: "0.8rem",
  lineHeight: 1.55,
  margin: 0,
  padding: "0.7rem 0.85rem",
  borderRadius: "var(--mh-radius-sm)",
  background: "var(--mh-surface-2)",
};

function Passos({ guia }: { guia: Guia }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
      <div style={{ fontWeight: 700, fontSize: "0.92rem" }}>{guia.titulo}</div>
      {guia.intro && <p className="muted" style={{ fontSize: "0.85rem", lineHeight: 1.5, margin: 0 }}>{guia.intro}</p>}
      <ol role="list" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.65rem" }}>
        {guia.passos.map((passo, i) => (
          <li key={i} style={{ display: "flex", gap: "0.65rem", alignItems: "flex-start", fontSize: "0.875rem", lineHeight: 1.5 }}>
            <span
              aria-hidden
              style={{
                flexShrink: 0, width: 24, height: 24, borderRadius: "50%",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                background: "var(--mh-surface-2)", border: "1px solid var(--mh-border)",
                fontSize: "0.75rem", fontWeight: 700, color: "var(--mh-text-2)",
              }}
            >
              {i + 1}
            </span>
            <span style={{ paddingTop: "0.1rem", minWidth: 0 }}>{passo}</span>
          </li>
        ))}
      </ol>
      {guia.nota && <p className="soft" style={caixaSuave}>{guia.nota}</p>}
    </div>
  );
}

function Pronto({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div
        role="status"
        style={{
          display: "flex", gap: "0.6rem", alignItems: "flex-start",
          padding: "0.85rem 1rem", borderRadius: "var(--mh-radius-sm)",
          background: "var(--mh-success-soft)", color: "var(--mh-success)",
          fontSize: "0.875rem", lineHeight: 1.55,
        }}
      >
        <CircleCheck size={18} style={{ flexShrink: 0, marginTop: "0.1rem" }} />
        <span><strong>{titulo}</strong> {texto}</span>
      </div>
      <Link href="/dashboard" className="btn btn-primary btn-block">Abrir o portal</Link>
    </div>
  );
}

/** O link para mandar a quem ainda não instalou (WhatsApp, e-mail, mural). */
function EnviarLink({ link }: { link: string }) {
  const [copiado, setCopiado] = useState(false);
  const podeCompartilhar = typeof navigator.share === "function";

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      toast.success("Link copiado.");
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      toast.error("Não deu para copiar. Selecione o link e copie à mão.");
    }
  };
  const compartilhar = () => {
    navigator
      .share({ title: "Manager HUB", text: "Instale o aplicativo do Manager HUB:", url: link })
      .catch(() => {
        // a pessoa fechou a caixa de compartilhar: nada a fazer
      });
  };

  return (
    <div style={{ borderTop: "1px solid var(--mh-border)", paddingTop: "1rem" }}>
      <label className="label" htmlFor="link-instalar">Link de instalação</label>
      <div style={{ display: "flex", gap: "0.4rem" }}>
        <input
          id="link-instalar" className="input" readOnly value={link}
          onFocus={(e) => e.currentTarget.select()}
          style={{ flex: 1, minWidth: 0, fontSize: "0.8rem" }}
        />
        <button type="button" className="btn btn-ghost" onClick={copiar} aria-label="Copiar link" title="Copiar link">
          {copiado ? <Check size={16} /> : <Copy size={16} />}
        </button>
        {podeCompartilhar && (
          <button type="button" className="btn btn-ghost" onClick={compartilhar} aria-label="Compartilhar link" title="Compartilhar">
            <Share2 size={16} />
          </button>
        )}
      </div>
      <p className="soft" style={{ fontSize: "0.75rem", margin: "0.4rem 0 0" }}>
        Envie para quem ainda não instalou. Abre no celular e no computador.
      </p>
    </div>
  );
}

/**
 * Corpo da página /instalar. Quando o navegador oferece instalação direta
 * (Chrome e Edge, no Android e no computador), é um botão. Onde não oferece
 * (iPhone, Safari, navegador de dentro do WhatsApp), é o passo a passo.
 */
export function InstalarApp({ link }: { link: string }) {
  const { pronto, instalado, podeInstalar, recemInstalado, plataforma, instalar } = useInstalacao();
  const [aceitou, setAceitou] = useState(false);
  const [recusou, setRecusou] = useState(false);
  const movel = ehAparelhoMovel(plataforma);

  // antes da leitura do aparelho, nada de instrução: ela poderia ser a errada
  if (!pronto) {
    return <p className="soft" style={{ fontSize: "0.85rem", margin: 0 }}>Verificando o seu aparelho…</p>;
  }

  if (instalado) {
    return <Pronto titulo="Você já está no aplicativo." texto="Daqui em diante, abra o Manager HUB pelo ícone." />;
  }
  if (recemInstalado || aceitou) {
    return (
      <Pronto
        titulo="Aplicativo instalado."
        texto={movel
          ? "O ícone do Manager HUB já está na tela inicial. Abra por ele daqui em diante."
          : "O Manager HUB abre numa janela própria e fica no menu Iniciar."}
      />
    );
  }

  const aoInstalar = async () => {
    const r = await instalar();
    if (r === "aceito") setAceitou(true);
    else if (r === "recusado") setRecusou(true);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
      {podeInstalar ? (
        <div>
          <button type="button" className="btn btn-primary btn-block" onClick={aoInstalar}>
            <Download size={16} /> Instalar aplicativo
          </button>
          <p className="soft" style={{ fontSize: "0.78rem", textAlign: "center", margin: "0.5rem 0 0" }}>
            Leva poucos segundos e não passa pela loja de aplicativos.
          </p>
        </div>
      ) : (
        <>
          {recusou && <p className="soft" style={caixaSuave}>Instalação cancelada. Quando quiser, siga os passos abaixo.</p>}
          <Passos guia={guiaDe(plataforma)} />
        </>
      )}
      <EnviarLink link={link} />
    </div>
  );
}
