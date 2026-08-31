---
name: idempotency-audit
description: Tests request → request → request and request → response-lost → retry, especially for payments, rewards, creation, webhooks, notifications, and counters, to find operations that duplicate effects on repeat or retry.
user_invocable: true
---


# Idempotency Audit

## Objective

Ensinar o agente a testar se operações **idempotentes-deveria-ser** continuam
produzindo efeito único quando repetidas ou reexecutadas após falha/retry:

```text
request
request
request        ← mesmo efeito 1×? ou efeito duplicado N×?

request
response lost
retry           ← o retry duplica o efeito que já aconteceu?
```

Especialmente em (do `plan.md` §8): **pagamentos, rewards, criação, webhooks,
notificações, contadores.**

## When to Use

* Em qualquer operação que *cria* algo, *concede* algo, *debita/cobra* algo, ou
  *incrementa* — se repetida, duplicaria.
* Em endpoints que recebem webhooks/retries de terceiros (gateway de pagamento,
  provedores).
* Quando o usuário pode duplo-submitar (duplo clique, retry manual).
* Quando o pedido menciona "idempotency", "duplicate", "double charge", "double
  submit", "webhook replay", "retry".
* **Composição:** pareia com `error-flow-audit` (retry após falha mid-op),
  `race-condition-hunter` (retry concorrente), `gamification-audit` (reward duplicada),
  `api-abuse-audit` (repetição via API), `business-logic-audit` (regra de efeito único).

## Mental Model

Idempotência não é "aceitar o request duas vezes". É **produzir o mesmo efeito** na
segunda vez. Um POST que cria um pedido é idempotente só se reenviá-lo (mesma
idempotency key, mesmo payload) retorna o pedido original sem criar outro.

O que torna um request *candidato* a idempotente: existe uma **chave de idempotência**
(um identificador estável da intenção — ex: `Idempotency-Key` header, `orderId`,
`eventId` de webhook) e o servidor **verifica a chave** antes de executar. Sem chave
verificada, a repetição duplica.

Eixo de investigação:

```text
qual é a chave de idempotência?      (se não existe, suspeito)
o servidor verifica antes de agir?   (lookup por chave antes do efeito)
o efeito é duplicado no retry?       (quando a chave não é verificada, ou a resposta se perdeu)
```

Áreas críticas (efeito duplicado = consequência real):

```text
payments      — cobrança duplicada
rewards       — XP/pontos concedidos 2×
creation      — recurso criado 2×
webhooks      — evento processado 2× (sem eventId dedup)
notifications — email/SMS duplicado
counters      — incremento dobrado
```

## Investigation Procedure

> **Shared knowledge:** for retry/failure semantics and compensation,
> read `knowledge/engineering/failure-models.md` and `knowledge/engineering/concurrency.md`
> when retries interact with transactions.



1. **Listar operações que criam/concedem/debitam/incrementam.**
2. **Para cada, identificar a chave de idempotência natural** — existe no request
   (header, idempotency key, eventId) ou no payload?
3. **Rastrear onde a chave é verificada** — o handler busca o efeito pela chave antes
   de executar? Ou executa sempre?
4. **Testar repetição** — envie o mesmo request N vezes (mesma chave/payload). Efeito
   único ou duplicado?
5. **Testar response-lost + retry** — envie, ignore a resposta, reenvie. O servidor
   reconhece e retorna o efeito original, ou executa de novo?
6. **Testar duplo-submit** — dois POSTs no mesmo instante (double click). Um 200 e um
   409, ou dois 200 com dois efeitos?
7. **Testar webhook dedup** — o mesmo evento entregue 2× (retry do provider) é
   processado 2×?
8. **Testar concorrência de idempotência** — dois requests com a mesma chave chegam
   juntos; ambos passam a verificação antes de qualquer um gravar? (race no dedup)
9. **Confirmar com evidência** — reproduza a duplicação.
10. **Reportar** via `templates/audit-report.md`.

## Questions to Ask

* Qual é a chave de idempotência desta operação? Ela existe?
* O servidor verifica a chave antes de executar, ou executa e só então grava?
* Enviar o mesmo request 2× — efeito único ou duplicado?
* Resposta perdida + retry — o servidor reconhece ou reexecuta?
* Double click / duplo submit — dois efeitos?
* Webhook reentregue pelo provider (retry) — processado 2×?
* A verificação de idempotência é atômica (lock/unique na chave), ou dois requests com
  a mesma chave podem passar juntos?
* O efeito é registrado *depois* de um efeito externo irreversível (cobrança)? (se sim,
  conecta a `error-flow-audit`)

## Attack Patterns

```text
creation duplicated
    POST /orders  → 200 (pedido A)
    POST /orders  (mesmo payload) → 200 (pedido B)  ← dois pedidos, deveria reusar A

payment double charge
    POST /charge {amount, orderId} → 200 (cobrado)
    retry (response lost) → 200 (cobrado de novo)  ← sem idempotency key verificado

reward double-grant
    POST /react → +10 XP
    replay → +10 XP de novo (mesmo target)  ← sem "already reacted" dedup

webhook reprocessing
    provider: eventId=evt_123 entregue → processado (pedido pago)
    provider retry (sem ACK): evt_123 de novo → processado 2× (recompensa 2×)
    ← falta dedup por eventId

notification duplicate
    POST /notify → email enviado
    retry → email de novo  ← sem dedup por recipient+type+id

counter double increment
    POST /increment (mesma chave) ×2 → count += 2  ← deveria += 1

race on idempotency key
    A e B: POST {key:"k1"}  (nenhum gravou ainda)
    ambos passam lookup (não acham k1)
    ambos executam → efeito duplicado apesar da chave
    defesa: unique constraint na chave (segundo INSERT falha)
```

## Evidence Requirements

* **Nomear a operação e sua chave de idempotência** (ou a ausência dela).
* **Mostrar o efeito duplicado** — repetição/retry/replay reproduzido, com o efeito 1×
  vs 2×.
* **Mostrar onde a chave não é verificada** — o handler executa sem lookup por chave,
  ou verifica depois de agir.
* **Verificar a atomicidade do dedup** — a chave tem unique constraint? Ou dois
  requests simultâneos passam juntos (race)?
* **Escalar confiança:**
  * `CONFIRMED` — reproduziu o efeito duplicado (2 pedidos, 2 cobranças, 2 rewards).
  * `HIGH CONFIDENCE` — handler executa sem verificação de chave em operação de
    efeito-único; sem reprodução.
  * `POSSIBLE` — operação candidata, caminho não confirmado.
  * `SPECULATIVE` — "pode duplicar em retry" sem rastrear.
* Duplicação de cobrança/reward = mínimo `HIGH CONFIDENCE` se o padrão for claro.

## False Positives

* **Idempotência real** — se há idempotency key + lookup + unique constraint, a
  repetição retorna o efeito original. Confirmar antes de reportar.
* **Operação é naturalmente idempotente** — `GET`, `PUT` com valor absoluto (SET), e
  `DELETE` muitas vezes são idempotentes por natureza. Não reportar.
* **Duplo-submit defendido** — se o botão desabilita no submit E o servidor tem
  idempotency, defesa em profundidade. Não reportar.
* **Webhook com dedup por eventId** — se o provider envia eventId e o servidor dedup
  por ele (único), reprocessamento é evitado. Confirmar a dedup.
* **Notificação é fire-and-forget tolerada** — se o produto tolera email duplicado
  raro (e não há consequência), pode ser aceitável. Julgar pelo impacto.
* **Contador é aproximado por design** — alguns contadores (views) são eventualmente
  consistentes e toleram drift. Relacionado a `state-consistency-audit`; não reportar
  se o produto tolera.
* **Retry com query-decidida** — se após response lost o sistema consulta o estado
  real antes de reexecutar, é idempotente por compensação. Não reportar.

## Output Format

Para cada operação que duplica efeito em repetição/retry, um finding via
`templates/audit-report.md`. Em **Reproduction**, dê a sequência de requests (mesma
chave/payload) e o efeito observado 1× vs 2×. Em **Affected flow**, nomeie a operação
(payment/reward/creation/webhook/notification/counter). Em **Root cause**, diga o que
falta (idempotency key, lookup antes de agir, unique constraint na chave, dedup por
eventId). Em **Recommendation**, indique a defesa (chave + `INSERT ... ON CONFLICT`/
unique, lookup + reuso do efeito, dedup por eventId em webhooks).

Apresente a tabela por operação (operação | chave de idempotência | verificada antes de
agir? | dedup atômico? | efeito duplicado? | ✓/✗). Cobranças e rewards primeiro;
criação, webhooks e notificações depois; contadores por último (impacto menor).
