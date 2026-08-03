"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { AvatarCropper } from "@/components/AvatarCropper";
import { Badge } from "@/components/ui/Badge";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { confirmDialog } from "@/components/ui/confirm";
import { changeOwnPassword, getOwnProfile, removeOwnAvatar, updateOwnAvatar, type OwnProfile } from "@/lib/actions/profile";
import { initialActionState } from "@/lib/actions/types";
import { AVATAR_MIMES } from "@/lib/avatar";
import { ROLE } from "@/lib/constants";
import { formatCpf } from "@/lib/cpf";
import { formatDate } from "@/lib/format";
import type { Enums } from "@/types/database";

const GENDER: Record<string, string> = {
  masculino: "Masculino", feminino: "Feminino", outro: "Outro", nao_informado: "Não informado",
};

const sectionTitle: React.CSSProperties = {
  fontSize: "0.74rem", fontWeight: 700, textTransform: "uppercase",
  letterSpacing: "0.04em", color: "var(--text-soft)", margin: 0,
};

const grid: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.85rem",
};

/** Rótulo em cima, valor embaixo. Texto puro, não input desabilitado, que parece campo quebrado. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="soft" style={{ fontSize: "0.74rem" }}>{label}</div>
      <div style={{ fontSize: "0.88rem", marginTop: 2, wordBreak: "break-word" }}>{children || "—"}</div>
    </div>
  );
}

/**
 * Meu perfil: a pessoa confere os próprios dados e troca a senha.
 *
 * Nada do cadastro é editável aqui de propósito. A única coisa que o usuário altera
 * é a senha e a foto. Fecha só por X ou Cancelar, nunca por clique no fundo.
 */
export function ProfileDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [p, setP] = useState<OwnProfile | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    getOwnProfile().then((r) => { if (vivo) { setP(r); setCarregando(false); } });
    return () => { vivo = false; };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(3, 6, 14, 0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 1rem", zIndex: 70, overflowY: "auto" }}>
      <div className="card" style={{ width: "100%", maxWidth: 640, boxShadow: "var(--mh-shadow-e3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.02rem", fontWeight: 700, margin: 0 }}>Meu perfil</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", lineHeight: 1, color: "var(--text-muted)" }}>×</button>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {carregando ? (
            <p className="soft" style={{ margin: 0, fontSize: "0.88rem" }}>Carregando…</p>
          ) : !p ? (
            <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--mh-danger)" }}>Não foi possível carregar o perfil.</p>
          ) : (
            <>
              <PhotoBlock profile={p} onDone={() => { router.refresh(); getOwnProfile().then(setP); }} />

              <section style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <p style={sectionTitle}>Meus dados</p>
                  <Badge tone="gray">Somente leitura</Badge>
                </div>
                <p className="soft" style={{ margin: 0, fontSize: "0.78rem" }}>
                  Estes dados são mantidos pela administração da empresa. Para corrigir algo, fale com o administrador do sistema.
                </p>
                <div style={grid}>
                  <Field label="Nome completo">{p.fullName}</Field>
                  <Field label="E-mail">{p.email}</Field>
                  <Field label="CPF">{p.cpf ? formatCpf(p.cpf) : null}</Field>
                  <Field label="Telefone">{p.phone}</Field>
                  <Field label="Data de nascimento">{p.birthDate ? formatDate(p.birthDate) : null}</Field>
                  <Field label="Sexo">{p.gender ? GENDER[p.gender] ?? p.gender : null}</Field>
                </div>
                <div style={{ ...grid, marginTop: "0.3rem" }}>
                  <Field label="Empresa">{p.company}</Field>
                  <Field label="Tipo de acesso">{ROLE[p.role as Enums<"member_role">] ?? p.role}</Field>
                  <Field label="Matrícula">{p.employeeCode}</Field>
                  <Field label="Admissão">{p.admissionDate ? formatDate(p.admissionDate) : null}</Field>
                  <Field label="Setor">{p.department}</Field>
                  <Field label="Subsetor">{p.subdepartment}</Field>
                  <Field label="Função">{p.position}</Field>
                  <Field label="Gestor">{p.manager}</Field>
                </div>
              </section>

              <PasswordBlock />
            </>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

/** Foto: envio, troca e remoção. A pré-visualização usa o caminho já salvo. */
function PhotoBlock({ profile, onDone }: { profile: OwnProfile; onDone: () => void }) {
  const [escolhida, setEscolhida] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, start] = useTransition();

  /**
   * O confirmDialog roda FORA da transição: dentro dela o portal não renderiza, a
   * promise nunca resolve e a tela trava. Mesma observação já registrada em
   * ChecklistsManager.tsx:210.
   */
  const remover = async () => {
    if (!(await confirmDialog({ tone: "danger", confirmLabel: "Remover", message: "Remover sua foto de perfil?" }))) return;
    start(async () => {
      const r = await removeOwnAvatar();
      if (r.error) setErro(r.error); else { setErro(null); onDone(); }
    });
  };

  /** o recorte já sai em AVATAR_SIZE; o servidor normaliza de novo como garantia */
  const enviarRecorte = (blob: Blob) => {
    start(async () => {
      const fd = new FormData();
      fd.append("avatar", new File([blob], "avatar.webp", { type: "image/webp" }));
      const r = await updateOwnAvatar(initialActionState, fd);
      if (r.error) setErro(r.error);
      else { setErro(null); setEscolhida(null); onDone(); }
    });
  };

  return (
    <section style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
      <Avatar name={profile.fullName} path={profile.avatarPath} size={72} />
      <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem", minWidth: 0 }}>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          <label className="btn btn-ghost btn-sm" style={{ cursor: ocupado ? "default" : "pointer" }}>
            <Camera size={14} /> {profile.avatarPath ? "Trocar foto" : "Enviar foto"}
            <input
              type="file"
              accept={AVATAR_MIMES.join(",")}
              hidden
              disabled={ocupado}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = ""; // permite escolher o MESMO arquivo de novo
                if (f) { setErro(null); setEscolhida(f); }
              }}
            />
          </label>
          {profile.avatarPath && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={ocupado} onClick={remover} style={{ color: "var(--mh-danger)" }}>
              <Trash2 size={14} /> Remover
            </button>
          )}
        </div>
        <span className="soft" style={{ fontSize: "0.76rem", lineHeight: 1.5 }}>
          Qualquer foto serve: você escolhe o enquadramento na próxima etapa.<br />
          JPG, PNG ou WebP, até 2 MB.
        </span>
        {erro && <span style={{ fontSize: "0.8rem", color: "var(--mh-danger)" }}>{erro}</span>}
      </div>

      {escolhida && (
        <AvatarCropper
          file={escolhida}
          saving={ocupado}
          onCancel={() => setEscolhida(null)}
          onConfirm={enviarRecorte}
        />
      )}
    </section>
  );
}

/** Troca de senha: a única coisa editável da tela. */
function PasswordBlock() {
  const [state, formAction] = useActionState(changeOwnPassword, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => { if (state.ok) formRef.current?.reset(); }, [state]);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "0.7rem", borderTop: "1px solid var(--border)", paddingTop: "1.2rem" }}>
      <p style={sectionTitle}>Trocar senha</p>
      <form action={formAction} ref={formRef} style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
        <div>
          <label className="label" htmlFor="current_password">Senha atual</label>
          <PasswordInput id="current_password" name="current_password" autoComplete="current-password" />
        </div>
        <div style={grid}>
          <div>
            <label className="label" htmlFor="new_password">Nova senha</label>
            <PasswordInput id="new_password" name="new_password" autoComplete="new-password" minLength={6} />
          </div>
          <div>
            <label className="label" htmlFor="confirm_password">Repita a nova senha</label>
            <PasswordInput id="confirm_password" name="confirm_password" autoComplete="new-password" minLength={6} />
          </div>
        </div>
        {state.error && (
          <p style={{ color: "var(--mh-danger)", fontSize: "0.85rem", margin: 0, background: "var(--mh-danger-soft)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
            {state.error}
          </p>
        )}
        {state.ok && (
          <p style={{ color: "var(--mh-success)", fontSize: "0.85rem", margin: 0 }}>{state.message ?? "Senha alterada."}</p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <SubmitButton>Alterar senha</SubmitButton>
        </div>
      </form>
    </section>
  );
}
