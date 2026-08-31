---
name: business-logic-audit
description: Identifies business rules, invariants, limits, ownership, transitions, and rewards and for each asks where it is enforced, whether it can be bypassed, repeated, reversed, or raced.
license: MIT
metadata:
    aes-category: audit
    aes-priority: high
---

# Business Logic Audit

## Objective

Ensinar o agente a extrair as **regras de negócio** implícitas em um sistema e, para
cada uma, aplicar um protocolo de cinco perguntas que expõe onde a regra é frágil:

```text
Where is it enforced?
Can it be bypassed?
Can it be repeated?
Can it be reversed?
Can it race?
```

A diferença entre "o código faz X" e "o negócio exige X e o código garante X" é onde
moram os bugs de lógica.

## When to Use

* Quando o sistema tem regras: limites, cotas, ownership, permissões, transições de
  estado, economia interna (XP, pontos, moedas, estoque).
* Antes de lançar features que envolvem valor transferível ou contável.
* Quando o pedido menciona "rules", "limits", "quotas", "ownership", "rewards",
  "permissions", "state transitions".
* **Composição:** núcleo de quase toda auditoria de lógica. Pareia com
  `gamification-audit` (regras de recompensa), `idempotency-audit` (repetições de
  regra), `race-condition-hunter` (regras que dependem de read-then-write),
  `authorization-audit` (ownership = autorização), `data-integrity-audit` (regras que
  o banco deve impor), `input-trust-audit` (valores de regra confiados ao cliente).

## Mental Model

Toda regra de negócio é, no fundo, um **invariant** — uma asserção que deve ser sempre
verdadeira. "Um usuário não pode dar XP a si mesmo." "O saldo nunca fica negativo."
"Um item deletado não pode ser editado." "Limite de 5 por dia."

O bug de lógica acontece quando o sistema *acredita* no invariant sem *garanti-lo*. O
modelo é:

```text
regra (invariant)  →  onde é enforcement?  →  bypass? repeat? reverse? race?
```

Se o enforcement está só no frontend, ou só em uma camada, ou em read-then-write sem
lock, o invariant é uma *crença*, não uma *garantia*. A skill transforma crenças em
perguntas e perguntas em evidência.

Classes de regra a procurar:

```text
rules        — o que deve/não deve acontecer
invariants   — o que deve ser sempre verdadeiro
limits       — cotas, máximos, mínimos, por-tempo
ownership    — de quem é o recurso; quem pode agir
transitions  — estados permitidos e proibidos
rewards      — o que concede valor e sob quais condições
```

## Investigation Procedure

> **Shared knowledge:** for the concept behind these rules, read
> `knowledge/engineering/invariants.md` and `knowledge/product/quotas-and-limits.md`
> only when you need the enforcement model or quota patterns.



1. **Inventariar regras.** Leia o fluxo e liste todas as regras implícitas. Para cada,
   rotule a classe (rule/invariant/limit/ownership/transition/reward).
2. **Para cada regra, responder às 5 perguntas:**
   * **Where is it enforced?** — frontend? API? server handler? DB constraint? nenhuma?
   * **Can it be bypassed?** — existe um caminho alternativo (outro endpoint, campo
     extra, manipulação de ID) que contorna o enforcement?
   * **Can it be repeated?** — executar a ação N vezes viola a regra? (limite diário
     resetável por retry? reward por repetição?)
   * **Can it be reversed?** — desfazer + refazer viola a regra? (reward concedida de
     novo ao refazer?)
   * **Can it race?** — a regra depende de ler estado e depois escrever? Dois requests
     concorrentes passam pela checagem?
3. **Triar por severidade** — regras sobre valor transferível (dinheiro, XP, estoque)
   e ownership são mais graves que regras cosméticas.
4. **Confirmar com evidência** — para cada "yes" nas perguntas, reproduzir ou apontar o
   mecanismo no código.
5. **Reportar** via `templates/audit-report.md`.

## Questions to Ask

* Quais são todas as regras de negócio deste fluxo? (liste explicitamente)
* Para cada regra: onde exatamente ela é enforcement? É a única camada?
* A regra confia em algum valor enviado pelo cliente (price, role, xp, ownerId)?
* Se eu repetir a ação, a regra ainda vale? Ou o contador/limite é inconsistente?
* Se eu desfazer e refazer, o efeito é concedido duas vezes?
* A checagem lê estado e depois escreve baseada no que leu? Há janela de race?
* A regra é imposta por constraint do banco (unique, FK, check)? Ou só em código?
* Quem é o owner do recurso? A checagem de ownership é no servidor?
* Existem transições de estado que deveriam ser proibidas mas não são validadas?

## Attack Patterns

```text
bypass — alternative endpoint
    fluxo oficial: POST /reward {reactionId}   (valida regra "não self-reward")
    endpoint direto: POST /admin/grant {userId, xp}   (valida? ou é interno confiável?)

bypass — extra field / mass assignment
    POST /update {name: "x"}
    POST /update {name: "x", role: "admin"}   (campo extra aceito → regra de role violada)

repeat — daily limit reset
    POST /claim   → +1 (contador "hoje": 1/5)
    retry rápido   → o contador é por-calendário ou por-janela? manipular timestamp?

reverse — reward refund + regrant
    react → +10 XP
    unreact → -10 XP (ou não?)
    react → +10 XP
    → se unreact não removeu XP, refazer = farming

race — check-then-act on a limit
    request A: read "hoje: 4/5"  → ok
    request B: read "hoje: 4/5"  → ok  (mesma leitura)
    request A: write "hoje: 5/5" + reward
    request B: write "hoje: 5/5" + reward   → 6/5, regra do limite violada

transition — illegal state reachable
    DELETE /item   → state: "deleted"
    PUT /item {state: "active"}   → permitido? transição proibida não checada?

ownership — authenticated ≠ authorized
    GET /order/123   → 200   (é meu? ou só preciso estar logado?)
```

## Evidence Requirements

* **Nomear a regra e sua classe** (ex: "invariant: saldo não negativo").
* **Responder as 5 perguntas explicitamente** no finding — onde enforced, bypass,
  repeat, reverse, race — mesmo que a resposta seja "não". Isto mostra que o protocolo
  foi aplicado.
* **Mostrar o mecanismo da violação** — o endpoint/campo/sequência que contorna, ou o
  read-then-write que abre race.
* **Escalar confiança:**
  * `CONFIRMED` — reproduziu a violação da regra (ex: claim além do limite, reward
    dupla).
  * `HIGH CONFIDENCE` — código mostra enforcement faltando em um caminho claro.
  * `POSSIBLE` — regra parece não enforced em um caminho plausível, não confirmado.
  * `SPECULATIVE` — "deveria haver uma regra aqui" sem evidência de violação.

## False Positives

* **Enforcement em múltiplas camadas** — se a regra é checada no handler E no banco
  (constraint), um bypass aparente no handler é defendido pelo banco. Confirmar ambas
  antes de reportar.
* **Regra é de UI, não de negócio** — "campo obrigatório no form" pode ser só UX; se o
  backend aceita vazio legitimamente, não é bug de lógica.
* **Limite é soft por design** — alguns limites são orientativos, não duros. Verificar
  a intenção de produto antes de reportar como defeito (marcar `POSSIBLE`).
* **Self-reward prevenido por design diferente** — talvez o sistema permita "self-XP"
  em um contexto (admin) e proíba em outro. Não reportar bypass sem entender o modelo
  de papéis.
* **Regra não existe** — se você *assume* uma regra que o produto não definiu, qualquer
  "violação" é falso positivo. Liste a regra como hipótese e marque `SPECULATIVE` se
  não há evidência de que ela deveria existir.

## Output Format

Para cada regra com um "yes" em qualquer uma das 5 perguntas, um finding via
`templates/audit-report.md`. Em **Affected flow**, nomeie a regra violada. Em
**Reproduction**, mostre o caminho do bypass/repeat/reverse/race. Em **Root cause**,
diga *onde* o enforcement falta (camada, endpoint, ausência de constraint). Em
**Recommendation**, indique a camada que deve garantir o invariant (idealmente o banco,
ou lock/transaction no servidor).

Apresente o inventário de regras como tabela (regra | classe | onde enforced |
bypass? | repeat? | reverse? | race?), marcando as vulnerabilidades. Regras sobre valor
transferível e ownership primeiro.
