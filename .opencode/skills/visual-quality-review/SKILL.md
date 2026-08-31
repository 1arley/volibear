---
name: visual-quality-review
description: Evaluates typography, spacing, hierarchy, density, contrast, composition, consistency, visual noise, and generic AI slop patterns against a high craft bar.
license: MIT
metadata:
    aes-category: frontend
    aes-priority: medium
---

# Visual Quality Review

## Objective

Ensinar o agente a avaliar a **qualidade de execução visual** de uma interface contra
um bar padrão de craft: tipografia, spacing, hierarquia, densidade, contraste,
composição, consistência, ruído visual, e padrões genéricos de AI slop.

## When to Use

* Em qualquer revisão de frontend que não seja só de UX ou interação.
* Quando uma interface parece "genérica", "feia", "amadora", ou "feita por IA".
* Quando o pedido menciona "visual quality", "craft", "polish", "typography",
  "spacing", "hierarchy", "AI slop", "generic", "boring".
* **Composição:** roda com `ux-review` (UX + visual são complementares) e
  `interaction-design` (visual + interação = experiência completa). Consulta
  `references/frontend.yaml` (Impeccable, Impeccable Slop, Dribbble, Interfaces).

## Mental Model

Qualidade visual não é subjetiva — é uma execução de princípios de design. Os eixos
são mensuráveis:

| Eixo | O que avaliar |
|---|---|
| **Tipografia** | hierarchy consistente, escala, line-height, legibilidade, contraste de fonte |
| **Spacing** | sistema de ritmo, padding interno vs externo, alinhamento vertical/horizontal |
| **Hierarchy** | peso visual que comunica importância relativa, não só tamanho |
| **Density** | informação compactada ou espaçada demais? |
| **Contrast** | texto vs fundo, componentes vs background, modo escuro/claro |
| **Composition** | balance, grid, alinhamento, margens, corners |
| **Consistency** | o mesmo padrão visual resolve o mesmo problema em toda a interface |
| **Visual noise** | elementos decorativos sem função, bordas desnecessárias, cores demais |
| **AI slop** | padrões genéricos que indicam output de IA sem revisão |

## Investigation Procedure

1. **Avaliar tipografia** — há escala consistente? (h1 > h2 > h3 > body > caption)
   O line-height é legível? O contraste de fonte é suficiente? A fonte é apropriada
   para o contexto?
2. **Avaliar spacing** — há um sistema de ritmo (4px nem sempre, mas consistente)?
   Elementos relacionados estão próximos? Elementos diferentes estão separados?
3. **Avaliar hierarchy** — a ação primária é a mais proeminente? Informações de mesmo
   nível têm o mesmo peso visual? A hierarquia é comunicada por mais de um sinal
   (tamanho + peso + cor + espaçamento)?
4. **Avaliar density** — o conteúdo é denso demais? (exaustivo) ou esparso demais?
   (precisa scroll infinito para ver nada)
5. **Avaliar contrast** — texto body tem ≥ 4.5:1? O contraste de componentes é
   suficiente? Modo escuro recalculou cores ou só inverteu?
6. **Avaliar composition** — grid consistente? Alinhamento vertical/horizontal correto?
   Margens e paddings consistentes? Corners uniformes?
7. **Avaliar visual noise** — há elementos decorativos que não servem à função
   (bordas, ícones, cores, gradientes, sombras)? Há informações redundantes?
8. **Avaliar AI slop** — padrões genéricos: ícones Lucide sem personalidade, ondas
   SVG repetitivas, "Build Something Amazing", "Empower Your Team", roxo-azul
   gradiente, cartões sem conteúdo real, avatares genéricos.
9. **Sintetizar** — referenciar `references/frontend.yaml` (Impeccable, Impeccable
   Slop, Interfaces) quando apropriado.

## Questions to Ask

* A tipografia tem escala consistente? A fonte é legível no tamanho usado?
* O spacing é consistente ou parece aleatório? (padding varia sem motivo)
* A hierarquia visual comunica o que é importante? (ou tudo parece igual)
* A densidade é apropriada para o conteúdo? (informação compactada vs perdida)
* O contraste de texto é suficiente (≥ 4.5:1)? O modo escuro recalcula ou é acidental?
* O grid é consistente? Alinhamentos estão corretos?
* Há elementos decorativos sem função? (visual noise)
* A interface parece "genérica"? (mesmo gradiente, mesmo ícone, mesmo "Build
  Something" — AI slop)

## Attack Patterns

```text
typography broken
    h1 = 32px, h2 = 28px, h3 = 18px  (escala inconsistente — gap de 2px vs 10px)
    body = 14px com line-height 1.2 (ilegível)
    fonte display para body text (cansativa)

spacing random
    padding: 24px em um card, 16px em outro (mesmo tipo)
    elementos relacionados com 40px de gap; unrelated com 8px

hierarchy flat
    preço (importante) e "em até 3x sem juros" (secundário) têm mesmo size/weight
    → usuário não sabe o que é o valor principal

density wrong
    form com 3 campos + 2 botões ocupando 100% da viewport (esparso demais)
    tabela com 10 colunas sem scroll horizontal (denso demais)

contrast insufficient
    gray-400 (#9CA3AF) em gray-50 (#F9FAFB) — 1.8:1, invisível
    placeholder cinza claro em fundo branco

composition broken
    margem esquerda 24px, direita 16px (não centrado)
    grid com gutter inconsistente

AI slop detected
    "Build Something Amazing" como headline
    gradiente azul-roxo padrão
    ondas SVG decorativas sem sentido
    avatares de usuário genéricos (UI Avatars sem personalização)
    "Lorem ipsum" em produção
    tooltip genérico "This is a tooltip"
    "Empower Your Workflow" como subheading
```

## Evidence Requirements

* **Nomear o eixo** (tipografia/spacing/hierarchy/density/contrast/composition/
  noise/slop).
* **Mostrar o elemento exato** e a violação do princípio (ex: "h1=32px, h2=28px no
  header, mas h2=20px no card — inconsistência de escala").
* **Referenciar o padrão esperado** (escala, sistema de spacing, grid, WCAG contrast).
* **Escalar confiança (Visual Quality):**
  * `CONFIRMED` — violação mensurável (ex: contraste 2.1:1, escala inconsistente, grid
    quebrado, AI slop identificável).
  * `HIGH CONFIDENCE` — violação clara de princípio.
  * `POSSIBLE` — subjetivo, pode ser questão de gosto.
  * `SPECULATIVE` — preferência pessoal não fundamentada.

## False Positives

* **Design system define o padrão** — se o design system tem uma escala de tipografia
  e a interface segue, "inconsistência" é entre a interface e o sistema, não um erro
  da interface. Reportar como desvio do design system, não como erro visual.
* **Modo escuro é propositalmente diferente** — algumas cores são intencionalmente
  diferentes no modo escuro (não-simples inversão). Verificar decisão de design.
* **AI slop é intencional e não há budget para refinar** — reportar como nota, não
  como defeito. Marcar `POSSIBLE` e contextualizar.
* **Density é intencional** — landing pages são esparsas por design; dashboards são
  densas por design. Avaliar contra o propósito da tela, não contra um padrão absoluto.
* **Visual noise tem função** — decoração que comunica identidade de marca não é noise.
  Avaliar se serve a marca ou é só poluição.

## Output Format

Para cada violação, um finding via `templates/audit-report.md`. Em **Affected
component**, nomeie o componente/tela. Em **Reproduction**, mostre o elemento e a
violação (incluindo valor de contraste, tamanhos, gap). Em **Root cause**, aponte o
eixo. Em **Recommendation**, dê a correção concreta (escala de fonte, sistema de
spacing, cor de contraste, remoção de AI slop, grid consistente).

Apresente por eixo. Contrast e typography (impacto direto em legibilidade) primeiro;
spacing e hierarchy depois; composition e noise/slop em seguida.
