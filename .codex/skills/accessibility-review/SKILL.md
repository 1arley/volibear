---
name: accessibility-review
description: Evaluates keyboard navigation, screen readers, focus management, semantic HTML, contrast, touch targets, reduced motion, forms, and error handling against WCAG standards.
license: MIT
metadata:
    aes-category: frontend
    aes-priority: high
---

# Accessibility Review

## Objective

Ensinar o agente a avaliar uma interface contra padrões de acessibilidade (WCAG):
keyboard, screen readers, focus, semantic HTML, contrast, touch targets, reduced
motion, forms, e erros. Como define o `plan.md` §10: acessibilidade não é extra — é
parte da definição de qualidade.

## When to Use

* Em qualquer tela que será usada por pessoas reais.
* Antes de lançar features que envolvem formulários, navegação, modal, interação
  complexa, ou conteúdo dinâmico.
* Quando o pedido menciona "accessibility", "a11y", "WCAG", "keyboard", "screen
  reader", "aria", "focus", "contrast", "touch target", "reduced motion".
* **Composição:** roda com todas as frontend skills. Pareia especialmente com
  `interaction-design` (focus, keyboard, feedback), `animation-review` (reduced
  motion), `ux-review` (clareza, erro, feedback), e `visual-quality-review` (contrast).

## Mental Model

Acessibilidade não é sobre "adicionar ARIA". É sobre **garantir que o sistema funciona
independente de como o usuário acessa**. A regra prática: se uma funcionalidade não
funciona só com teclado, ou se o conteúdo não é legível por um screen reader, a
funcionalidade está quebrada para uma parcela dos usuários.

Eixos (do `plan.md` §10):

```text
keyboard         — cada ação é alcançável com Tab/Enter/Esc (sem mouse trap)
screen readers   — conteúdo é legível com SR (alt text, labels, aria-live)
focus            — focus ring visível, ordem lógica, não removido, gerenciado em modais
semantic HTML    — elementos > divs genéricas (button, heading, nav, main, form)
contrast         — texto ≥ 4.5:1 (body) / 3:1 (large) / 3:1 (UI components)
touch targets    — ≥ 44x44px (48x48 recomendado)
reduced motion   — animações respeitam prefers-reduced-motion
forms            — labels, errors, hints, e focus sequence
errors           — comunicados por texto + aria-live, não só cor
```

## Investigation Procedure

1. **Testar keyboard** — Tab por toda a tela. Todos os elementos interativos são
   alcançáveis? A ordem de tab é lógica? Há `tabindex` quebrado? (positivo que
   não é 0, negativo que esconde)
2. **Testar focus** — O focus ring é visível? Foi removido com `outline: none`? Ao
   abrir modal, focus vai para dentro? Ao fechar, volta ao trigger? O focus não fica
   preso em um elemento (focus trap quebrado)?
3. **Testar screen reader** — Há `alt` text em imagens? Há `aria-label` em ícones
   semânticos? `aria-live` para conteúdo dinâmico? O conteúdo é legível sem contexto
   visual? (testar com um leitor real ou simulando: fechar os olhos e ouvir)
4. **Testar semantic HTML** — `<button>` vs `<div onclick>`? `<nav>` vs `<div>`?
   `<h1-h6>` para hierarquia? `<form>` com `<label>`?
5. **Testar contrast** — texto body ≥ 4.5:1 (WCAG AA). Texto large ≥ 3:1. UI
   components (bordas, ícones) ≥ 3:1. Modo escuro?
6. **Testar touch targets** — botões, links, inputs ≥ 44x44px. Elementos próximos têm
   espaço entre eles? (touch não preciona o adjacente)
7. **Testar reduced motion** — animações desligam com `prefers-reduced-motion: reduce`?
   (ver `animation-review` para detalhe)
8. **Testar forms** — cada input tem `<label>` (não só placeholder)? Erros são
   comunicados por texto (não só cor)? Hints/tooltips são acessíveis (não só hover)?
   Focus sequence entre campos é lógica?
9. **Sintetizar** — referenciar `references/frontend.yaml` (Impeccable, WCAG docs)
   quando apropriado.

## Questions to Ask

* Toda ação é alcançável com Tab/Enter/Esc? (sem mouse trap)
* O focus ring é visível? Foi removido com `outline: none`? (se sim, todo o resto
  falha para teclado)
* Ao abrir modal, focus vai para dentro? Ao fechar, volta? (focus trap correto?)
* Imagens têm `alt` text descritivo? (não só "image", vazio, ou o filename)
* Ícones semânticos têm `aria-label`? (não só decorative)
* Conteúdo dinâmico (loading, erro, toast) tem `aria-live` / `role="alert"`?
* A estrutura de headings é hierárquica? (h1 → h2 → h3, não pula)
* `<button>` é usado para ações, não `<div onclick>`?
* Contraste de texto ≥ 4.5:1? (WCAG AA)
* Touch targets ≥ 44x44px? (especialmente mobile)
* Cada input tem `<label>` visível? (não só placeholder)
* Erros são comunicados por texto + aria-live, não só por cor?

## Attack Patterns

```text
keyboard trap
    modal aberto, Tab não sai do modal (correto). Mas não volta ao fechar (erro).
    dropdown com itens não acessíveis por teclado (só mouse)

focus removed
    `*:focus { outline: none !important }` — o maior crime de acessibilidade
    → usuário de teclado não vê onde está

no alt text
    <img src="chart.png"> sem alt → screen reader lê "chart.png"
    ícone de like sem aria-label → "button" sem contexto

heading hierarchy broken
    h1 → h3 (pula h2) → conteúdo perde estrutura
    tudo é h1 (sem hierarquia)

div as button
    <div onclick="submit()"> vs <button type="submit">
    → não acessível por teclado, não tem role, não tem estado

contrast insufficient
    gray-400 (#9CA3AF) em white (#FFFFFF) → 2.9:1, falha WCAG AA

touch target too small
    link de 20×20px no mobile → impossível acertar com o dedo

label absent
    placeholder="Username" como único label → perde contexto quando preenchido
    → <label> necessário

error by color only
    input com borda vermelha sem texto de erro → daltônico não vê
    → precisa de texto + aria-live

reduced motion ignored
    parallax e flutuação constantes sem `prefers-reduced-motion`
    → desconforto vestibular

skip navigation absent
    <main> sem "Skip to content" → usuário de teclado tab pelos 20 links do nav
    toda vez que carrega
```

## Evidence Requirements

* **Nomear o eixo** (keyboard/focus/screen reader/semantic/contrast/touch/reduced
  motion/forms/errors).
* **Mostrar o elemento exato** e a violação (ex: `*:focus { outline: none !important }`,
  `alt=""` em imagem informativa, `<div onclick>` para ação, contraste 2.9:1).
* **Referenciar o critério WCAG** quando aplicável (ex: "WCAG 1.4.3 Contrast Minimum",
  "2.1.1 Keyboard", "2.4.7 Focus Visible").
* **Escalar confiança (Accessibility):**
  * `CONFIRMED` — violação mensurável (contraste < 4.5:1, focus removido, keyboard
    trap, no alt text, label ausente, touch target < 44px).
  * `HIGH CONFIDENCE` — padrão claramente violado.
  * `POSSIBLE` — violação marginal (ex: contraste 4.3:1, touch target 40px).
  * `SPECULATIVE` — necessidade não confirmada (ex: "talvez precise de aria-live aqui").

## False Positives

* **Decorative image** — `alt=""` é *correto* para imagens decorativas. Não reportar
  como "alt ausente". (Reportar quando é informativa sem alt.)
* **Focus visible por outro sinal** — se o `outline: none` tem substituto (border,
  background, box-shadow) em todos os estados, é aceitável. Confirmar antes de
  reportar.
* **Touch target tem espaço extra** — se o target visual é 30px mas o padding faz
  o hit area ≥ 44px, é ok. Avaliar pelo hit area real, não só pelo visual.
* **Label oculto mas acessível** — `aria-label`/`<label class="sr-only">` é válido
  se o screen reader lê. Não exigir label visível se o SR tem contexto suficiente.
* **Skip navigation em app SPA** — em apps de página única, skip to content pode ser
  substituído por rota/foco gerenciado. Avaliar o contexto.
* **Reduced motion com fallback** — se o app respeita reduced motion, as animações
  que ainda rodam precisam ser avaliadas individualmente, não como "não respeita".

## Output Format

Para cada violação, um finding via `templates/audit-report.md`. Em **Affected
component**, nomeie o elemento. Em **Reproduction**, descreva o comportamento (ex:
"Tab 3×: focus vai do header para o footer, pulando todo o conteúdo principal"). Em
**Root cause**, aponte o eixo e o critério WCAG. Em **Recommendation**, dê a correção
(adicionar focus ring, `alt` text, `<label>`, contraste, touch target, ARIA, skip
navigation, reduzir motion).

Apresente por eixo, ordem de severidade: keyboard traps e focus removido (= bloqueante
para usuário de teclado) primeiro; contrast e labels depois; semantic HTML e touch
targets em seguida; forms e reduced motion por último.
