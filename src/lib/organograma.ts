/**
 * Geometria do organograma em faixas.
 *
 * Fica fora do componente de propósito: é a única parte com regra de verdade
 * (em que faixa cada pessoa cai, onde a linha começa e termina) e, separada,
 * pode ser conferida contra o banco sem abrir o navegador.
 *
 * Sem React aqui. Entra uma árvore de ids com o rank de cada um, sai a posição
 * de cada cartão e o traçado de cada linha.
 */

export type NoOrg = {
  id: string;
  /** ordem da hierarquia: menor = mais alto. `null` = não preenchido no cadastro */
  rank: number | null;
  /** nome do nível, só para rotular a faixa */
  hierarquia: string | null;
  filhos: NoOrg[];
};

export type Medidas = {
  cardW: number;
  cardH: number;
  colW: number;
  rowH: number;
  gutter: number;
};

export type Faixas = {
  nos: { id: string; x: number; y: number; faixa: number }[];
  linhas: { de: string; para: string; x1: number; y1: number; x2: number; y2: number }[];
  faixas: { i: number; nome: string }[];
  largura: number;
  altura: number;
};

/**
 * A FAIXA vem do nível hierárquico, não da profundidade na árvore: é o que faz
 * todo Auxiliar ficar na mesma altura mesmo respondendo a gestores diferentes.
 *
 * Duas regras que o dado exige:
 *
 * - filho NUNCA na mesma faixa do gestor nem acima dele. Se o cadastro disser
 *   que um Coordenador responde a um Auxiliar, a linha subiria e leria como se o
 *   subordinado mandasse. Nesse caso o filho desce para a faixa seguinte.
 * - quem está SEM hierarquia entra na faixa logo abaixo do próprio gestor.
 *
 * A COLUNA é o algoritmo clássico de árvore: cada folha ocupa a próxima vaga,
 * cada gestor fica no meio dos seus. Como a sub-árvore inteira mora dentro da
 * faixa de vagas dela, dois ramos diferentes nunca se sobrepõem — e a regra
 * acima garante que ninguém divide faixa com um ancestral.
 */
export function montarFaixas(raiz: NoOrg, m: Medidas): Faixas {
  const ranks = new Set<number>();
  const varrer = (n: NoOrg) => {
    if (n.rank != null) ranks.add(n.rank);
    n.filhos.forEach(varrer);
  };
  varrer(raiz);
  const idxDoRank = new Map([...ranks].sort((a, b) => a - b).map((r, i) => [r, i]));

  const bruta = new Map<string, number>();
  const atribuir = (n: NoOrg, faixaPai: number | null) => {
    const propria = n.rank != null ? idxDoRank.get(n.rank)! : (faixaPai ?? 0) + 1;
    const faixa = faixaPai == null ? propria : Math.max(propria, faixaPai + 1);
    bruta.set(n.id, faixa);
    n.filhos.forEach((f) => atribuir(f, faixa));
  };
  atribuir(raiz, null);

  // compacta: faixa sem ninguém não vira espaço vazio na tela
  const usadas = [...new Set(bruta.values())].sort((a, b) => a - b);
  const densa = new Map(usadas.map((f, i) => [f, i]));
  const faixaDe = (id: string) => densa.get(bruta.get(id)!)!;

  let vaga = 0;
  const col = new Map<string, number>();
  const posicionar = (n: NoOrg) => {
    if (n.filhos.length === 0) {
      col.set(n.id, vaga++);
      return;
    }
    n.filhos.forEach(posicionar);
    const xs = n.filhos.map((f) => col.get(f.id)!);
    col.set(n.id, (Math.min(...xs) + Math.max(...xs)) / 2);
  };
  posicionar(raiz);

  const nos: Faixas["nos"] = [];
  const linhas: Faixas["linhas"] = [];
  const rotulos = new Map<number, Set<string>>();
  const xDe = (id: string) => m.gutter + col.get(id)! * m.colW;
  const yDe = (id: string) => faixaDe(id) * m.rowH;

  const achatar = (n: NoOrg) => {
    const f = faixaDe(n.id);
    nos.push({ id: n.id, x: xDe(n.id), y: yDe(n.id), faixa: f });
    const nomes = rotulos.get(f) ?? new Set<string>();
    nomes.add(n.hierarquia ?? "Sem hierarquia");
    rotulos.set(f, nomes);
    for (const filho of n.filhos) {
      linhas.push({
        de: n.id,
        para: filho.id,
        x1: xDe(n.id) + m.cardW / 2,
        y1: yDe(n.id) + m.cardH,
        x2: xDe(filho.id) + m.cardW / 2,
        y2: yDe(filho.id),
      });
      achatar(filho);
    }
  };
  achatar(raiz);

  return {
    nos,
    linhas,
    faixas: usadas.map((_, i) => ({ i, nome: [...(rotulos.get(i) ?? [])].join(" / ") })),
    largura: m.gutter + Math.max(1, vaga) * m.colW + 24,
    altura: usadas.length * m.rowH,
  };
}
