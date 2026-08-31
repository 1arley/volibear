---
name: authorization-audit
description: Analyzes authenticated vs authorized vs owner vs moderator vs admin vs resource-participant and verifies that authorization is enforced on the server for every resource access, not just authentication.
user_invocable: true
---


# Authorization Audit

## Objective

Ensinar o agente a separar **autenticação** (quem é você) de **autorização** (o que você
pode fazer) e a verificar que o servidor impõe autorização para *cada* acesso a recurso.
O bug canônico desta skill:

```text
GET /resource/123

authenticated ≠ authorized
```

Estar logado não significa ter permissão sobre o recurso 123.

## When to Use

* Sempre que um fluxo envolve recursos pertencentes a um usuário (posts, pedidos,
  documentos, configurações, dados de perfil).
* Quando há papéis (authenticated / authorized / owner / moderator / admin /
  resource participant) e transições entre eles.
* Antes de lançar features com dados sensíveis ou multi-tenant.
* Quando o pedido menciona "authorization", "access control", "permissions", "roles",
  "IDOR", "privilege escalation", "who can access".
* **Composição:** núcleo de auditoria de acesso. Pareia com `input-trust-audit`
  (ownership/role confiados ao cliente), `api-abuse-audit` (bypass via endpoints
  alternativos), `business-logic-audit` (ownership como regra), `user-flow-audit`
  (fluxos que cruzam fronteiras de papel).

## Mental Model

Autorização é uma matriz: **sujeito × ação × recurso**. Cada célula deve ter uma
decisão (permitir / negar) imposta no servidor. Bugs vivem em três lugares:

1. **Células não avaliadas** — o handler checa autenticação mas não autorização; a
   célula "qualquer usuário × ler × recurso alheio" nunca é testada.
2. **Decisão no cliente** — a UI esconde botões baseada em papel, mas o endpoint
   aceita o request de qualquer um. O usuário malicioso não usa a UI.
3. **Papéis implícitos / confusos** — "authenticated" tratado como "authorized"; ou
   "participant" confundido com "owner"; ou moderator com poder de admin sem checagem
   explícita.

Os papéis formam uma hierarquia que deve ser *explícita*:

```text
authenticated        — tem identidade, nada mais
authorized            — tem permissão para a ação (genérica)
owner                 — é dono do recurso específico
resource participant  — é parte do recurso (membro, convidado)
moderator             — pode agir sobre recursos de outros num escopo
admin                 — pode agir sobre tudo num escopo
```

A skill percorre a matriz e procura células não-impostas.

## Investigation Procedure

> **Shared knowledge:** for the authN/authZ model, ownership predicates and IDOR,
> read `knowledge/security/authorization.md` when auditing resource access.



1. **Listar recursos** e suas ações (CRUD + ações de domínio: approve, invite, transfer).
2. **Para cada par (recurso, ação), determinar o papel exigido** — owner?
   participant? moderator? admin? ou basta authenticated?
3. **Verificar onde a decisão é imposta** — handler server-side? middleware?
   só no cliente? em nenhum lugar?
4. **Testar horizontal privilege escalation** — usuário A acessa recurso de usuário B
   (mesmo papel, dono diferente). O servidor rejeita?
5. **Testar vertical privilege escalation** — usuário authenticated tenta ação de
   admin/moderator. O servidor rejeita?
6. **Testar IDOR** — manipular o ID do recurso (`/resource/124` em vez de `/123`) para
   acessar recurso alheio.
7. **Testar participant vs owner** — um membro de um grupo pode deletar o grupo? Um
   convidado pode transferir ownership?
8. **Verificar papel vindo do cliente** — role/ownership é confiado no payload?
   (conecta a `input-trust-audit`).
9. **Confirmar com evidência** — reproduza o acesso indevido ou aponte o handler que
   não checa.
10. **Reportar** via `templates/audit-report.md`.

## Questions to Ask

* Para cada (recurso, ação): qual papel é exigido? Onde é checado?
* O handler valida que o solicitante é o *owner* do recurso, ou só que está logado?
* Posso trocar o ID no path/body para acessar recurso de outro usuário? (IDOR)
* Um usuário comum pode chamar um endpoint admin? (vertical escalation)
* O papel vem do token/sessão (server-side) ou do body do request? (input trust)
* "Participant" e "owner" são distinguidos? Um participant pode deletar?
* Moderator tem os poderes de admin delimitados por escopo, ou globais?
* Há um middleware de autorização ou cada handler reimplementa (e esquece)?
* A UI esconde ações — e o endpoint correspondente as rejeita sem a UI?

## Attack Patterns

```text
IDOR — horizontal
    user A: GET /order/1000  (próprio) → 200
    user A: GET /order/1001  (de user B) → 200? deveria ser 403

vertical escalation
    user (authenticated): POST /admin/users/delete {id} → 200? deveria ser 403

participant → owner action
    member: DELETE /group/{groupId}            → permitido? só owner deveria

role from client
    PUT /profile {role: "admin"}               → aceito? (mass assignment / input trust)
    POST /grant {targetUserId, xp}             → sem checar que caller é admin

moderator scope bleed
    moderator of forum X acts on forum Y       → escopo validado?

missing middleware, handler forgets
    /api/orders/* tem authz middleware
    /api/orders/special-case  esqueceu de herdar  → bypass

authenticated treated as authorized
    GET /settings/{userId}                     → só checa token válido, não que userId==token.sub

delete via alternative verb/endpoint
    não pode DELETE /post/123 (checa owner)
    pode POST /post/123/delete  (esqueceu checar)  → bypass por endpoint alternativo
```

## Evidence Requirements

* **Nomear o (recurso, ação) e o papel exigido vs o papel imposto.**
* **Mostrar o acesso indevido** — request reproduzido com dois usuários, ou o handler
  que checa só autenticação.
* **Classificar o tipo** — IDOR (horizontal) / vertical escalation / participant→owner /
  role-from-client / scope-bleed / endpoint-alternativo.
* **Escalar confiança:**
  * `CONFIRMED` — reproduziu com duas contas (A lê/edita recurso de B, ou common faz
    admin).
  * `HIGH CONFIDENCE` — handler visivelmente não checa ownership, sem reprodução.
  * `POSSIBLE` — endpoint suspeito, caminho não confirmado.
  * `SPECULATIVE` — "deveria haver checagem" sem rastrear.
* Acesso a dados sensíveis de outro usuário = mínimo `HIGH CONFIDENCE` se reproduzido.

## False Positives

* **Autorização via middleware/global** — se um middleware impõe authz para todos os
  endpoints sob um prefixo, o handler "sem checagem" está coberto. Confirmar o
  middleware aplica à rota exata.
* **Recurso é público por design** — alguns recursos são world-readable (perfil
  público, post público). Acessar sem ser owner é intencional. Verificar a intenção.
* **Participant tem poderes reais** — se o produto define que membros podem deletar,
  isso é decisão de produto, não bug. Marcar `POSSIBLE` se duvidar.
* **Role imposta por token, não pelo body** — se o servidor ignora `role` no body e usa
  o claim do token, "role from client" é defesa, não defeito. Confirmar.
* **Endpoint admin separado e protegido** — se a ação admin vive só em `/admin/*`
  protegido, o endpoint "comum" que parece exposto pode nem existir/implementar.
* **Self-access legítimo** — acessar o próprio recurso via ID alheio-numerado não é
  IDOR se o ID é o seu.

## Output Format

Para cada (recurso, ação) sem imposição server-side de autorização, um finding via
`templates/audit-report.md`. Em **Reproduction**, dê o request com duas identidades
demonstrando o acesso indevido. Em **Root cause**, diga onde a checagem falta
(middleware ausente, handler esqueceu, role do cliente confiada). Em **Recommendation**,
indique imposição server-side (middleware de authz centralizado + checagem de ownership
no handler; nunca confiar role do body).

Apresente a matriz (recurso × ação × papel exigido × onde imposto × ✓/✗). IDOR e
escalada vertical primeiro; participant→owner e scope-bleed depois.
