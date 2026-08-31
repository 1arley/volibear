---
name: reference-research
description: Discovers which external sources from the references catalog (methodology, heuristic, inspiration, implementation, discovery) are relevant to the current task and synthesizes findings into actionable patterns, not just a link list.
license: MIT
metadata:
    aes-category: research
    aes-priority: medium
---

# Reference Research

## Objective

Ensinar o agente a **consultar o catálogo centralizado de referências** (`references/`)
para descobrir quais fontes externas são relevantes para a tarefa, e a sintetizar o que
encontrou em um formato acionável, nunca apenas uma lista de links.

## When to Use

* No início de qualquer tarefa não-trivial que se beneficiaria de saber como outros
  resolveram o mesmo problema.
* Quando o `research-router` despacha para o catálogo de referências.
* Quando o `skill-router` indica que pesquisa é necessária (tarefas de arquitetura,
  UX, animação, segurança).
* **Composição:** a skill de entrada de pesquisa. Ativa o `research-router` e alimenta
  `github-reference-research`, `market-research`, e `implementation-research`. Skills
  de frontend/UX/engenharia referenciam fontes que esta skill consulta.

## Mental Model

O catálogo em `references/*.yaml` é a primeira fonte de pesquisa. A pergunta é:

> "Alguém já resolveu este problema?"

E a resposta é uma busca no catálogo por `use_when` que corresponde ao problema, por
`type` que corresponde ao tipo de conhecimento necessário (metodologia vs inspiração),
e por `authority` que corresponde ao peso que a fonte deve ter.

Classes de conhecimento (do `plan.md` §12 e `docs/reference-authoring.md`):

```text
methodology    — frameworks estruturados (Laws of UX, OWASP, Reforge)
heuristic      — princípios aplicáveis (Impeccable, Interfaces)
inspiration    — referência visual, não prescritiva (Dribbble, dark.design)
implementation — padrões de código concretos (Animate UI, GitHub)
discovery      — ferramentas para achar mais fontes (LazyWeb, Shoogle)
```

O `type` da fonte determina **como usar** o que ela oferece: metodologias são
referenciadas como fundamento, inspiração só calibra gosto, implementações são
referências de código (não para copiar cegamente — ver `AGENTS.md` § 1).

## Investigation Procedure

1. **Entender o problema** — qual domínio, qual tipo de conhecimento falta.
2. **Consultar o catálogo** — ler os `references/*.yaml` relevantes para o domínio.
   Para cada candidato, comparar `use_when` e `avoid_when` com o problema.
3. **Selecionar as fontes** mais relevantes — priorizar pelo `authority`
   (established > vendor > community > curated).
4. **Visitar/acessar cada fonte** — ler o conteúdo relevante para o problema.
5. **Extrair padrões, princípios, decisões, trade-offs** — nunca copiar código,
   layout, branding, conteúdo, ou componentes proprietários (ver `AGENTS.md` § 1).
6. **Sintetizar** no formato obrigatório (ver §17 do `plan.md` e "Output Format"
   abaixo) — nunca apenas uma lista de links.
7. **Fornecer recomendação** — o que deve ser adotado, adaptado, ou ignorado.

## Questions to Ask

* Qual domínio do problema? (ux/frontend/engineering/security/product/research)
* Que tipo de conhecimento é necessário? (metodologia/heurística/inspiração/
  implementação/descoberta)
* Quais fontes no catálogo têm `use_when` correspondente?
* Qual a autoridade de cada fonte? (established > community > curated)
* A fonte oferece metodologia, princípio, código, ou inspiração?
* O que é extraível sem copiar? (princípio, padrão, trade-off, decisão)
* Como a fonte se aplica a este contexto específico?
* Que problemas ela introduziria? (trade-offs)
* Devo buscar mais fontes? (se necessário, despachar para `discovery` type)

## Attack Patterns

A skill de research não "ataca" o sistema, mas os padrões de investigação são as
perguntas de despacho:

```text
problema não-trivial
    ↓
consultar catálogo (references/*.yaml do domínio)
    ↓
cruzar use_when × problema → selecionar fontes
    ↓
visitar fontes selecionadas
    ↓
extrair padrão/princípio/trade-off (não copiar)
    ↓
sintetizar (nunca lista de links)
    ↓
recomendar

fontes insuficientes no catálogo
    ↓
despachar para discovery (LazyWeb, Shoogle, Hacker News)
    ↓
nova busca no catálogo (ou github/market/implementation-research)
```

## Evidence Requirements

* **Nomear a fonte e seu `type`/`authority`** — para que o leitor saiba o peso.
* **Mostrar o padrão extraído** — não só o link, mas o que a fonte diz.
* **Explicitar a adaptação** — não é "copie isto", é "aplique assim".
* **Escalar confiança (Research):**
  * `CONFIRMED` — padrão replicável e verificado em fonte de alta autoridade.
  * `HIGH CONFIDENCE` — padrão claro de fonte de autoridade média-alta.
  * `POSSIBLE` — padrão sugestivo, fonte de autoridade baixa.
  * `SPECULATIVE` — especulação sobre o que a fonte pode oferecer sem ter lido.

## False Positives

* **Fonte no catálogo mas irrelevante** — o `use_when` não corresponde à tarefa.
  Não citar fontes irrelevantes só para mostrar cobertura.
* **Inspiração tratada como evidência** — Dribbble é inspiração, não metodologia.
  Não usar para justificar decisão técnica. Ver `AGENTS.md` § 1.
* **Fonte de baixa autoridade citada como verdade** — community/curated são úteis
  mas não substituem established/vendor para decisões críticas.
* **Cópia em vez de adaptação** — extrair código pronto sem contexto ou adaptação
  viola o princípio do repositório. Ver `AGENTS.md` § 1.
* **Pesquisa excessiva para tarefa trivial** — um botão simples não precisa de
  referências. Ver `AGENTS.md` § 6 (proporcionalidade).

## Output Format

Nunca retornar apenas uma lista de links. Usar o formato de síntese do `plan.md` §17:

```markdown
## Research

### Reference
[Name]

### Relevant Pattern
O que foi encontrado.

### Why It Matters
Por que este padrão é útil.

### Adaptation
Como ele poderia se aplicar ao projeto atual.

### Trade-offs
Que problemas ele introduz.

### Recommendation
O que deve de fato ser adotado.
```

Para cada fonte consultada, produza um bloco de síntese. Se múltiplas fontes dão a
mesma recomendação, consolide em um bloco e cite as fontes.

### Evidence Requirements

* **Nomear a fonte e seu `type`/`authority`** — para que o leitor saiba o peso.
* **Mostrar o padrão extraído** — não só o link, mas o que a fonte diz.
* **Explicitar a adaptação** — não é "copie isto", é "aplique assim".
* **Escalar confiança (Research):**
  * `CONFIRMED` — padrão replicável e verificado em fonte de alta autoridade.
  * `HIGH CONFIDENCE` — padrão claro de fonte de autoridade média-alta.
  * `POSSIBLE` — padrão sugestivo, fonte de autoridade baixa.
  * `SPECULATIVE` — especulação sobre o que a fonte pode oferecer sem ter lido.

### False Positives

* **Fonte no catálogo mas irrelevante** — o `use_when` não corresponde à tarefa.
  Não citar fontes irrelevantes só para mostrar cobertura.
* **Inspiração tratada como evidência** — Dribbble é inspiração, não metodologia.
  Não usar para justificar decisão técnica. Ver `AGENTS.md` § 1.
* **Fonte de baixa autoridade citada como verdade** — community/curated são úteis
  mas não substituem established/vendor para decisões críticas.
* **Cópia em vez de adaptação** — extrair código pronto sem contexto ou adaptação
  viola o princípio do repositório. Ver `AGENTS.md` § 1.
* **Pesquisa excessiva para tarefa trivial** — um botão simples não precisa de
  referências. Ver `AGENTS.md` § 6 (proporcionalidade).
