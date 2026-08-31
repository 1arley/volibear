---
name: error-flow-audit
description: Investigates partial success, timeouts, lost responses, retries, crashes, and rollback failures to find states left inconsistent or operations left half-done when something fails mid-flight.
license: MIT
metadata:
    aes-category: audit
    aes-priority: high
---

# Error Flow Audit

## Objective

Ensinar o agente a parar de perguntar "isto funciona?" e perguntar **"o que acontece
quando isto falha no meio?"**. Toda operação multi-passo pode falhar entre os passos;
esta skill mapeia os pontos de falha e verifica se o sistema deixa o estado consistente
ou abandona o sistema em um estado parcial.

```text
partial success   timeouts   lost responses   retries   crashes   rollback failures
```

## When to Use

* Quando uma operação toca múltiplos recursos/serviços (DB + API externa + fila +
  cache) e pode falhar entre eles.
* Quando há retries, timeouts, circuit breakers, ou webhooks.
* Quando uma falha pode deixar estado parcial (recurso criado mas notificação não
  enviada; cobrança efetivada mas pedido não; metadados escritos mas arquivo não).
* Quando o pedido menciona "error handling", "rollback", "retry", "timeout", "what if
  it fails", "partial", "idempotent on retry".
* **Composição:** pareia com `idempotency-audit` (retry de operação inteira),
  `data-integrity-audit` (transação/rollback no banco), `state-consistency-audit`
  (estado parcial = desync entre camadas), `user-flow-audit` (fluxo que falha num
  passo intermediário), `race-condition-hunter` (falha concorrente com outra mutação).

## Mental Model

O happy path é fácil. O perigo é o **caminho parcial**: a operação completa passo 1,
falha no passo 2, e agora o sistema tem o efeito do passo 1 sem o do passo 2 — um estado
que o happy path nunca produziria e que ninguém projetou para existir.

As duas armadilhas simétricas:

1. **Sem rollback** — passo 1 efetivado, passo 2 falha, passo 1 não é desfeito. Estado
   parcial persiste.
2. **Rollback sem idempotência** — retry reexecuta passo 1 (já feito) e cria efeito
   duplicado. Ou rollback desfaz e reexecuta do zero, mas o "efeito externo" (email,
   cobrança) já ocorreu e não é reversível.

O modelo: para cada operação multi-passo, pergunte *qual passo é idempotente*, *qual
é reversível*, *qual tem efeito externo irreversível*, e *o que acontece se falhar
após cada um*. Pontos de não-retorno (efeito externo já disparado) são os mais críticos.

Classes de falha a investigar (do `plan.md` §6):

```text
partial success   — alguns passos efetivam, outros não
timeouts          — chamada pendente; estado desconhecido (fez ou não fez?)
lost responses    — servidor agiu mas o cliente não sabe; retry?
retries           — reexecução; idempotente? ou duplica efeito?
crashes           — processo morre mid-op; estado em disco consistente?
rollback failures — tentou desfazer e o rollback também falhou; agora o quê?
```

## Investigation Procedure

> **Shared knowledge:** for failure models, compensation and the outbox pattern,
> read `knowledge/engineering/failure-models.md` and `knowledge/engineering/transactions.md`
> when the flow spans external services or a rollback path.



1. **Decompor a operação em passos.** Liste cada efeito (write DB, call API externa,
   enqueue, send email, update cache, emit event).
2. **Rotular cada passo:** idempotente? reversível? efeito externo (irreversível)?
3. **Para cada ponto de falha (após passo k), perguntar:**
   * O estado parcial é consistente ou corrompido?
   * Há rollback? O rollback cobre todos os passos k?
   * O rollback é idempotente (safe to retry)?
   * Há efeito externo irreversível já disparado antes do ponto de falha?
4. **Testar timeout/lost-response:** se a chamada pendente, o sistema trata como
   "feito", "não feito", ou "desconhecido"? O retry é seguro?
5. **Testar retry:** reexecutar a operação inteira após falha — duplica algum efeito?
6. **Testar crash mid-op:** se o processo morre entre passos, o estado em disco é
   consistente ao reiniciar? Há recuperação/reconciliação?
7. **Testar rollback failure:** se o rollback também falha, o sistema fica em quê?
   Há alerta/reconciliação, ou silencioso?
8. **Confirmar com evidência** — injete falha no passo k e observe o estado final.
9. **Reportar** via `templates/audit-report.md`.

## Questions to Ask

* Quais são os passos/efeitos desta operação? Qual ordem?
* Qual passo é o ponto de não-retorno (efeito externo irreversível)?
* Se falhar *após* o ponto de não-retorno, o que acontece?
* Há transação? Ela cobre todos os writes ou só alguns?
* Para chamada externa: timeout → estado desconhecido. Como o sistema resolve?
* Retry da operação inteira é idempotente? Ou duplica um efeito?
* Se o processo crashar entre passos, há reconciliação ao reiniciar?
* O rollback, se existe, é idempotente? E se o rollback falhar?
* Erros são tratados ou engolidos (empty catch)? Estado parcial é detectável?

## Attack Patterns

```text
partial success — no transaction
    step 1: write db order "created"     ✓ committed
    step 2: charge payment               ✗ fails
    → order exists, never paid, no rollback. Estado parcial.

partial success — external effect before commit
    step 1: call payment gateway          ✓ charged (irreversível)
    step 2: write db order "paid"         ✗ db error
    → cobrado, pedido não registrado. Ponto de não-retorno passado.

timeout → unknown state
    call external API: 30s, no response
    → agiu ou não? retry agora duplica se agiu (não-idempotente).

lost response → blind retry
    server processes request, response lost in network
    client retries → reexecuta → efeito duplicado se não-idempotente.

retry that doubles
    create + send welcome email
    fails after create, before email
    retry → create again (duplica) se create não-idempotente.

crash mid-op, no recovery
    step 1: decrement stock
    crash
    restart → stock decremented, order never created. Sem reconciliação.

rollback failure, silent
    try: step1, step2
    catch: undo step1   ← undo also fails
    → step1 efetivado, sem log/alerta. Corrupção silenciosa.

empty catch / swallowed error
    try { externalCall() } catch {}
    → falha virou sucesso aparente; estado parcial não detectado.
```

## Evidence Requirements

* **Nomear o ponto de falha** (após qual passo) e o **estado parcial resultante**.
* **Rotular cada passo** (idempotente / reversível / efeito externo) no finding.
* **Mostrar o mecanismo** — onde falta transação, onde retry não é idempotente, onde
  rollback não cobre, onde catch engole. Ou reprodução com falha injetada.
* **Escalar confiança:**
  * `CONFIRMED` — injetou falha e observou estado parcial/corrompido.
  * `HIGH CONFIDENCE` — código mostra ausência de transação/rollback/idempotência em
    caminho claro.
  * `POSSIBLE` — plausível, caminho não confirmado.
  * `SPECULATIVE` — "pode falhar" sem rastrear.
* Estados parciais **com efeito externo irreversível** (dinheiro cobrado, email
  enviado) e **silenciosos** (empty catch) são os mais graves.

## False Positives

* **Transação cobre todos os writes** — se tudo está em uma DB transaction e nada de
  externo ocorre antes do commit, "falha mid-op" é seguro (rollback automático).
  Confirmar antes de reportar.
* **Operação é idempotente por design** — retry seguro significa "duplica" não é bug.
  Relacionado a `idempotency-audit`; não duplique o finding.
* **Saga/outbox com reconciliação** — se há outbox + worker que reconcilia estado
  parcial, a inconsistência é temporária e tratada. Reportar só se a reconciliação é
  ausente/quebrada.
* **Timeout tratado como "unknown" com query+decide** — se após timeout o sistema
  consulta o estado real antes de retry, é correto. Não reportar.
* **Empty catch é intencional e compensado** — raro, mas se há compensação downstream,
  confirmar antes de reportar como defeito.

## Output Format

Para cada ponto de falha que deixa estado parcial/corrompido, um finding via
`templates/audit-report.md`. Em **Reproduction**, descreva a falha injetada (qual
passo falha, como) e o estado final observado. Em **Affected flow**, nomeie a operação.
Em **Root cause**, diga o que falta (transação, rollback, idempotência no retry,
reconciliação, detecção de erro). Em **Recommendation**, indique a estratégia (transação
atómica, outbox/saga, idempotency key, query-on-timeout, alerta em rollback failure).

Apresente a decomposição como tabela (passo | efeito | idempotente? | reversível? |
efeito externo? | estado se falhar após). Pontos de não-retorno e estados silenciosos
primeiro.
