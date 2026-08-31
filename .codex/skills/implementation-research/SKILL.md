---
name: implementation-research
description: Researches how specific technical problems are solved in practice, prioritizing official documentation, GitHub, maintainer discussions, production code, and technical articles, and synthesizes findings into an actionable recommendation.
license: MIT
metadata:
    aes-category: research
    aes-priority: medium
---

# Implementation Research

## Objective

Ensinar o agente a pesquisar como **problemas técnicos específicos** são resolvidos na
prática — com uma hierarquia de fontes priorizada — e a sintetizar em uma recomendação
acionável, nunca apenas uma lista de links.

## When to Use

* Quando há um problema técnico concreto (biblioteca, API, padrão, integração,
  performance, concorrência) e você precisa saber como resolvê-lo bem.
* Quando o `research-router` despacha para implementação (arquitetura, framework,
  problemas específicos).
* Quando o pedido menciona "how to implement X", "best way to do X", "library
  choice", "framework pattern", "technical deep dive".
* **Composição:** pareia com `github-reference-research` (implementações reais),
  `reference-research` (catálogo), e `market-research` (produtos).

## Mental Model

A pergunta é: **como este problema técnico é resolvido na prática, e qual solução se
encaixa no meu contexto?** A resposta vem de fontes em uma hierarquia de confiabilidade
(do `plan.md` §13):

```text
official documentation   — a fonte de verdade para a API/framework
GitHub                   — implementações reais, issues, PRs
maintainer discussions   — issues/PRs/CHANGELOG explicam decisões e gotchas
production code          — como projetos maduros fazem na prática
technical articles       — análises, comparações, benchmarks
```

Cada fonte responde a uma pergunta diferente:
* **official docs** — o que a API permite, a forma canônica;
* **GitHub/issues/PRs** — como é usado na prática, quais problemas apareceram, quais
  decisões os maintainers tomaram;
* **production code** — o padrão real em escala, com edge cases reais;
* **articles** — comparações e análise crítica que sintetizam o acima.

## Investigation Procedure

1. **Definir o problema técnico específico** — não "caching", mas "invalidação de
   cache com escrita concorrente em Redis".
2. **Consultar a documentação oficial** primeiro — a API/framework, o pattern
   canônico. Esta é a base.
3. **Se a dúvida persiste** (edge case, trade-off, comportamento não documentado):
   ir para GitHub/issues/PRs e maintainer discussions — como outros resolveram, que
   problemas relataram.
4. **Conferir com production code** — como projetos maduros implementam o padrão.
5. **Sintetizar com artigos** se necessário — comparações, benchmarks, análise.
6. **Extrair decisões e trade-offs** — a recomendação final.
7. **Sintetizar** no formato obrigatório de pesquisa (ver `AGENTS.md` § 5).

## Questions to Ask

* O que a documentação oficial diz? (a forma canônica)
* A documentação resolve o caso específico ou só o happy path?
* Que issues/PRs existem sobre este caso? (gotchas relatados)
* Que decisão os maintainers tomaram e por quê? (design rationale)
* Como projetos de produção implementam? (padrão real, edge cases reais)
* Que trade-offs a solução escolhida introduz?
* Há uma alternativa melhor para o meu contexto? (framework, versão, escala)
* O que é específico do meu projeto e não deve ser copiado?
* A fonte é de alta autoridade (docs, maintainers) ou inferência? (peso da evidência)

## Attack Patterns

A skill não "ataca" o sistema, mas os padrões de investigação são:

```text
problema técnico específico
    ↓
consultar documentação oficial (fonte de verdade)
    ↓
se edge case / trade-off não resolvido → GitHub issues/PRs
    ↓
se ainda necessário → production code (projetos maduros)
    ↓
se comparação ou benchmark → artigos técnicos
    ↓
extrair decisões e trade-offs
    ↓
sintetizar e recomendar (nunca lista de links)

hierarquia de fontes:
    official docs > GitHub/issues > production code > articles
```

## Evidence Requirements

* **Nomear a fonte e sua autoridade** (official docs > GitHub/issues > production
  code > articles).
* **Mostrar a solução encontrada** — o padrão, a API, a decisão. Não só o link.
* **Explicitar os trade-offs** — a solução tem custo (complexidade, lock-in,
  performance, manutenção)?
* **Recomendação acionável** — o que adotar no contexto.
* **Escalar confiança (Research):**
  * `CONFIRMED` — padrão confirmado em documentação oficial ou maintainer discussion.
  * `HIGH CONFIDENCE` — padrão claro de produção/artigos de qualidade.
  * `POSSIBLE` — padrão inferido, uma fonte de autoridade média.
  * `SPECULATIVE` — especulação sem fonte verificada.

## False Positives

* **Documentação não lida** — citar "segundo a doc" sem ler é especulação. Baixar
  confiança.
* **Stack Overflow como fonte primária** — útil para gotchas, mas não substitui a
  documentação oficial para a forma canônica. Priorizar hierarquia de fontes.
* **Copiar em vez de adaptar** — o código de produção de outro projeto raramente se
  adapta direto. Extrair o padrão, adaptar a solução. Ver `AGENTS.md` § 1.
* **Artigo desatualizado** — benchmarks e comparações envelhecem. Verificar data e
  versão.
* **Pesquisa excessiva** — para um problema bem conhecido, a doc oficial basta.
  Não acumular fontes além do necessário (ver `AGENTS.md` § 6).

## Output Format

Usar o formato de síntese do `plan.md` §17:

```markdown
## Research

### Reference
[Nome da fonte + link]

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

### Evidence Requirements

* **Nomear a fonte e sua autoridade** (official docs > GitHub/issues > production
  code > articles).
* **Mostrar a solução encontrada** — o padrão, a API, a decisão. Não só o link.
* **Explicitar os trade-offs** — a solução tem custo (complexidade, lock-in,
  performance, manutenção)?
* **Recomendação acionável** — o que adotar no contexto.
* **Escalar confiança (Research):**
  * `CONFIRMED` — padrão confirmado em documentação oficial ou maintainer discussion.
  * `HIGH CONFIDENCE` — padrão claro de produção/artigos de qualidade.
  * `POSSIBLE` — padrão inferido, uma fonte de autoridade média.
  * `SPECULATIVE` — especulação sem fonte verificada.

### False Positives

* **Documentação não lida** — citar "segundo a doc" sem ler é especulação. Baixar
  confiança.
* **Stack Overflow como fonte primária** — útil para gotchas, mas não substitui a
  documentação oficial para a forma canônica. Priorizar hierarquia de fontes.
* **Copiar em vez de adaptar** — o código de produção de outro projeto raramente se
  adapta direto. Extrair o padrão, adaptar a solução. Ver `AGENTS.md` § 1.
* **Artigo desatualizado** — benchmarks e comparações envelhecem. Verificar data e
  versão.
* **Pesquisa excessiva** — para um problema bem conhecido, a doc oficial basta.
  Não acumular fontes além do necessário (ver `AGENTS.md` § 6).
