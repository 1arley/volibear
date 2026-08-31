---
name: research-router
description: Decides where to research based on the problem type (animation, UX, architecture, security, product, implementation), routing to the right sources in references/ and the right research skills.
license: MIT
metadata:
    aes-category: meta
    aes-priority: high
---

# Research Router

## Objective

Decidir **onde pesquisar** com base no tipo de problema. O `skill-router` decide *quais
skills*; o `research-router` decide *quais fontes*. É o estágio "RESEARCH ROUTER" do
workflow de auditoria (ver `AGENTS.md` § 4).

## When to Use

* Quando uma tarefa não-trivial precisa de pesquisa antes de implementar (estágio
  "RESEARCH" do workflow).
* Quando o `skill-router` ativou skills de research ou sinalizou que pesquisa é
  necessária.
* Quando você precisa saber a que fontes de `references/` recorrer.
* **Composição:** despacha para `reference-research` (catálogo), `github-reference-research` (GitHub), `market-research` (produtos), `implementation-research`
  (problemas técnicos). Consome o catálogo em `references/*.yaml`.

## Mental Model

O router usa **o tipo de problema** para escolher as fontes. Cada tipo de problema tem
uma combinação de fontes que o resolve melhor:

| Tipo de problema | Fontes (da mais para menos relevante) |
|---|---|
| **Animation** | Animate UI, Impeccable, Interfaces, GitHub, real products |
| **UX** | Laws of UX, Interfaces, real products, design systems |
| **Visual / craft** | Impeccable, Impeccable Slop, Interfaces, Dribbble, dark.design |
| **Architecture** | GitHub, official documentation, production implementations, technical literature |
| **Security** | OWASP, PortSwigger, CWE, GitHub (middleware real) |
| **Engineering/reliability** | OWASP Cheat Sheet, PortSwigger, GitHub (production), Google Testing Blog |
| **Product/gamification** | Reforge, Product Hunt, GitHub (reward systems real) |
| **Implementation técnica** | official documentation → GitHub/issues → production code → articles |
| **Discovery de fontes** | LazyWeb, Shoogle, Hacker News |

E a **classes de conhecimento** determina como usar a fonte (do `plan.md` §12):

```text
methodology    — fundamento (Laws of UX, OWASP)     → pesa como base
heuristic      — princípios (Impeccable, Interfaces) → calibra decisão
inspiration    — estética (Dribbble, dark.design)    → inspira, não decide
implementation — código (Animate UI, GitHub)         → referência, não cópia
discovery      — descoberta (LazyWeb, Shoogle)       → acha mais fontes
```

Não tratar todas como igualmente confiáveis (ver `docs/reference-authoring.md` para
`authority`).

## Investigation Procedure

1. **Classificar o problema** — animation / ux / visual / architecture / security /
   engineering / product / implementation / discovery.
2. **Consultar o catálogo** — abrir os `references/*.yaml` do domínio. Cruzar o
   `use_when` de cada entrada com o problema.
3. **Selecionar as fontes** — pela tabela acima + `authority` (established primeiro).
4. **Determinar a classe de uso** — o que cada fonte oferece (metodologia/princípio/
   inspiração/código/descoberta) e como usá-la.
5. **Despachar** — para as research skills apropriadas (`reference-research` para o
   catálogo, `market-research` para produtos, etc.).
6. **Priorizar** — começar por established/vendor, depois community/curated.
7. **Justificar** a seleção — quais fontes, por quê, e quais foram descartadas.

## Questions to Ask

* Qual é o tipo de problema? (animation/ux/visual/architecture/security/engineering/
  product/implementation/discovery)
* Quais arquivos de `references/` cobrem este domínio?
* Qual `use_when` corresponde ao problema?
* Qual a classe de conhecimento necessária? (metodologia/princípio/inspiração/código/
  descoberta)
* Qual a autoridade de cada fonte candidata? (established > community > curated)
* Que research skill executa a coleta? (reference/github/market/implementation)
* Quais fontes NÃO ajudam este problema? (evitar ruído — ver `AGENTS.md` § 6)

## Attack Patterns

O router não "ataca", mas decide. Os padrões de despacho (do `plan.md` §15):

```text
Animation problem
        ↓
Animate UI
Impeccable
Interfaces
GitHub
real products

UX problem
        ↓
Laws of UX
Interfaces
real products
design systems

Architecture problem
        ↓
GitHub
official documentation
production implementations
technical literature

Security problem
        ↓
OWASP (Top 10 + Cheat Sheets)
PortSwigger
CWE
GitHub (middleware real)

Implementation problem
        ↓
official documentation
GitHub issues/PRs
production code
technical articles

Discovery problem (fontes insuficientes)
        ↓
LazyWeb
Shoogle
Hacker News
```

## Evidence Requirements

O router produz uma **decisão de despacho**, não um finding. Mas a decisão deve ser
rastreável:

* **Listar as fontes selecionadas**, com `type` e `authority`.
* **Citar o tipo de problema** que levou à seleção.
* **Listar as fontes descartadas** e por quê (não ajuda o problema / autoridade baixa /
  fora de escopo).
* **Indicar a research skill** que executará a coleta.
* **Indicar o nível de pesquisa** (nenhuma / proporcional / completa) — ver `AGENTS.md`
  § 6.

## False Positives

* **Consultar tudo sempre** — viola a proporcionalidade. Um problema de UX não precisa
  de OWASP; um problema de segurança não precisa de Dribbble.
* **Inspiração tratada como evidência** — fontes `type: inspiration` (Dribbble,
  dark.design) calibram gosto, não justificam decisão técnica.
* **Fonte de baixa autoridade como base** — community/curated não substitui
  established/vendor para decisões críticas.
* **Despachar para fonte inexistente no catálogo** — o router só pode despachar para o
  que existe em `references/`. Verificar antes.
* **Ignorar o catálogo** — o catálogo existe justamente para não espalhar URLs pelas
  skills; consultá-lo primeiro.

## Output Format

```markdown
## Research Router — Routing

**Problem type:** <animation | ux | visual | architecture | security | engineering |
  product | implementation | discovery>
**Research level:** <none | proportional | full>

### Sources selected (ordered)
1. <fonte> — <type> / <authority> — <por quê: use_when corresponde>
2. ...

### Sources discarded
- <fonte> — <razão>

### Research skill to execute
<reference-research | github-reference-research | market-research |
  implementation-research>
```

Após o despacho, a research skill executa a coleta e sintetiza no formato obrigatório
(ver `AGENTS.md` § 5 e o "Output Format" de `reference-research`).
