---
name: user-flow-audit
description: Maps a user flow as entry → preconditions → action → state change → feedback → next state and detects dead ends, impossible states, skippable steps, refresh and back-button problems, and duplicate operations.
user_invocable: true
---


# User Flow Audit

## Objective

Ensinar o agente a modelar um fluxo de usuário como uma **máquina de estados** e a
procurar estados dos quais o usuário não consegue sair, estados impossíveis, passos que
podem ser pulados, e desyncs causados por refresh/back-button.

A skill trata o fluxo como uma sequência canônica:

```text
entry → preconditions → action → state change → feedback → next state
```

## When to Use

* Ao auditar qualquer fluxo multi-passo (onboarding, checkout, criação de personagem,
  publicação, convites, setup).
* Quando o pedido menciona "flow", "steps", "wizard", "onboarding", "checkout".
* Quando há risco de o usuário ficar preso em um estado intermediário.
* **Composição:** frequentemente junto com `state-consistency-audit` (fluxo vs estado
  do servidor), `error-flow-audit` (o que acontece quando um passo do fluxo falha),
  `business-logic-audit` (pré-condições do fluxo = regras de negócio), e
  `edge-case-hunter` (entrances anômalas no fluxo).

## Mental Model

Um fluxo não é uma lista de telas. É uma **máquina de estados**: cada nó é um estado
persistido (no servidor, no cliente, ou na URL), e cada transição é uma ação que move
de um estado a outro. Bugs vivem nas transições e nos estados, não nas telas.

As duas falhas mais comuns:

1. **Estados sem saída** — o usuário chega a um estado do qual nenhuma ação legítima o
   tira. Dead end.
2. **Transições implícitas** — o fluxo assume que o estado anterior foi atingido, mas
   nada o impede de pular direto a um estado posterior. Passo pulável.

O modelo força a pergunta: *de cada estado, para onde o usuário pode ir — e o que o
impede de ir para onde não deveria?*

## Investigation Procedure

> **Shared knowledge:** for modeling flows as state machines and finding dead ends,
> read `knowledge/engineering/state-machines.md` when the flow has states, guards
> or refresh/back concerns.



1. **Desenhar o fluxo nominal** como `entry → preconditions → action → state change →
   feedback → next state`. Um nó por estado.
2. **Rotular onde cada estado vive** — servidor, cliente, URL, ou cache. (Isto
   conecta com `state-consistency-audit`.)
3. **Para cada transição, listar a pré-condição** que deve ser verdadeira para ela
   ocorrer.
4. **Testar pulabilidade:** a pré-condição é *verificada no servidor* ou *assumida*? Se
   assumida, o passo é pulável via chamada direta ao endpoint do passo seguinte.
5. **Testar estados sem saída:** para cada estado, existe uma ação legítima que leva a
   um próximo estado útil? Se não, é dead end.
6. **Testar refresh:** em cada estado, o que acontece se o usuário recarregar? O estado
   é reconstruído a partir do servidor, ou perdido/resetado?
7. **Testar back-button:** o que acontece ao voltar? O usuário reexecuta uma ação
   não-idempotente? Volta a um estado que não deveria mais ser acessível?
8. **Testar duplicação:** o usuário pode executar a mesma ação duas vezes (duplo submit,
   double click) e causar dois efeitos?
9. **Listar estados impossíveis** — combinações que a máquina deveria proibir mas que
   podem ser alcançadas por pulo, refresh, ou back.
10. **Reportar** findings via `templates/audit-report.md`.

## Questions to Ask

* Quais são todos os estados do fluxo? Onde cada um é persistido?
* Para cada transição, qual a pré-condição? Ela é checada no servidor?
* Existe um estado do qual nenhuma ação leva a lugar útil? (dead end)
* Posso pular direto para um estado avançado sem passar pelos anteriores?
* O que o refresh faz em cada estado? O estado é recuperado do servidor ou perdido?
* O back-button reexecuta uma ação? Volta a um estado obsoleto?
* Um duplo-submit cria dois recursos / duas recompensas?
* Existem combinações de estado que deveriam ser impossíveis mas são alcançáveis?
* O feedback dado ao usuário reflete o estado real do servidor?

## Attack Patterns

```text
skip preconditions
    POST /step-final     (pulando /step-1 e /step-2)
    → efeito concedido sem pré-condições?

dead end
    state: "payment_failed"
    → existe botão "retry"? "cancel"? ou o usuário fica preso?

refresh mid-flow
    state: "form partially submitted"
    refresh → estado reconstruído? ou volta ao início perdendo dados?

back-button after submit
    submit → state: "created"
    back → volta ao form → submit novamente
    → criação duplicada?

duplicate operation
    double click em "Submit"
    → dois requests, dois efeitos?

impossible state reachable
    resource marcado "deleted" mas ainda listado e editável
    → combinação proibida alcançada por caminho indireto

stale feedback
    UI mostra "success" mas servidor reverteu por erro interno
    → feedback ≠ estado real
```

## Evidence Requirements

* **Nomear o estado e a transição** problemáticos (ex: "do estado `submitted` via
  back-button de volta a `form`").
* **Mostrar onde o estado vive** (server/client/URL/cache) e onde a pré-condição é (ou
  não é) verificada.
* **Reproduzir ou apontar o mecanismo** — sequência de passos/requests, ou o código que
  assume a pré-condição sem checá-la.
* **Escalar confiança:**
  * `CONFIRMED` — reproduziu o dead end / o pulo / o desync.
  * `HIGH CONFIDENCE` — mecanismo claro no código (ex: handler não checa etapa
    anterior), sem reprodução manual.
  * `POSSIBLE` — fluxo parece permitir, caminho plausível, não confirmado.
  * `SPECULATIVE` — "acho que refresh pode quebrar" sem rastrear o mecanismo.

## False Positives

* **Pré-condição verificada no servidor** — se o handler do passo final valida que os
  anteriores ocorreram, o "pulo" não produz efeito. Confirmar antes de reportar.
* **Estado é puramente de UI** — alguns estados "intermediários" são só feedback visual
  sem estado persistido; "perdê-los" no refresh é aceitável se o servidor é a verdade.
* **Back-button em fluxo idempotente** — se reexecutar é seguro (idempotência real),
  não é bug (relacionado a `idempotency-audit`).
* **Dead end é intencional** — alguns estados terminais são deliberados (ex: "conta
  banida"). Reportar como tal, não como defeito, ou marcar como `POSSIBLE` para decisão
  de produto.
* **Duplicação protegida por disable de botão + server idempotency** — defesa em
  profundidade; se ambas existem, não reportar.

## Output Format

Para cada estado/transição problemática, um finding via
`templates/audit-report.md`. Em **Reproduction**, dê a sequência exata de estados
visitados (incluindo refresh/back) que leva ao defeito. Em **Affected flow**, nomeie o
fluxo. Em **Recommendation**, indique *onde* corrigir (validação server-side no handler
do passo final; bloqueio de estado obsoleto; reconstrução de estado no refresh).

Anexe um diagrama da máquina de estados com os estados/transições problemáticos
marcados. Estados sem saída e transições puláveis são os mais graves — liste-os
primeiro.
