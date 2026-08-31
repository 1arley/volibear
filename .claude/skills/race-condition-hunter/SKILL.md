---
name: race-condition-hunter
description: Hunts for READ → DECISION → WRITE sequences and asks what happens if another request modifies the shared state between the read and the write, exposing double-spend, over-limit grants, and counter inflation under concurrency.
user_invocable: true
---


# Race Condition Hunter

## Objective

Ensinar o agente a reconhecer o padrão canônico de race condition e a testar se o
sistema sobrevive a dois requests simultâneos sobre o mesmo estado:

```text
READ
  ↓
DECISION
  ↓
WRITE
```

A pergunta central (do `plan.md` §8):

> "O que acontece se outro request modificar o estado entre essas operações?"

## When to Use

* Sempre que uma operação lê estado, decide baseada no que leu, e escreve — sem lock ou
  atomicidade.
* Em fluxos com valor: saldo, estoque, cota/limite, contador, reward, voto, convite.
* Quando há "check-then-act": checa saldo → debita; checa limite → concede; checa
  unicidade → cria.
* Quando o pedido menciona "race condition", "concurrency", "simultaneous", "double
  spend", "TOCTOU", "check then act".
* **Composição:** pareia com `idempotency-audit` (retry concorrente), `business-logic-audit` (limite/invariant que dependem de read-then-write), `data-integrity-audit`
  (constraint/lock que deve defender), `error-flow-audit` (estado parcial após falha
  concorrente), `gamification-audit` (reward farming concorrente).

## Mental Model

Uma race condition não é sobre *velocidade* — é sobre **janela entre leitura e escrita**.
Se dois requests leem o mesmo estado (ambos veem "ok"), ambos decidem "permitido", e
ambos escrevem, o invariant é violado — mesmo que cada um isoladamente esteja correto.

```text
request A: READ  balance=100   (≥50? yes)
request B: READ  balance=100   (≥50? yes)   ← mesma leitura, A ainda não commitou
request A: WRITE balance=50
request B: WRITE balance=50    ← saldo real = 50, mas dois débitos de 50 = -50 efetivo
```

O defeito é a **ausência de atomicidade** entre read e write. As defesas:
* **lock** (pessimistic) — ninguém lê/escreve entre;
* **conditional update / CAS** (optimistic) — `UPDATE … WHERE balance=100` falha se
  mudou;
* **unique constraint** — o banco impede a duplicata;
* **serializable transaction / SELECT FOR UPDATE** — o banco isola.

A skill procura a janela e pergunta qual defesa (se alguma) a fecha.

## Investigation Procedure

> **Shared knowledge:** for read-modify-write, locking and atomic update patterns,
> read `knowledge/engineering/concurrency.md` and `knowledge/engineering/transactions.md`
> before designing the confirmation test.



1. **Encontrar sequências READ → DECISION → WRITE.** Para cada operação que muta
   estado baseada em leitura, mapeie as três etapas.
2. **Identificar o estado compartilhado** — linha de DB, contador, cache, arquivo.
3. **Identificar o invariant** que a decisão protege (saldo ≥ 0, limite ≤ N, único,
  estoque ≥ 0).
4. **Determinar a atomicidade** — há transação? lock? CAS? constraint? ou read e write
   em momentos separados sem proteção?
5. **Modelar a intercalação** — dois requests (ou mais) lêem o mesmo estado antes de
   qualquer write. Ambos passam pela decisão?
6. **Confirmar com evidência** — se possível, reproduza (dois requests simultâneos,
   ou raciocínio sobre o SQL mostrando que o `WHERE` não guarda a condição).
7. **Verificar a defesa** — o `UPDATE` é condicional ao valor lido? Há `SELECT FOR
   UPDATE`? Unique constraint? Se sim, a janela está fechada.
8. **Reportar** via `templates/audit-report.md`.

## Questions to Ask

* A operação lê estado e depois escreve baseada no que leu? Qual o invariant?
* Entre o READ e o WRITE, outro request pode modificar o mesmo estado?
* Há transação? Ela é serializable / usa SELECT FOR UPDATE, ou só agrupa queries?
* O UPDATE é condicional (`WHERE balance = :lido`) ou incondicional (`SET balance = :novo`)?
* Há unique constraint que impediria a duplicata mesmo sem lock de aplicação?
* O limite/cota é checado em read-then-write, ou decrementado atomicamente?
* Dois requests simultâneos passam ambos pela checagem de saldo/limite/estoque?
* O cache é a fonte da leitura? (race entre cache e DB — conecta a `state-consistency-audit`)

## Attack Patterns

```text
double-spend (balance)
    A: READ balance=100 (ok ≥50)   B: READ balance=100 (ok ≥50)
    A: WRITE balance=50            B: WRITE balance=50
    → dois saques de 50 sobre saldo 100; saldo real deveria ser 0, ficou 50 (ou -50)

over-limit grant
    A: READ claims_today=4/5 (ok)  B: READ claims_today=4/5 (ok)
    A: WRITE 5/5 + reward          B: WRITE 5/5 + reward
    → 6/5, limite violado

duplicate creation (uniqueness check-then-insert)
    A: SELECT (slug exists? no)    B: SELECT (slug exists? no)
    A: INSERT slug=x               B: INSERT slug=x
    → dois criados; defesa = unique constraint (se houver)

counter inflation
    A: READ count=10               B: READ count=10
    A: WRITE count=11              B: WRITE count=11
    → deveria ser 12, ficou 11 (increment perdido)
    defesa = UPDATE count = count + 1 (atômico)

reward double-grant (concurrent same action)
    A: react + XP                  B: react (same target) + XP
    → se "already reacted?" check é read-then-write, ambos concedem

stock oversell
    A: READ stock=1 (ok)           B: READ stock=1 (ok)
    A: WRITE stock=0 + order       B: WRITE stock=0 + order
    → dois pedidos, 1 item

cache-then-db race
    A: read cache (miss) → read DB=100 → write cache=100
    B: write DB=50 (invalida cache?)
    → cache serviu 100 após DB virar 50 (state-consistency overlap)
```

## Evidence Requirements

* **Nomear o invariant** e a sequência READ → DECISION → WRITE.
* **Mostrar a janela** — onde está o READ, onde o WRITE, e por que nada os atomiza.
* **Mostrar a intercalação** que viola o invariant (os dois requests lendo o mesmo
  estado).
* **Verificar a defesa ausente** — sem CAS, sem lock, sem constraint, sem transaction
  serializable. Ou a defesa existe mas não cobre (ex: transação sem `FOR UPDATE`).
* **Escalar confiança:**
  * `CONFIRMED` — reproduziu com requests simultâneos e observou a violação (saldo
    negativo, 6/5, duplicata).
  * `HIGH CONFIDENCE` — código mostra read-then-write sem atomicidade em estado
    compartilhado, invariant claro; sem reprodução manual.
  * `POSSIBLE` — padrão presente, estado compartilhado plausível, não confirmado.
  * `SPECULATIVE` — "pode ter race" sem mapear a sequência.
* Races sobre valor transferível (saldo/estoque/reward) = mínimo `HIGH CONFIDENCE` se o
  padrão for claro.

## False Positives

* **CAS / conditional update fecha a janela** — `UPDATE … WHERE balance = :lido` faz B
  falhar se A mudou. Confirmar o `WHERE` guarda a condição antes de reportar.
* **Unique constraint** — mesmo sem lock de aplicação, o banco rejeita a duplicata.
  "Duplicate creation" é defendido se a constraint existe.
* **SELECT FOR UPDATE / serializable** — a transação isola; a janela não existe.
  Confirmar o nível de isolamento real.
* **Incremento atômico** — `UPDATE count = count + 1` é atômico no DB; "counter
  inflation" não aplica. Aplica só se o app lê e reescreve o valor calculado.
* **Estado não é compartilhado** — se cada request opera sobre sua própria linha
  (isolada por chave), não há race no mesmo estado.
* **Cache com invalidação síncrona** — se a escrita invalida o cache antes de servir a
  próxima leitura, a race cache-DB é defendida. Relacionado a `state-consistency-audit`.
* **Limite é soft** — se o limite é orientativo, "6/5" pode ser tolerado por design.
  Marcar `POSSIBLE` e levantar como decisão de produto.

## Output Format

Para cada read-then-write sem atomicidade que viola um invariant sob concorrência, um
finding via `templates/audit-report.md`. Em **Reproduction**, dê a intercalação dos
dois requests (com timestamps/ordem) e o estado final observado. Em **Affected flow**,
nomeie o invariant (saldo ≥ 0, limite ≤ N, único). Em **Root cause**, diga o que falta
(transaction + FOR UPDATE, CAS, unique constraint, incremento atômico). Em
**Recommendation**, indique a defesa apropriada (preferir constraint/CAS no DB quando
possível — o banco é a última linha).

Apresente cada sequência como diagrama READ/DECISION/WRITE com a janela marcada.
Double-spend e over-limit primeiro; counter e cache-DB depois.
