---
name: ux-review
description: Evaluates clarity, hierarchy, cognitive load, feedback, affordances, consistency, navigation, empty states, errors, loading, and progress indicators in a user interface against established UX principles.
license: MIT
metadata:
    aes-category: frontend
    aes-priority: medium
---

# UX Review

## Objective

Ensinar o agente a avaliar a experiência do usuário de uma interface contra princípios
estabelecidos: clareza, hierarquia, carga cognitiva, feedback, affordances,
consistência, navegação, estados vazios, erros, e loading.

## When to Use

* Antes de lançar ou revisar uma tela/fluxo que o usuário vê.
* Quando o pedido menciona "UX", "usability", "user experience", "confusing",
  "unclear", "clarity", "feedback".
* Em qualquer revisão de frontend que não seja puramente visual (ver
  `visual-quality-review` para o visual).
* **Composição:** roda com todas as frontend skills (especialmente `visual-quality-review` e `interaction-design`). Pareia também com `user-flow-audit` (fluxos) e
  `reference-research` (referências de UX de `references/ux.yaml`).

## Mental Model

UX não é sobre beleza — é sobre **reduzir a distância entre a intenção do usuário e o
efeito no sistema**. Toda ambiguidade, pausa, ou descoberta é atrito.

Seis princípios base:

1. **Clareza** — o usuário entende o que está vendo, o que pode fazer, e o que cada
   ação faz.
2. **Hierarquia** — o layout comunica importância relativa: mais importante = maior,
   mais perto do topo, mais contraste.
3. **Carga cognitiva** — quanta informação o usuário precisa reter para agir. Quanto
   menos, melhor.
4. **Feedback** — toda ação deve ter resposta visível em < 100ms (imediata) ou
   indicador de progresso (se > 1s). O estado do sistema é sempre visível.
5. **Affordances** — elementos comunicam sua função. Botões parecem clicáveis, inputs
   parecem editáveis, items não-clicáveis não parecem botões.
6. **Consistência** — o mesmo padrão visual/comportamental resolve o mesmo problema em
   toda a interface. Modais não variam; botões primários não alternam cor.

## Investigation Procedure

1. **Capturar / revisar a tela** — lista de componentes, fluxo, estados.
2. **Avaliar clareza** — o título/heading explica o que é esta página? A ação primária
   é óbvia? Labels são descritivas?
3. **Avaliar hierarquia** — o elemento mais importante é o mais proeminente? Há
   hierarquia visual (tamanho, peso, cor, espaçamento) ou é tudo igual?
4. **Avaliar carga cognitiva** — quantos elementos o usuário precisa processar antes
   de agir? Há informação redundante? Há campos desnecessários?
5. **Avaliar feedback** — ações têm resposta imediata? Loading states existem? O
   sistema mostra o estado atual após cada ação? Erros são comunicados perto do campo?
6. **Avaliar affordances** — botões parecem clicáveis? Links parecem links?
   Inputs parecem editáveis? Texto pleno parece clicável? (se sim, affordance falsa)
7. **Avaliar consistência** — o mesmo tipo de ação usa o mesmo componente em toda a
   interface? (todos os "salvar" são iguais? todos os "cancelar" são iguais?)
8. **Avaliar navegação** — o usuário sabe onde está? Sabe como voltar? Sabe onde
   encontrar ações importantes? Há breadcrumbs/back consistentes?
9. **Avaliar estados vazios** — o que aparece quando não há dados? Guia, instrução, ou
   espaço vazio? (empty state deve ser útil, não confuso)
10. **Avaliar erros e loading** — erros são legíveis e acionáveis? Loading é visível e
    não bloqueia para sempre? (ver `error-flow-audit` para erros server-side)
11. **Sintetizar** com o formato de saída, referenciando `references/ux.yaml` quando
    apropriado.

## Questions to Ask

* O usuário entende o que esta página/tela faz sem ler um tutorial?
* Qual é a ação primária? Ela é a mais proeminente visualmente?
* Quantos elementos competem pela atenção do usuário ao mesmo tempo?
* Toda ação dá feedback imediato? (visual, não só console.log)
* O estado do sistema (salvo, carregando, erro) é visível sem o usuário precisar
  adivinhar?
* Botões parecem clicáveis? Inputs parecem editáveis? Texto pleno parece link?
* O mesmo padrão repete para o mesmo problema? (botões, modais, notificações, menus)
* O usuário sabe onde está e como voltar? (navegação, breadcrumbs, back)
* O que aparece quando não há dados? (empty state: útil ou vazio?)
* Erros são legíveis ("Campo obrigatório" vs "Error 500 — contact support")?
* Loading é visível e não bloqueia para sempre? (skeleton, spinner, ou tela branca?)

## Attack Patterns

```text
clarity failure
    título "Dashboard" → dashboard de quê? de quem? sem contexto
    botão "Submit" → submit o quê? para onde? o que acontece depois?

hierarchy flattened
    ação primária (salvar) e secundária (cancelar) têm o mesmo peso visual
    → usuário hesita, erra, ou ignora a primária

cognitive overload
    form com 20 campos, 3 seções, 2 tipos de validação
    → taxa de abandono alta, erros frequentes

feedback absent
    "Save" → sem loading, sem confirmação, sem erro
    → usuário clica de novo (duplo submit) ou não sabe se salvou

affordance false
    card de perfil clicável leva ao perfil (não parece clicável)
    → usuário não descobre que pode editar clicando

consistency broken
    modal de confirmação: "Save" verde / "Cancel" cinza
    mesma ação em outra tela: "Save" azul / "Cancel" vermelho
    → confiança no padrão quebrada

navigation lost
    sem breadcrumbs, sem back button consistente, sem título de página
    → usuário não sabe onde está após 3 cliques

empty state useless
    empty: "No data" — e agora? O que o usuário deve fazer?
    (correto: "No posts yet. Create your first post!" com link)

error not actionable
    "Something went wrong" — qual problema? o que o usuário faz?
    (correto: "Connection lost. Check your internet and retry.")
```

## Evidence Requirements

* **Nomear o princípio violado** (clareza/hierarquia/carga cognitiva/feedback/
  affordance/consistência/navegação/empty state/error).
* **Mostrar o elemento exato** e o porquê da violação (ex: "Dois botões primários",
  "Título vago", "Estado vazio sem ação").
* **Referenciar a fonte de UX** (Laws of UX, Interfaces, etc.) como suporte quando
  relevante — mas não é evidência, é fundamentação.
* **Escalar confiança (UX Review):**
  * `CONFIRMED` — padrão observado, princípio violado, e o impacto é demonstrável
    (ex: usuário hesita, clica errado, abandona).
  * `HIGH CONFIDENCE` — padrão observado, princípio violado, impacto plausível.
  * `POSSIBLE` — violação marginal ou subjetiva.
  * `SPECULATIVE` — preferência pessoal sem fundamento em princípio.

## False Positives

* **Padrão de plataforma** — iOS HIG e Material Design diferem; um padrão "diferente" é
  correto se consistente com a plataforma.
* **Público específico** — alta densidade de informação pode ser intencional para
  power users. Avaliar pelo público-alvo.
* **Empty state com propósito** — "sem dados" pode ser deliberado (ex: não há
  conteúdo e o estado não pede ação). Verificar intenção.
* **Feedback não-visual intencional** — haptic/audio feedback pode substituir visual.
  Não reportar se o feedback existe em outra modalidade.
* **Consistência com design system** — se o design system define o padrão, a variação
  está errada. Verificar contra o design system antes de reportar.
* **Preferência pessoal** — "eu não gosto" não é finding de UX. Toda crítica deve ser
  fundamentada em princípio, não em gosto.

## Output Format

Para cada violação de princípio, um finding via `templates/audit-report.md`. Em
**Affected component**, nomeie o componente/tela. Em **Reproduction**, descreva o que
o usuário vê e o que deveria ver. Em **Root cause**, aponte o princípio violado. Em
**Recommendation**, dê a correção concreta de UX (título, realce da ação primária,
empty state guiado, feedback adicionado, affordance corrigida, consistência de padrão).

Apresente por princípio violado. Impacto em fluxo (navegação perdida, erro não
acionável) primeiro; clareza e hierarquia depois; affordance/consistência/empty state
em seguida.
