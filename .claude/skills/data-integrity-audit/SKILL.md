---
name: data-integrity-audit
description: Verifies unique constraints, foreign keys, transactions, cascading, soft delete, enums, and database constraints to confirm the database prevents impossible states instead of trusting application logic to do so.
user_invocable: true
---


# Data Integrity Audit

## Objective

Ensinar o agente a verificar se o **banco de dados** impede estados impossíveis —
em vez de confiar que a aplicação nunca vai gravá-los. A pergunta central (do
`plan.md` §8):

> "O banco deve impedir estados impossíveis sempre que apropriado."

Campos em foco: unique constraints, foreign keys, transactions, cascading, soft delete,
enums, database constraints.

## When to Use

* Quando a aplicação grava dados e *assume* invariants que só ela conhece (regra de
  negócio) — se a regra não está no banco, outra rota pode violá-la.
* Em fluxos com unicidade (username, slug, chave de idempotência), referências
  (FK), estados (enum), e soft delete.
* Quando há escrita concorrente ou múltiplos writers (jobs, workers, admin, import)
  fora do fluxo da aplicação principal.
* Quando o pedido menciona "data integrity", "constraints", "unique", "foreign key",
  "soft delete", "orphans", "enums", "transactions".
* **Composição:** pareia com `race-condition-hunter` (constraint = defesa contra
  race), `idempotency-audit` (unique na chave de idempotência), `error-flow-audit`
  (transação/rollback), `business-logic-audit` (invariants que deveriam ser constraints),
  `state-consistency-audit` (banco como fonte de verdade).

## Mental Model

A aplicação é uma via de escrita; o banco é a **última linha de defesa**. Toda regra
que impede um estado impossível deve, idealmente, existir como constraint — porque:

1. **Aplicação não é o único writer** — jobs, workers, imports, admin tools, migrações,
   e correções manuais escrevem fora dos handlers. Só o banco cobre todos.
2. **Aplicação pode errar** — um bug de lógica grava dados inválidos e não há erro.
   A constraint transforma silêncio em erro.
3. **Aplicação pode ter race** — dois requests passam a checagem; a constraint rejeita
   o segundo (ver `race-condition-hunter`).

A skill verifica, para cada invariant importante: **ele está no banco, ou só na
aplicação?** Se só na aplicação, é uma crença, não uma garantia.

Eixos a verificar (do `plan.md` §8):

```text
unique constraints   — unicidade real ou contornável?
foreign keys         — referências pendentes/órfãs?
transactions         — writes agrupados atomically?
cascading            — o que acontece quando o pai some?
soft delete          — registros "deletados" ainda referenciáveis?
enums                — estados fora do domínio permitidos?
database constraints — CHECK, NOT NULL, DEFAULT, tipos corretos?
```

## Investigation Procedure

1. **Inventariar invariants** do schema — unicidade, obrigatoriedade, domínio de
   estados, referências, relação pai-filho.
2. **Para cada, verificar se há constraint real no banco** (migração/schema), não só
   validação de aplicação.
3. **Unique**: a coluna é única no DB? Ou só verificada no handler? (race gap)
4. **FK**: referências têm FK real com `ON DELETE` definido? (RESTRICT/CASCADE/SET NULL)
5. **Transações**: operações multi-write são atômicas (uma transaction), ou writes
   parciais possíveis?
6. **Soft delete**: registros soft-deleted ainda são referenciáveis/recuperáveis sem
   proteção? A unicidade ainda vale entre "deletado" e "ativo"?
7. **Enums**: estados são `CHECK`/`enum` no DB, ou strings livres na aplicação?
   Valores fora do domínio podem ser gravados?
8. **Constraints de domínio**: NOT NULL, CHECK (ex: saldo ≥ 0), DEFAULT, tipos.
9. **Testar**: tente inserir/atualizar um valor que violaria o invariant *direto no
   banco* (ou via aplicação sem validação). O banco rejeita?
10. **Confirmar com evidência** e reportar via `templates/audit-report.md`.

## Questions to Ask

* Cada invariant importante tem constraint no banco, ou só validação na aplicação?
* Unique: há índice único? Ou duplicata é possível via race/outro writer?
* FK: há constraint real? O `ON DELETE` está definido e correto?
* Soft delete: a unicidade separa "deletado" de "ativo"? Um slug deletado pode ser
  reclamado? Um item soft-deleted ainda é editável/referenciável?
* Enums: o estado é validado pelo banco (CHECK/enum) ou string livre?
* CHECK: o banco rejeita `balance < 0`, `quantity < 0`, `date` inválido?
* Multi-write: as operações são atômicas? Uma falha no meio deixa partial?
* Migrações: constraints existem no schema de produção, não só em algum ambiente?
* Outros writers (jobs/admin/import) respeitam as regras que só a aplicação conhece?

## Attack Patterns

```text
unique bypass
    app: verifica username único no handler
    banco: sem unique index
    → race ou outro writer grava duplicata; unicidade violada silenciosamente

orphan FK
    post.deleted (hard)  → comments.post_id  pendente
    sem FK / ON DELETE RESTRICT
    → comentários órfãos, referência inválida

soft delete + unique collision
    "deleted" é só um flag; unique na coluna `slug`
    → slug deletado bloqueia reuso, OU slug reusado cria duplicata visível
    (defesa: unique parcial `WHERE deleted_at IS NULL`)

enum as free string
    estado gravado como string no app ("paid", "paid2")
    banco: VARCHAR, sem CHECK
    → estados fora do domínio persistidos; transições inválidas viram dado

no CHECK on negative
    banco aceita quantity = -5
    app valida, mas import/job/admin grava -5
    → estado impossível no dado

transaction partial
    writes em 3 tabelas sem transaction
    falha na 2ª → 1ª commitada, 2ª e 3ª não
    → estado parcial (overlap com error-flow-audit)

cascade wrong
    DELETE user → CASCADE apaga posts (talvez certo) ou RESTRICT bloqueia por um
    comment órfão (talvez errado)
    → política ON DELETE ausente ou errada

NULL where not allowed
    sem NOT NULL em coluna obrigatória (ownerId)
    → registro sem dono; depois autorização quebra (overlap com authorization-audit)
```

## Evidence Requirements

* **Nomear o invariant e o eixo** (unique/FK/transaction/soft-delete/enum/CHECK).
* **Mostrar o schema real** — a migração/DDL que (não) tem a constraint. Cite o
  arquivo/schema.
* **Mostrar a violação** — inserção/atualização que o banco *aceita* mas que viola o
  invariant. Ou a demonstração de que ela é possível (outro writer, race).
* **Escalar confiança:**
  * `CONFIRMED` — gravou o dado impossível direto no banco (ou provou o caminho que o
    grava).
  * `HIGH CONFIDENCE` — schema claramente sem a constraint em invariant claro.
  * `POSSIBLE` — invariant assumido, ausência de constraint plausível.
  * `SPECULATIVE` — "deveria ter constraint" sem identificar o invariant concreto.
* Ausência de unique em unicidade real de negócio = mínimo `HIGH CONFIDENCE`.

## False Positives

* **Constraint existe em migração** — o índice/CHECK/FK existe no schema de produção;
  a validação de app é defesa adicional. Confirmar no DDL real antes de reportar.
* **Semanticamente não-único** — se a coluna *não deveria* ser única (ex: nomes
  repetem), "sem unique" não é bug. Verificar o invariant de negócio.
* **Soft delete sem reuso** — se o produto *não* reusa slugs/identificadores de
  deletados, unique parcial é desnecessário. Julgar pelo comportamento desejado.
* **Enums de app suficientes** — se todos os writers passam pela mesma validação de
  enum da aplicação (nunca há outros writers), string livre é aceitável. Raro; verificar
  a existência de outros writers.
* **CHECK redundante** — se a app garante `balance ≥ 0` com lock+transaction e não há
  outro writer, o CHECK é reforço, não necessidade. Marcar como melhoria, não bug.
* **Cascade policy é correta para o domínio** — CASCADE em user→posts pode ser
  intencional (dados sem valor pós-exclusão). Não reportar política correta.

## Output Format

Para cada invariant sem constraint no banco, um finding via `templates/audit-report.md`.
Em **Affected component**, nomeie a tabela/coluna e o DDL. Em **Reproduction**, dê a
inserção/atualização que viola o invariant e mostre que o banco aceita. Em **Root
cause**, diga qual constraint falta (unique/FK/CHECK/enum/transaction/NOT NULL). Em
**Recommendation**, indique a constraint exata (ex: `UNIQUE (user_id, target_id)`,
`CHECK (balance >= 0)`, `FOREIGN KEY ... ON DELETE RESTRICT`, `CHECK` no enum) e a
migração.

Apresente a tabela por invariant (invariant | eixo | constraint no banco? | onde é
aplicado hoje | ✓/✗). Unique e FK (dados órfãos/duplicados) primeiro; soft delete e
enums depois; CHECK/transações em seguida.
