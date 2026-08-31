---
name: api-abuse-audit
description: Treats the API as directly accessible and investigates repetition, replay, ID manipulation, extra fields, alternative endpoints, missing rate limiting, and UI bypass to find abuse the server fails to prevent.
license: MIT
metadata:
    aes-category: security
    aes-priority: high
---

# API Abuse Audit

## Objective

Ensinar o agente a **tratar a API como diretamente acessível**, ignorando a UI. O
usuário malicioso não clica em botões; ele chama endpoints. Esta skill procura abuso
que o servidor falha em prevenir quando o request é construído à mão: repetição, replay,
manipulação de IDs, campos extras, endpoints alternativos, ausência de rate limiting, e
bypass da UI.

## When to Use

* Em qualquer auditoria onde existe uma API por trás de um frontend.
* Quando uma ação sensível (grant, create, transfer, redeem, vote) é exposta por
  endpoint.
* Quando o pedido menciona "API abuse", "rate limiting", "bypass UI", "direct API
  calls", "replay", "mass assignment".
* **Composição:** pareia com `input-trust-audit` (campos extra = valores confiados),
  `authorization-audit` (ID manipulation = IDOR), `idempotency-audit` (replay/repeat),
  `race-condition-hunter` (concorrência via API), `gamification-audit` (abuso de
  reward via API), `business-logic-audit` (limites via API).

## Mental Model

A UI é uma camada de conveniência, não de segurança. Toda proteção que vive só na UI
(esconder campos, desabilitar botões, limitar cliques, validar no submit) é inexistente
para quem chama a API direto. O modelo:

```text
para cada ação exposta:
    qual request a UI faz?
    quais campos/IDs/parâmetros o servidor aceita além do que a UI envia?
    o servidor impõe limite/frequency/idempotência/ownership?
```

O eixo central é: **qual é a diferença entre o que a UI permite e o que a API aceita?**
Toda diferença é uma superfície de abuso potencial.

Classes de abuso (do `plan.md` §7):

```text
repetition             — chamar a mesma ação N vezes
replay                 — reenviar um request capturado
ID manipulation        — trocar IDs para agir sobre recursos alheios
extra fields           — enviar campos que a UI não mostra (mass assignment)
alternative endpoints  — contornar o endpoint protegido por um equivalente desprotegido
missing rate limiting  — nenhuma frequência imposta
UI bypass              — fazer pela API o que a UI proíbe/esconde
```

## Investigation Procedure

1. **Inventariar endpoints** da ação em escopo (e endpoints equivalententes/relacionados).
2. **Para cada endpoint, capturar o request nominal** — método, path, body, headers,
   auth. Este é o que a UI envia.
3. **Testar repetição** — envie N vezes. O efeito escala? Há limite?
4. **Testar replay** — capture um request válido, reenvie após o efeito esperado ter
   expirado/consumido. Ainda funciona?
5. **Testar ID manipulation** — troque o ID do recurso por um alheio. (conecta a
   `authorization-audit`/IDOR).
6. **Testar extra fields** — adicione campos não-enviados pela UI (`role`, `xp`,
   `ownerId`, `status`, `price`). Aceitos? (mass assignment).
7. **Testar endpoints alternativos** — existe um segundo endpoint que faz o mesmo sem
   a checagem? (admin/internal/legacy path).
8. **Testar rate limiting** — burst de requests. Algum é rejeitado (429)? Ou tudo
   passa?
9. **Testar UI bypass** — qual ação a UI proíbe (disabled/hidden) cujo endpoint ainda
   aceita?
10. **Confirmar com evidência** — reproduza o abuso e observe o efeito.
11. **Reportar** via `templates/audit-report.md`.

## Questions to Ask

* Quais endpoints servem a ação? Só um, ou há versões alternativas (admin/internal)?
* O que a UI envia vs o que o servidor aceita? Campos extras são ignorados ou gravados?
* Repetir o request N vezes — o efeito cresce sem limite?
* Um request capturado pode ser reenviado depois? (replay / sem nonce ou expiry)
* Trocar o ID do recurso — acesso alheio permitido?
* Há rate limiting? Por-IP, por-user, por-recurso? É bypassável (trocar IP, multi-conta)?
* A UI desabilita uma ação em certo estado — o endpoint correspondente rejeita também?
* Campos como `role`/`xp`/`price` no body — o servidor lê do payload ou da sessão/DB?
* Há um endpoint "interno" ou "legacy" sem authz que faz o mesmo efeito?

## Attack Patterns

```text
repetition
    POST /claim  ×100   → 100 rewards? limite imposto?

replay
    POST /vote {postId:7}  → 200 (registrado)
    replay same request    → 200 again? voto duplicado / troca-e-vota de novo?

ID manipulation
    POST /react {targetUserId: <other>}   → reage em nome/para outro?

extra fields (mass assignment)
    PUT /profile {bio:"x"}
    PUT /profile {bio:"x", role:"admin"}  → role gravado?

alternative endpoint
    POST /reactions        (valida "no self-reward")
    POST /reactions/internal/bulk          (valida? ou é legacy desprotegido?)

missing rate limiting
    1000 req/s para /redeem   → nenhum 429? drena estoque/cota

UI bypass
    UI: botão "delete" disabled quando status=="locked"
    API: DELETE /item/{id}   → aceita mesmo em locked? (validação server-side?)

parameter tampering
    POST /transfer {amount: 100, currency}
    POST /transfer {amount: -100}          → inverte fluxo? (edge-case overlap)

verb tampering
    GET /admin/users bloqueado por authz no GET
    POST /admin/users (ou HEAD)            → middleware só protegeu um verbo?
```

## Evidence Requirements

* **Nomear o endpoint e o tipo de abuso** (repeat/replay/ID/extra/alternative/rate/UI
  bypass).
* **Mostrar o request exato** que abusa (método, path, body, headers) e a resposta.
* **Mostrar o efeito** — o que o abuso consegue (reward N×, acesso alheio, role
  alterada, cota drenada).
* **Escalar confiança:**
  * `CONFIRMED` — reproduziu o abuso e observou o efeito (request + resposta +
    consequência).
  * `HIGH CONFIDENCE` — endpoint visivelmente sem a proteção, sem reprodução manual.
  * `POSSIBLE` — abuso plausível, não confirmado.
  * `SPECULATIVE` — "poderia ser abusado" sem rastrear.
* Abuso que concede valor ou acessa dado alheio = mínimo `HIGH CONFIDENCE` se
  reproduzido.

## False Positives

* **Rate limiting existe e é eficaz** — se 429 é retornado e o efeito não escala,
  "repetition" é defendido. Confirmar o limite antes de reportar.
* **Mass assignment defendido por allowlist** — se o servidor usa uma allowlist de
  campos atualizáveis e ignora o resto, `role` extra não é gravado. Confirmar.
* **Replay defendido por nonce/expiry** — se há idempotency key ou nonce com TTL,
  replay não duplica. Relacionado a `idempotency-audit`; não duplique.
* **ID manipulation defendido por ownership check** — se o handler valida que o
  recurso pertence ao caller, IDOR não aplica. Relacionado a `authorization-audit`.
* **Endpoint alternativo é protegido igual** — se `/internal/*` exige admin real,
  não é bypass. Confirmar a proteção no endpoint alternativo.
* **UI bypass é puramente cosmético** — se a ação "disabled" na UI é também rejeitada
  server-side no mesmo estado, não há bypass.
* **Ação é pública/idempotente por design** — alguns endpoints públicos sem rate limit
  são aceitáveis (ex: view counter). Julgar pelo impacto.

## Output Format

Para cada abuso confirmado/plausível, um finding via `templates/audit-report.md`. Em
**Reproduction**, dê o request exato (curl-equivalente) e a resposta observada. Em
**Affected component**, nomeie o endpoint. Em **Root cause**, diga qual proteção falta
(rate limit / allowlist de campos / ownership check / nonce / proteção no endpoint
alternativo). Em **Recommendation**, indique a defesa server-side (rate limit por-user
não só por-IP; allowlist de campos; ownership check; idempotency key; descontinuar
endpoint legacy).

Apresente a matriz (endpoint × tipo de abuso × protegido? × evidência). Abuso que
concede valor ou acessa alheio primeiro; missing rate limiting e UI bypass depois.
