---
name: adversarial-review
description: Teaches the agent to attack the system as curious, malicious, power, careless, competitor, and stale-state users using repeat, reverse, reorder, skip, replay, concurrent, and manipulate operations.
user_invocable: true
---


# Adversarial Review

## Objective

Ensinar o agente a **atacar as suposições por trás do sistema** em vez de apenas ler o
código. A skill não procura o que está escrito; ela procura o que o código *assume* que
é verdade — e testa se essa suposição sobrevive a um usuário que não coopera.

> Don't just review the code. Attack the assumptions behind the system.

## When to Use

* Antes de lançar ou refatorar um fluxo não-trivial.
* Quando uma tarefa envolve estado, permissões, recompensas, dinheiro, ou contadores.
* Como a skill "guarda-chuva" que abre uma auditoria: ela gera hipóteses que as skills
  especializadas (`business-logic-audit`, `race-condition-hunter`, etc.) confirmam.
* Quando o pedido inclui "audit", "attack", "stress test", "what could go wrong".
* **Composição:** raramente atua sozinha. Abre o leque: gera hipóteses que despacham
  para `business-logic-audit`, `edge-case-hunter`, `race-condition-hunter`,
  `state-consistency-audit`, `error-flow-audit`, `authorization-audit`,
  `idempotency-audit`, `api-abuse-audit`.

## Mental Model

Existem dois erros simétricos ao revisar código:

1. **Ler como o autor esperava** — segue o happy path, vê o que *deveria* acontecer,
   aprova. Falso negativo.
2. **Procurar bugs sem método** — acha coisas estranhas aleatórias, reporta ruído.
   Falso positivo.

O modelo adversarial é uma terceira via: **adotar uma persona e aplicar um conjunto
finito de operações canônicas**. Cada (persona × operação) é uma hipótese testável.
Isto é sistemático, não aleatório, e gera hipóteses que se convertem em findings apenas
com evidência.

As personas são **modelos de uso**, não perfis de marketing. Cada uma representa uma
classe de pressão sobre uma suposição diferente:

| Persona | Qual suposição ela ataca |
|---|---|
| usuário curioso | "campos hidden / IDs / params são só display" |
| usuário malicioso | "o sistema confia que ninguém vai tentar X" |
| power user | "ninguém usa atalhos, reorder, ou bypass" |
| usuário descuidado | "todo mundo completa o fluxo na ordem certa" |
| usuário concorrente | "dois usuários não agirão sobre o mesmo recurso ao mesmo tempo" |
| usuário com estado antigo | "o estado do cliente/sessão está sempre sincronizado" |

As operações são verbos canônicos que transformam uma execução "normal" em um caso de
pressão:

```text
repeat     — fazer a mesma ação N vezes
reverse    — desfazer e refazer
reorder    — executar passos fora da ordem esperada
skip       — pular um passo que deveria ser obrigatório
replay     — repetir um request idempotente-deveria-ser
concurrent — duas execuções sobre o mesmo estado ao mesmo tempo
manipulate — alterar IDs, campos, roles, timestamps direto no payload
```

## Investigation Procedure

1. **Mapear o fluxo nominal.** Liste os passos como o sistema *espera* que ocorram.
2. **Listar as suposições.** Para cada passo, escreva o que ele assume sobre o input,
   o estado, e o usuário.
3. **Gerar hipóteses (persona × operação).** Para cada persona, aplique cada operação
   aos passos. Não tente confirmar ainda — só gere a hipótese "se eu fizer X, e a
   suposição Y for falsa, então Z".
4. **Triar por plausibilidade.** Descarte as obviamente impossíveis (sem caminho no
   código). Priorize as que atacam uma suposição de servidor ou estado compartilhado.
5. **Confirmar com evidência.** Para cada hipótese sobrevivente, reproduza ou encontre
   o mecanismo no código. Suba o nível de confiança só com evidência.
6. **Classificar falso positivo.** Para cada finding, verifique se o comportamento é
   intencional/aceitável antes de reportar.
7. **Reportar** no formato de saída, apontando para `templates/audit-report.md`.

## Questions to Ask

* Quem é o público deste fluxo? Qual deles NÃO coopera com a UI?
* Quais campos o servidor aceita que a UI nem mostra? (`manipulate`)
* Se eu repetir essa ação 100 vezes, o que cresce que não deveria? (`repeat`)
* Se eu desfizer e refazer, ganho algo de volta que não devia? (`reverse`)
* Posso pular o passo de pré-condição e ir direto ao efeito? (`skip`)
* Posso chamar os passos fora de ordem? (`reorder`)
* Se dois requests simultâneos passam pela mesma checagem, ambos efetivam? (`concurrent`)
* O que acontece se eu refizer um request cuja resposta se perdeu? (`replay`)
* Qual estado o cliente guarda que pode ficar desatualizado vs o servidor? (`stale state`)

## Attack Patterns

```text
repeat
    request → 200 OK
    request → 200 OK      (deveria ser 409/idempotente?)
    ...
    contador/reward inflado

reverse
    action → reward granted
    undo action           (reward é removida?)
    redo action → reward granted again
    → farming infinito se reward não foi removida OU se foi re-concedida

reorder
    step C (efeito) antes do step A (pré-condição)
    → o efeito ocorre sem a pré-condição?

skip
    POST /grant-directly   (pulando o fluxo que valida)
    → a validação server-side cobre o caminho direto?

replay
    request → 200 (resposta perdida na rede)
    retry request
    → efeito duplicado?

concurrent
    request A: read balance (ok)
    request B: read balance (ok)    ← mesmo estado lido
    request A: write (deduct)
    request B: write (deduct)       ← double-spend

manipulate
    GET /resource/123  → 200      (é meu? sou só autenticado, não autorizado)
    PUT /resource/123 {role:"admin"}  (campo extra aceito?)
    POST /reward {xp: 99999}      (valor confiável no payload?)
```

## Evidence Requirements

Um finding de `adversarial-review` deve, no mínimo:

* **Nomear a suposição atacada** — qual invariant/assumption foi violada.
* **Nomear a persona e a operação** — qual combinação gerou a hipótese.
* **Mostrar o mecanismo** — onde no código a suposição é feita e onde falha. Ou
  reprodução concreta (sequência de requests, passos).
* **Escalar confiança:**
  * `CONFIRMED` — reproduzido (request sequência + resposta, ou teste).
  * `HIGH CONFIDENCE` — mecanismo identificado no código, sem reprodução executada.
  * `POSSIBLE` — hipótese plausível, caminho existe, mecanismo não confirmado.
  * `SPECULATIVE` — "parece que poderia" sem caminho no código; reportar como risco.

Sem mecanismo e sem reprodução, no máximo `POSSIBLE`.

## False Positives

* **Rate limiting já protege** — repetição é bloqueada antes de efeito. Verificar se o
  limite está em vigor antes de reportar `repeat` como defeito.
* **Idempotência real** — se o servidor usa idempotency key / unique constraint, `replay`
  e `repeat` não duplicam. Confirmar a ausência da proteção antes de reportar.
* **Autorização server-side presente** — se o servidor valida ownership no handler,
  `manipulate` de ID não funciona. Não reportar bypass sem confirmar que a checagem
  falta.
* **Comportamento intencional** — algumas ações são *desenhadas* para serem repetíveis
  ou reversíveis. Se o produto exige isso, não é bug. Quando em dúvida, marque como
  `POSSIBLE` e levante na seção "Out of scope / precisa decisão de produto".
* **Ambiente de teste** — repetir em staging pode não refletir produção (locks, limits).
  Reportar confiança reduzida se não puder testar em condições reais.

## Output Format

Para cada hipótese sobrevivente, produza um finding seguindo
`templates/audit-report.md`. Campos obrigatórios: Severity, Confidence, Affected
component, Affected flow, Reproduction, Expected behavior, Actual behavior, Root cause,
Impact, Recommendation.

Inclua adicionalmente em **Evidence**:
* a persona + operação que gerou a hipótese;
* a suposição exata que foi atacada;
* o mecanismo ou reprodução.

Findings `SPECULATIVE` vão em uma seção separada "Riscos a verificar", não na lista
principal de bugs.

Ao final, liste quais hipóteses foram **descartadas** e por quê — isto mostra a
cobertura e previne retrabalho.
