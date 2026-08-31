---
name: github-reference-research
description: Researches how features are implemented on GitHub, searching for feature implementation, architecture, database, API, and framework patterns, and evaluating activity, quality, tests, documentation, adoption, license, and architecture to extract ideas without copying.
user_invocable: true
---


# GitHub Reference Research

## Objective

Ensinar o agente a pesquisar como **implementações reais** resolvem o problema, usando
GitHub como fonte, e a **extrair ideias sem copiar cegamente** (ver `AGENTS.md` § 1).

## When to Use

* Quando o `research-router` despacha para GitHub (problemas de arquitetura,
  implementação, ou quando documentação oficial não basta).
* Quando você precisa ver como projetos de produção implementam: `feature
  implementation`, `feature architecture`, `feature database`, `feature API`,
  `feature framework`.
* Quando o pedido menciona "how is this done in production", "GitHub reference",
  "open source example", "real-world implementation".
* **Composição:** pareia com `reference-research` (catálogo) e
  `implementation-research` (como resolver um problema técnico específico). Alimenta
  `market-research` (produtos reais).

## Mental Model

GitHub é uma biblioteca de decisões de engenharia — cada repositório maduro é uma
resposta documentada a um conjunto de trade-offs. O modelo é:

```text
per feature:
    como a implementação é estruturada?   (feature implementation)
    como a arquitetura encaixa?           (feature architecture)
    como o dado é modelado?               (feature database)
    como a API expõe?                     (feature API)
    qual framework/primitiva é usado?     (feature framework)
```

E a avaliação de cada repositório candidato (do `plan.md` §13):

```text
atividade      — recente? mantido? abandonado?
qualidade      — código limpo? padrões? complexidade?
testes         — há testes? cobrem os casos críticos?
documentação   — README, docs, exemplos?
adoção         — stars/forks/uso real (com cuidado: stars ≠ qualidade)
licença        — compatível com o uso pretendido?
arquitetura    — limpa? modular? acoplada?
```

A pergunta central: **o que esta implementação decide, e por quê?** Não "copie o
código", mas "que trade-off esta decisão representa, e ele é bom para o meu caso?"

## Investigation Procedure

1. **Definir a feature e as 5 dimensões** (implementation/architecture/database/API/
   framework) que importam para o problema.
2. **Buscar repositórios** com queries de `references/research.yaml` e
   `references/engineering.yaml` (ex: "<feature> implementation", "<feature> database
   schema").
3. **Triar candidatos** — avaliar atividade, qualidade, testes, documentação, adoção,
   licença, arquitetura. Descartar os que falham nos critérios.
4. **Ler a implementação relevante** — os arquivos-chave da feature (não o repo
   inteiro). Entender a estrutura, o modelo de dados, a API, o framework.
5. **Extrair as decisões** — quais escolhas estruturais, quais trade-offs, quais
   padrões (idempotência, transações, cache, tratamento de erro).
6. **Adaptar** — como aplicar ao projeto atual sem copiar. (princípios sim, código
   específico não).
7. **Sintetizar** no formato obrigatório de pesquisa (ver `AGENTS.md` § 5).

## Questions to Ask

* A implementação da feature é modular ou um blob?
* A arquitetura é limpa? (camadas, boundaries) ou acoplada?
* O modelo de dados reflete o domínio? (unique, FK, enums — ver `data-integrity-audit`)
* A API expõe primitivas limpas ou vaza detalhes internos?
* Qual framework/primitiva resolve a parte difícil? (e qual trade-off isso impõe?)
* O projeto é mantido? (atividade recente, responde a issues)
* Tem testes? Cobrem os casos críticos (concorrência, erro, edge)?
* A documentação explica decisões, ou só a API?
* A adoção é real ou só stars? (forks, dependents, empresas conhecidas)
* A licença permite o uso? (MIT/Apache vs GPL/copyleft)
* O que NÃO copiar? (estrutura específica, código proprietário, configuração de
  ambiente do repo)

## Attack Patterns

A skill não "ataca" o sistema, mas os padrões de investigação são:

```text
feature específica
    ↓
buscar repositórios (implementation/architecture/database/api/framework)
    ↓
triar por atividade/qualidade/testes/docs/adoção/licença/arquitetura
    ↓
ler a implementação relevante (arquivos-chave da feature)
    ↓
extrair decisões e trade-offs (não copiar)
    ↓
adaptar ao contexto
    ↓
sintetizar e recomendar

busca muito ampla ou vaga
    ↓
refinar query (references/research.yaml) + priorizar fonte de alta autoridade
```

## Evidence Requirements

* **Nomear o repositório e a URL.**
* **Avaliar os critérios explicitamente** — atividade, qualidade, testes,
  documentação, adoção, licença, arquitetura. Diga o que você verificou e o que não.
* **Mostrar o padrão extraído** (não o link — o padrão). Ex: "o projeto usa um
  idempotency key + unique constraint para evitar duplicação de pedido".
* **Explicitar a adaptação** — como aplicar sem copiar.
* **Escalar confiança (Research):**
  * `CONFIRMED` — leu a implementação e o padrão está claramente presente.
  * `HIGH CONFIDENCE` — padrão identificado em leitura parcial, forte indício.
  * `POSSIBLE` — padrão inferido de README/estrutura, não confirmado no código.
  * `SPECULATIVE` — suposição sobre o repo sem ler a parte relevante.

## False Positives

* **Stars ≠ qualidade** — repositório popular pode ter arquitetura ruim. Avaliar a
  implementação, não a popularidade.
* **Repo desatualizado** — um projeto parado há 3 anos pode usar padrões obsoletos.
  Verificar atividade antes de confiar.
* **Licença incompatível** — código GPL/copyleft não pode ser copiado livremente.
  Verificar licença antes de recomendar adoção.
* **Copiar em vez de extrair** — "este repo faz X assim" ≠ "devemos fazer X assim".
  Sempre adaptar ao contexto. Ver `AGENTS.md` § 1.
* **Repo como única fonte** — GitHub é uma perspectiva; combinar com documentação
  oficial e produtos reais. Não decidir só por um repo.

## Output Format

Usar o formato de síntese do `plan.md` §17:

```markdown
## Research

### Reference
[Nome do repositório + link]

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

* **Nomear o repositório e a URL.**
* **Avaliar os critérios explicitamente** — atividade, qualidade, testes,
  documentação, adoção, licença, arquitetura. Diga o que você verificou e o que não.
* **Mostrar o padrão extraído** (não o link — o padrão). Ex: "o projeto usa um
  idempotency key + unique constraint para evitar duplicação de pedido".
* **Explicitar a adaptação** — como aplicar sem copiar.
* **Escalar confiança (Research):**
  * `CONFIRMED` — leu a implementação e o padrão está claramente presente.
  * `HIGH CONFIDENCE` — padrão identificado em leitura parcial, forte indício.
  * `POSSIBLE` — padrão inferido de README/estrutura, não confirmado no código.
  * `SPECULATIVE` — suposição sobre o repo sem ler a parte relevante.

### False Positives

* **Stars ≠ qualidade** — repositório popular pode ter arquitetura ruim. Avaliar a
  implementação, não a popularidade.
* **Repo desatualizado** — um projeto parado há 3 anos pode usar padrões obsoletos.
  Verificar atividade antes de confiar.
* **Licença incompatível** — código GPL/copyleft não pode ser copiado livremente.
  Verificar licença antes de recomendar adoção.
* **Copiar em vez de extrair** — "este repo faz X assim" ≠ "devemos fazer X assim".
  Sempre adaptar ao contexto. Ver `AGENTS.md` § 1.
* **Repo como única fonte** — GitHub é uma perspectiva; combinar com documentação
  oficial e produtos reais. Não decidir só por um repo.
