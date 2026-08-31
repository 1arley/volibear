---
name: market-research
description: Researches real products and how they solved a problem at scale, comparing UX, onboarding, navigation, information architecture, interaction, empty states, errors, mobile, and terminology.
user_invocable: true
---


# Market Research

## Objective

Ensinar o agente a pesquisar **produtos reais** que resolveram o problema em escala, e
a comparar como abordam UX, onboarding, navigation, information architecture,
interaction, empty states, errors, mobile, e terminology. A pergunta não é "qual é o
mais bonito?" — é (do `plan.md` §13):

> "Como produtos que resolveram esse problema em escala fazem isso?"

## When to Use

* Quando o `skill-router`/`research-router` despacha para pesquisa de mercado (tarefas
  de produto, UX, frontend).
* Quando você precisa saber como a indústria resolve um problema de experiência.
* Quando o pedido menciona "market research", "what do competitors do", "how do
  products handle X", "benchmark", "best-in-class".
* **Composição:** pareia com `reference-research` (metodologia de UX) e
  `github-reference-research` (implementação). Alimenta decisões de produto e frontend.

## Mental Model

Produtos de sucesso em escala resolveram problemas de experiência que você enfrenta.
Eles são uma **evidência do que funciona** — não porque são bonitos, mas porque
sobreviveram a milhões de usuários e ao mercado. O padrão que eles convergem é um forte
sinal de "isto funciona em escala".

Mas cuidado: convergência de mercado ≠ o que você deve fazer. O modelo é:

```text
identificar o problema de experiência
    ↓
encontrar produtos que o resolveram em escala
    ↓
comparar como cada um aborda cada dimensão
    ↓
extrair padrões convergentes (o que TODO mundo faz)
    ↓
identificar padrões divergentes (onde há espaço para diferenciar)
    ↓
adaptar ao nosso contexto, não copiar
```

Dimensões de comparação (do `plan.md` §13):

```text
UX                    — usabilidade geral, clareza
onboarding            — primeira experiência, ativação
navigation            — como o usuário se move
information architecture — como o conteúdo é organizado
interaction           — feedback, micro-interações
empty states          — o que aparece sem dados
errors                — como falhas são comunicadas
mobile                — comportamento responsivo/específico
terminology           — vocabulário usado (consistente? claro?)
```

## Investigation Procedure

1. **Identificar o problema de experiência** em escopo.
2. **Selecionar produtos de comparação** — os que resolveram este problema em escala.
   (De preferência: líderes de mercado, conhecidos, com produto acessível.)
3. **Para cada produto, avaliar cada dimensão** — UX, onboarding, navigation, IA,
   interaction, empty states, errors, mobile, terminology.
4. **Registrar evidências concretas** — não "boa UX", mas "onboarding pergunta 3
   perguntas antes de pedir signup; empty state tem CTA 'criar primeiro item'".
5. **Comparar** — onde os produtos convergem? (padrão maduro) onde divergem? (espaço
   para diferenciação)
6. **Adaptar** — o que faz sentido para o nosso produto/contexto/público.
7. **Sintetizar** no formato obrigatório.

## Questions to Ask

* Quais produtos resolveram este problema em escala? (não só os "bonitos")
* O onboarding deles pede o mínimo antes do valor? Ou exige tudo primeiro?
* A navegação deles é óbvia ou precisa tutorial? (menu, tabs, search)
* A information architecture agrupa por tarefa do usuário ou por estrutura interna?
* As interações dão feedback imediato? (loading, confirmação, undo)
* O empty state orienta a próxima ação? (ou é um vazio)
* Erros são legíveis e acionáveis? (ou genéricos)
* O mobile é uma extensão natural ou uma versão degradada?
* A terminology é consistente? (o mesmo termo para a mesma coisa)
* Onde TODOS convergem? (padrão maduro que devemos adotar)
* Onde eles divergem? (espaço para diferenciar)

## Attack Patterns

A skill não "ataca" o sistema, mas os padrões de investigação são:

```text
problema de experiência
    ↓
selecionar produtos que resolveram em escala (líderes de mercado)
    ↓
avaliar cada dimensão (UX/onboarding/nav/IA/interaction/empty/errors/mobile/terms)
    ↓
registrar evidência concreta (o que o produto faz, não opinião)
    ↓
comparar convergência vs divergência
    ↓
adaptar ao nosso contexto (não copiar)
    ↓
sintetizar e recomendar

produtos selecionados demais ou vagos
    ↓
refinar: 3-6 produtos líderes, foco nas dimensões críticas
```

## Evidence Requirements

* **Nomear o produto** e sua relevância (líder de mercado, conhecido, em escala).
* **Registrar a evidência concreta** por dimensão — o que o produto faz, não opinião.
* **Mostrar convergência/divergência** — onde os padrões se alinham e onde não.
* **Explicitar a adaptação** — o que faz sentido para o nosso contexto.
* **Escalar confiança (Research):**
  * `CONFIRMED` — padrão observado em múltiplos produtos líderes.
  * `HIGH CONFIDENCE` — padrão observado em 1-2 produtos com clareza.
  * `POSSIBLE` — padrão inferido de screenshots/descrição.
  * `SPECULATIVE` — suposição sobre um produto sem ter visto a experiência real.

## False Positives

* **Beleza ≠ solução em escala** — Dribbble (inspiração) não é mercado; é estética.
  Comparar com produtos que *funcionam*, não com designs bonitos.
* **Copiar o produto** — "produto X faz assim" não significa que devemos fazer igual.
  A convergência de mercado é um sinal, não uma ordem. Ver `AGENTS.md` § 1.
* **Contexto diferente** — um padrão do B2B enterprise pode não se aplicar a um
  consumer app, e vice-versa. Avaliar o contexto.
* **Produto sem acesso real** — julgar por screenshots/YouTube é possível, não
  confirmado. Baixar a confiança.
* **Pesquisa excessiva** — comparar 20 produtos é overengineering para uma decisão
  pequena. Proporcionalidade (ver `AGENTS.md` § 6).

## Output Format

Usar o formato de síntese do `plan.md` §17:

```markdown
## Research

### Reference
[Nome do produto]

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

Para comparações entre múltiplos produtos, produza um bloco por produto e uma seção
final "Convergência e divergência" resumindo os padrões convergentes (adotar) e
divergentes (avaliar).

### Evidence Requirements

* **Nomear o produto** e sua relevância (líder de mercado, conhecido, em escala).
* **Registrar a evidência concreta** por dimensão — o que o produto faz, não opinião.
* **Mostrar convergência/divergência** — onde os padrões se alinham e onde não.
* **Explicitar a adaptação** — o que faz sentido para o nosso contexto.
* **Escalar confiança (Research):**
  * `CONFIRMED` — padrão observado em múltiplos produtos líderes.
  * `HIGH CONFIDENCE` — padrão observado em 1-2 produtos com clareza.
  * `POSSIBLE` — padrão inferido de screenshots/descrição.
  * `SPECULATIVE` — suposição sobre um produto sem ter visto a experiência real.

### False Positives

* **Beleza ≠ solução em escala** — Dribbble (inspiração) não é mercado; é estética.
  Comparar com produtos que *funcionam*, não com designs bonitos.
* **Copiar o produto** — "produto X faz assim" não significa que devemos fazer igual.
  A convergência de mercado é um sinal, não uma ordem. Ver `AGENTS.md` § 1.
* **Contexto diferente** — um padrão do B2B enterprise pode não se aplicar a um
  consumer app, e vice-versa. Avaliar o contexto.
* **Produto sem acesso real** — julgar por screenshots/YouTube é possível, não
  confirmado. Baixar a confiança.
* **Pesquisa excessiva** — comparar 20 produtos é overengineering para uma decisão
  pequena. Proporcionalidade (ver `AGENTS.md` § 6).
