export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Aviso não-bloqueante: a ação salvou, mas algo secundário falhou (ex.: convite por e-mail). */
  warning?: string;
};

export const initialActionState: ActionState = {};
