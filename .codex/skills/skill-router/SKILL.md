---
name: skill-router
description: Analyzes a task and selects the smallest sufficient set of audit, security, reliability, product, frontend, and research skills using the structured catalog, risk budget, overlap penalty, and role ordering.
license: MIT
metadata:
    aes-category: meta
    aes-priority: high
---

# Skill Router

## Objective

Selecionar **o menor conjunto suficiente de skills para falsificar as suposições
relevantes**. Não maximizar cobertura aparente.

O router é uma camada de despacho, não um auditor. A implementação determinística vive
em `scripts/router.py`; relações globais, triggers, custos e overlaps vivem somente em
`catalog/skills.yaml`.

## When to Use

* No início de auditorias ou revisões não triviais.
* Quando a tarefa mistura domínios (por exemplo security + reliability).
* Quando é necessário justificar por que uma skill entrou ou ficou fora.
* Para impedir skill explosion antes de executar trabalho caro.
* **Composição:** despacha para skills; não produz findings diretamente.

Tarefas triviais e reversíveis podem selecionar zero skills.

## Mental Model

Trate routing como um problema de conjunto mínimo:

```text
relevant assumptions
        ↓
minimum lenses that can falsify them
        ↓
missing verification roles, if any
        ↓
stop when additional skills only repeat coverage
```

A decisão usa metadata estruturada do catálogo:

```text
trigger_match
+ domain_match
+ risk_unlock
+ required_signal
+ composition_bonus
- overlap_penalty
- cost_penalty
```

Isso não é machine learning. O score torna a decisão rastreável e reproduzível.

### Skill budget

| Risco | Budget normal |
|---|---:|
| `trivial` | 0–1 |
| `medium` | 1–2 |
| `high` | 2–4 |
| `critical` | 3–6 |

Exceder o budget exige uma justificativa concreta de nova cobertura ou confirmação.

### Ordem por role

```text
generator → investigator → verifier → reviewer → researcher
```

Research pode vir primeiro quando incerteza externa é o problema principal.

## Investigation Procedure

1. **UNDERSTAND** — reformule tarefa e contexto; inclua fatos, não apenas o título.
2. **CLASSIFY RISK** — `trivial`, `medium`, `high` ou `critical`.
3. **CLASSIFY DOMAIN** — audit, security, reliability, product, frontend ou research.
4. **READ CATALOG** — use `catalog/skills.yaml`; não reproduza relações manualmente.
5. **MATCH TRIGGERS** — selecione candidatas com evidência lexical ou sinal requerido.
6. **APPLY RISK FLOOR** — descarte skill cujo `risk_floor` não foi alcançado.
7. **SCORE** — aplique domínio, custo, composição e overlap.
8. **ENFORCE BUDGET** — preserve as candidatas de maior score e ganho marginal.
9. **ORDER BY ROLE** — hipótese antes de investigação e verificação.
10. **REPORT NEAR MISSES** — no máximo três candidatas plausíveis que ficaram fora.
11. **ROUTE RESEARCH** — indique se `research-router` é necessário.
12. **VERIFY** — execute `python3 scripts/eval.py route --router v2 --check` após mudança.

## Questions to Ask

* Qual suposição a tarefa precisa falsificar?
* Há dinheiro, recompensa, ownership, permissões ou estado compartilhado?
* Qual skill gera a hipótese e qual consegue confirmar o mecanismo?
* Esta skill adiciona uma lente nova ou apenas repete outra?
* O `risk_floor` da skill foi realmente alcançado?
* O ganho de cobertura justifica o custo de reasoning/research?
* A tarefa precisa de fonte externa ou pode ser resolvida no projeto?
* Se uma candidata ficar fora, ela é um near miss real ou apenas keyword noise?

## Attack Patterns

### Under-routing

```text
critical task → one broad generator → no verifier
```

Ataque: procure mecanismos explícitos (retry, concurrency, ownership, partial failure)
e verifique se uma skill capaz de confirmá-los entrou.

### Over-routing

```text
one matching word → every adjacent skill
```

Ataque: remova cada skill e pergunte se alguma suposição ou capacidade de confirmação é
perdida. Se nada muda, a skill era redundante.

### Ambiguous language

```text
"state" in UI feedback ≠ shared-state consistency
"access" in copy ≠ authorization
"research" in a routine task ≠ full research workflow
```

Ataque: use contexto e sinais requeridos, não palavra isolada.

### Negative context

```text
"no permissions, no shared state"
```

Ataque: termos negados não devem ativar security/reliability.

### Budget pressure

```text
7 plausible skills for a high-risk task (budget max 4)
```

Ataque: mantenha apenas as de maior score e as que adicionam role/lente distinta; mova
as restantes para `Near misses`.

## Evidence Requirements

Uma decisão de routing é sustentada quando inclui:

* tarefa e contexto analisados;
* risco e categoria dominante;
* skills selecionadas em ordem;
* role, score e triggers/sinais de cada seleção;
* budget usado;
* no máximo três near misses;
* decisão de research;
* resultado dos evals determinísticos quando o routing foi alterado.

Gates iniciais:

```text
routing_precision >= 90%
routing_recall >= 90%
critical_skill_recall = 100%
trivial selected <= 1
```

## False Positives

* Selecionar todas as skills relacionadas “por segurança”.
* Promover uma skill só porque sua categoria combina, sem trigger ou sinal.
* Tratar relação `composes_with` como dependência obrigatória.
* Ignorar `overlaps_with` e repetir a mesma cobertura.
* Contar uma skill `useful` como obrigatória em todos os casos.
* Usar contexto negado (`no permissions`) como sinal positivo.
* Listar todas as skills rejeitadas; apenas near misses reais importam.
* Duplicar tabelas globais do catálogo dentro deste arquivo.

## Output Format

```markdown
## Skill Router — Dispatch

**Task:** <tarefa + fatos relevantes>
**Dominant category:** <audit | security | reliability | product | frontend | research>
**Risk:** <trivial | medium | high | critical>
**Budget:** <min–max; selected N>

### Selected
1. `<skill>` — role: `<role>`; score: `<score>`; evidence: `<trigger/signal>`
2. ...

### Near misses
- `<skill>` — <por que parecia relevante e por que ficou fora>
- no more than 3

### Research routing
<none | proportional | full; fontes/skill se necessário>

### Budget justification
<somente quando excedido; caso contrário “within budget”>
```

O executor roda as skills selecionadas e consolida findings separadamente. Routing não
promove hipótese a finding e não escolhe confidence.
