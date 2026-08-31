---
name: interaction-design
description: Evaluates hover, focus, pressed, disabled, loading, transitions, feedback, and micro-interactions to verify every state of every interactive element is intentionally designed.
license: MIT
metadata:
    aes-category: frontend
    aes-priority: medium
---

# Interaction Design

## Objective

Ensinar o agente a avaliar **cada estado de cada elemento interativo**: hover, focus,
pressed, disabled, loading, transitions, feedback, e micro-interações. A pergunta
central: *todo estado que o usuário pode ver está intencionalmente desenhado, ou há
estados acidentais (sem feedback, sem affordance, sem contraste)?*

## When to Use

* Em qualquer tela com elementos interativos (botões, links, inputs, dropdowns, cards
  clicáveis, toggles).
* Quando o pedido menciona "interaction", "micro-interactions", "hover state",
  "focus state", "disabled state", "loading state".
* Em revisões de frontend onde UX e visual são complementares à interação.
* **Composição:** roda com `ux-review` (a interação serve à UX), `visual-quality-review`
  (estados são visuais), `animation-review` (transições/motion são interação), e
  `accessibility-review` (focus/keyboard são acessibilidade E interação).

## Mental Model

Todo elemento interativo é uma **máquina de estados**: default, hover, focus, pressed,
disabled, loading, selected, error. O bug de interação é um **estado não-desenhado** —
o usuário paira, foca, pressiona, desabilita, e nada comunica a mudança. O sistema
"funciona" mas não *reage*.

O modelo de estados canônicos (do `plan.md` §10):

```text
hover      — indica que o elemento é interativo (mudança de fundo/borda/elevação)
focus      — indica posição de teclado/assistivo (ring, outline, não removido!)
pressed    — confirma o pressionamento (escala, escurece, "estou sendo clicado")
disabled   — comunica indisponibilidade com causa (não só "cinza morto")
loading    — comunica trabalho em progresso (não congelar sem feedback)
transitions — mudanças de estado são suaves e legíveis, não teleportadas
feedback   — resultado da interação é comunicado (não só no DOM)
micro-interactions — detalhe que encanta e informa (efeito sutil e significativo)
```

## Investigation Procedure

1. **Listar elementos interativos** — botões, links, inputs, selects, toggles, cards,
   tabs, dropdowns, modais, checkboxes.
2. **Para cada elemento, percorrer os estados:**
   * **default** — comunica a função? (affordance)
   * **hover** — muda algo? O que? É distinto o suficiente?
   * **focus** — há focus ring/outline? Foi removido (culpado — acessibilidade)?
   * **pressed** — dá feedback de pressionamento? Ou fica estático?
   * **disabled** — comunica por quê? Ou é indistinguível de erro?
   * **loading** — durante a ação, o elemento mostra progresso? (spinner/skeleton/
     mudança de label) ou congela?
   * **selected/active** — o estado selecionado é visível e distinto?
   * **error** — a interação que falha comunica o erro?
3. **Avaliar transitions** — mudanças de estado são suaves? (ou teleportam?) São
   rápidas demais para perceber ou lentas demais para tolerar?
4. **Avaliar micro-interactions** — há detalhe que informa (ex: input com check de
   validação, botão com confirmação)? Algum é *excessivo* (ruído)?
5. **Verificar focus sequence** — interagir só com teclado funciona? (parcialmente
   aqui, completo em `accessibility-review`).
6. **Sintetizar** com o formato de saída.

## Questions to Ask

* Cada elemento interativo comunica sua função no default? (affordance)
* O hover muda o estado de forma perceptível? (fundo/borda/elevação)
* O focus tem ring/outline visível? Foi removido com `outline: none`?
* O pressed dá feedback de pressionamento? (escala/escurece)
* O disabled comunica a causa ("unavailable — upgrade to pro") ou é um cinza mudo?
* Durante uma ação, o elemento mostra loading? Ou congela até o fim?
* O estado selecionado (active/tab/selected) é visível e distinto?
* Transições são suaves? (ou teleportam entre estados?)
* Micro-interações informam ou só enfeitam? (alguma é excessiva/ruído?)
* A interação com teclado completa o fluxo? (focus sequence funciona?)

## Attack Patterns

```text
hover without affordance change
    botão muda cor no hover, mas links/ícones não — o que é clicável é inconsistente

focus removed
    `:focus { outline: none }` sem substituto
    → teclado/assistivo não sabe onde está. Acessibilidade E interação quebrada.

pressed feedback absent
    botão não reage ao clique (sem escala, sem mudança)
    → usuário não sabe se o clique foi registrado

disabled without cause
    botão cinza sem tooltip/legenda de "por quê"
    → usuário pensa que está bugado (ver também `error-flow-audit`)

loading frozen
    ação disparada, botão congela 3s sem feedback
    → usuário clica de novo (duplo submit), ou acha que quebrou

selected state invisible
    tab selecionada e não-selecionada têm o mesmo peso visual
    → usuário não sabe em que página está

transition too fast/slow
    0ms (teleport) → desorientado
    800ms em card grid → frustrante, lento

micro-interaction excessive
    animação em cada hover de ícone de 24px → ruído visual, distração
    (ver `animation-review`)

feedback after action absent
    toggle flip sem "salvo" (o toggle é otimistic e o servidor falhou — ver
    `state-consistency-audit` — ou a mudança não é comunicada)
```

## Evidence Requirements

* **Nomear o elemento e o estado** (ex: "botão Save: estado disabled sem explicação").
* **Mostrar o estado observado** vs o estado esperado (sem focus ring, sem feedback de
  pressed, congelado em loading).
* **Escalar confiança (Interaction Design):**
  * `CONFIRMED` — estado não-desenhado observado (ex: `outline: none` sem substituto,
    botão congela sem loading).
  * `HIGH CONFIDENCE` — código/estilo confirma a ausência de estado.
  * `POSSIBLE` — interação marginalmente inconsistente.
  * `SPECULATIVE` — preferência pessoal sobre micro-interação.

## False Positives

* **Plataforma usa padrão diferente** — hover em touch não existe; em desktop touch
  não aplica. Avaliar por plataforma/dispositivo.
* **Micro-interação é parte da marca** — animações de marca podem ser mais presentes;
  avaliar se servem a identidade ou são ruído.
* **Focus via outro sinal** — focus ring removido mas substituído por outra indicação
  visível (border, background) em todos os estados. Confirmar antes de reportar.
* **Disabled com tooltip intencional** — se o disabled tem tooltip/legend explicando
  causa, não é "cinza mudo". Confirmar.
* **Loading indireto** — skeleton no lugar do conteúdo é loading válido. Não exigir
  spinner no botão se o skeleton comunica.

## Output Format

Para cada estado não-desenhado, um finding via `templates/audit-report.md`. Em
**Affected component**, nomeie o elemento e o estado. Em **Reproduction**, descreva o
que o usuário vê vs o que deveria ver (paira/foca/pressiona e nada muda). Em **Root
cause**, aponte o estado ausente. Em **Recommendation**, dê a correção (adicionar focus
ring, feedback de pressed, disabled com causa, loading state, selected state).

Apresente por elemento × estado. Focus e feedback (impacto direto em uso) primeiro;
hover/pressed/disabled depois; transitions e micro-interactions por último.
