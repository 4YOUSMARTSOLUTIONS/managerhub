# Regras visuais do MANAGERHUB

Regras curtas e normativas. O objetivo é um SaaS profissional: cada tela conta
uma história em camadas, e cor é um recurso escasso.

## Cor é para o que pede ação

- **Badge tintado** (`<Badge tone="...">`) é reservado a STATUS operacional:
  em apuração, atrasado, aguardando triagem, bloqueada, vencido. É o que
  responde "onde preciso agir".
- **Badge quiet** (`<Badge variant="quiet" tone="...">`) é o nível de
  taxonomia e cadastro: classe, tipo, natureza, categoria, perfil,
  visibilidade, ativo/inativo, prioridade em listagem. Corpo neutro, a cor do
  tom vira um ponto de 6px. `tone="gray"` quiet não mostra ponto.
- **Regra de ouro: UMA pílula tintada por linha de tabela e por cabeçalho de
  painel.** Se duas coisas parecem merecer cor, uma delas é taxonomia.
- Cor definida pelo usuário (etiquetas do planner) e contadores numéricos não
  são status: não usar a pílula tintada para eles.

## Ficha de detalhe (painel/modal de leitura)

Anatomia, nesta ordem: título (quem/quando) → status + resumo → contexto em
seções → ações. Camadas separadas por `DetailSection`.

- Modal de leitura usa `DetailModal` (`src/components/ui/DetailModal.tsx`):
  overlay, largura (`sm` 480 / `md` 620 / `lg` 760), z-index 60 e botão
  fechar padronizados. Não copiar overlay na mão.
- Campos usam `Field` dentro de `FieldGrid`
  (`src/components/ui/Field.tsx`): rótulo 0.7rem/600 uppercase `--mh-text-3`,
  valor 0.88rem `--mh-text-1`, vazio = `—`. O `FieldGrid` é um bloco
  `--mh-surface-2` (modelo DemandaPanel), nunca uma grade solta no fundo do
  card.
- Mais de ~6 campos: agrupar em `DetailSection` nomeadas (ex.: Vínculo /
  O ocorrido / Registro legal), não numa grade única.

## Modais

- Escala de largura: 480 / 620 / 760. Nada fora disso sem motivo escrito.
- z-index: 60 para modal de conteúdo; confirmações por cima usam 70+.
  `EscToClose` varre a faixa 40–89 e clica `button[aria-label="Fechar"]`:
  todo modal precisa desse aria-label.

## Nomes e texto

- Nome de pessoa em tabela e badge: `shortName()` (primeiro + último).
  Nome completo só em exportação e documentos.
- Sem travessão "—" em frases; ele é só o marcador de campo vazio.
- Uma informação por coluna de tabela; nada de empilhar subtítulos e badges
  na mesma célula.
