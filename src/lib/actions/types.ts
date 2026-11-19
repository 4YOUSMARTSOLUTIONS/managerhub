export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Aviso não-bloqueante: a ação salvou, mas algo secundário falhou (ex.: convite por e-mail). */
  warning?: string;
  /**
   * Para onde ir depois, quando a ação leva para DENTRO do portal vindo de fora
   * dele: o formulário entra com carga completa (useEntrarNoPortal), em vez de
   * redirect() da action, que é navegação interna.
   */
  destino?: string;
};

export const initialActionState: ActionState = {};
