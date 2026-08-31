---
name: input-trust-audit
description: Identifies values that should never be trusted from the client (userId, role, price, XP, permissions, ownership, status, reward, timestamps) and verifies the server derives them from the session or database instead of the request payload.
license: MIT
metadata:
    aes-category: security
    aes-priority: high
---

# Input Trust Audit

## Objective

Ensinar o agente a identificar **quais valores nunca devem ser confiados ao cliente** e
a verificar que o servidor os deriva da sessão ou do banco, não do payload do request.
A regra central (também em `AGENTS.md`): não confiar no frontend.

```text
userId   role   price   XP   permissions   ownership   status   reward   timestamps
```

Cada um destes é um valor de *autoridade* — algo que determina identidade, permissão,
valor, ou ordem. Se o servidor lê do payload, o cliente pode forjar.

## When to Use

* Em qualquer endpoint que aceita um body/params com campos sensíveis.
* Ao auditar mass assignment, client-supplied IDs, preços/XP do cliente, timestamps do
  cliente.
* Quando o pedido menciona "input trust", "never trust the frontend", "mass
  assignment", "client-supplied role/price/ownerId".
* **Composição:** pareia com `authorization-audit` (ownership/role do cliente =
  bypass de authz), `api-abuse-audit` (campos extra = mass assignment), `business-logic-audit` (price/XP/reward como regras), `gamification-audit` (XP/reward do
  cliente), `edge-case-hunter` (valores forjados como edge cases).

## Mental Model

Todo input do cliente é *não-confiável por default*. A pergunta não é "isto é seguro?"
mas "o servidor *deriva* este valor ou *aceita* este valor?". Derivar = ler da sessão
autenticada, do banco, ou calcular server-side. Aceitar = ler do body/params e gravar.

A lista canônica de valores de autoridade (do `plan.md` §7):

| Valor | Por que não confiar | De onde derivar |
|---|---|---|
| `userId` | forjar identidade | sessão/token (`token.sub`) |
| `role` | escalar privilégio | sessão/DB, nunca body |
| `price` | zerar/inverter custo | catálogo/DB server-side |
| `XP` | inflar recompensa | calcular server-side pelo evento |
| `permissions` | auto-conceder | sessão/DB |
| `ownership` | reivindicar recurso alheio | DB (recurso.ownerId == caller) |
| `status` | forçar estado (paid/active) | transição server-side validada |
| `reward` | auto-recompensar | determinado server-side pelo trigger |
| `timestamps` | manipular ordem/expiração | `now()` server-side ou DB default |

O bug: o handler faz `user.role = body.role` ou `order.price = body.price` ou
`grant.xp = body.xp`. O cliente envia o que quiser.

Variante: **mass assignment** — o servidor binda todo o body ao modelo e grava campos
que a UI nem envia (`role`, `isAdmin`), porque não há allowlist.

## Investigation Procedure

> **Shared knowledge:** for client-supplied control, mass assignment and
> server-side derivation, read `knowledge/security/input-trust.md`.



1. **Listar todos os campos** que cada endpoint relevante aceita no body/params.
2. **Rotular cada campo**: não-sensível (nome, bio, preferência) vs **valor de
   autoridade** (qualquer da lista canônica, ou qualquer campo que determine
   identidade/permissão/valor/estado/ordem).
3. **Para cada valor de autoridade, perguntar: o servidor deriva ou aceita?**
   * `userId` — vem de `token.sub`/sessão, ou do body?
   * `role` — vem da sessão/DB, ou do body?
   * `price` — vem do catálogo/DB, ou do body?
   * `XP`/`reward` — calculado server-side pelo evento, ou do body?
   * `ownership` — validado contra o DB, ou confiado no body?
   * `status` — transição validada server-side, ou setado do body?
   * `timestamps` — `now()`/DB, ou do body?
4. **Testar mass assignment** — envie campos não-enviados pela UI. Gravados?
5. **Testar forjamento** — envie um valor de autoridade forjado (role=admin,
   price=0, xp=99999). O servidor aceita e age?
6. **Confirmar com evidência** — reproduza o forjamento e observe o efeito.
7. **Reportar** via `templates/audit-report.md`.

## Questions to Ask

* Quais campos o endpoint aceita? Qual é a allowlist (se houver)?
* `userId` no handler vem da sessão ou do body/query? (se do body, forja identidade)
* `role`/`permissions` — lidos da sessão/DB ou do payload?
* `price`/`amount` — do catálogo server-side ou do body?
* `XP`/`reward`/`points` — calculados server-side ou enviados pelo cliente?
* `ownerId`/`assignedTo` — validado contra o DB ou confiado?
* `status` — o cliente pode setar direto (paid/active/deleted)?
* `timestamps` (`createdAt`, `expiresAt`) — `now()` server-side ou do body?
* Há bind automático do body ao modelo (mass assignment)? Qual allowlist o impede?
* Um campo que a UI nunca envia — se eu enviar, é gravado?

## Attack Patterns

```text
userId from body
    POST /comment {postId, userId: <other>}     → comentário em nome de outro?
    (correto: userId = token.sub, ignorar body.userId)

role from body (mass assignment)
    PUT /profile {bio, role:"admin"}            → role gravado?

price from body
    POST /checkout {itemId, price: 0}           → checkout grátis?
    POST /checkout {itemId, price: -50}         → reembolso invertido?

XP from body
    POST /grant {userId, xp: 99999}             → quem chama define o XP?
    (correto: xp calculado pela ação/evento server-side)

ownership from body
    POST /transfer {resourceId, toOwnerId}      → caller é dono? validado?

status from body
    POST /order/{id}/update {status:"paid"}     → cliente marca como pago?
    (correto: transição só via gateway callback verificado)

timestamps from body
    POST /post {content, createdAt:"1970-..."}  → data forjada? expired reanimado?

permissions from body
    PUT /user/{id} {permissions:["*"]}          → auto-concessão?

mass assignment via generic bind
    handler: model.update(req.body)             → sem allowlist → todos os campos
    enviar {isAdmin: true}                       → gravado?
```

## Evidence Requirements

* **Nomear o campo** e classificá-lo (valor de autoridade da lista canônica, ou outro
  sensível).
* **Mostrar de onde o servidor lê** — session/DB vs body/params. Cite a linha/mecanismo.
* **Mostrar o forjamento** — request com o valor forjado e o efeito observado.
* **Escalar confiança:**
  * `CONFIRMED` — reproduziu o forjamento e observou o efeito (role virou admin, price
    zerou, XP inflou).
  * `HIGH CONFIDENCE` — handler visivelmente lê do body um valor de autoridade, sem
    reprodução.
  * `POSSIBLE` — campo suspeito aceito, efeito não confirmado.
  * `SPECULATIVE` — "deveria ser derivado" sem rastrear.
* Forjamento de `role`/`permissions`/`ownership` que escala privilégio = mínimo
  `HIGH CONFIDENCE` se reproduzido.

## False Positives

* **Servidor deriva corretamente** — se `userId = token.sub`, `role` da sessão, `price`
  do catálogo, "campo no body" é ignorado. Confirmar que o servidor *ignora* o campo
  antes de reportar.
* **Allowlist de campos** — se o bind usa uma allowlist explícita (`{bio, name}`) e
  descarta o resto, mass assignment é defendido. Confirmar a allowlist.
* **Campo é legítimo do cliente** — `bio`, `displayName`, `preferences` *devem* vir do
  cliente. Não reportar como "input trust" o que é input legítimo.
* **Timestamp do cliente é referência, não autoridade** — se `scheduledAt` é um input
  legítimo de agendamento (com validação), não é o mesmo que forjar `createdAt`.
* **Status via callback verificado** — se `paid` só é setado pelo callback do gateway
  com assinatura/verificação, o cliente não pode forjar. Confirmar o caminho.
* **Role do body é validado contra a sessão** — se o servidor aceita `role` no body mas
  só permite transições que o caller já tem, é defensivo. Raro; confirmar.

## Output Format

Para cada valor de autoridade aceito (não derivado) do cliente, um finding via
`templates/audit-report.md`. Em **Reproduction**, dê o request com o valor forjado e o
efeito. Em **Affected component**, nomeie o endpoint e o campo. Em **Root cause**, diga
que o servidor lê do body em vez de derivar (cite onde), ou que falta allowlist (mass
assignment). Em **Recommendation**, indique derivação server-side (token.sub, catálogo,
cálculo por evento) e allowlist de campos no bind.

Apresente a tabela de campos por endpoint (campo | sensível? | derivado ou aceito? |
✓/✗). Privilégios (`role`/`permissions`/`ownership`) e valor (`price`/`XP`/`reward`)
primeiro; timestamps e status depois.
