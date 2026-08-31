---
name: edge-case-hunter
description: Generates edge cases around null, empty, zero, negative, huge values, duplicates, Unicode, stale data, deleted data, expired data, and repeated valid actions, then checks whether the system handles each.
license: MIT
metadata:
    aes-category: audit
    aes-priority: high
---

# Edge Case Hunter

## Objective

Ensinar o agente a **gerar sistematicamente** casos de fronteira e verificar se o
sistema trata cada um. Ao contrário de skills que atacam lógica ou fluxo, esta ataca
**valores** — as entradas nos limites onde suposições sobre formato, magnitude e
conteúdo quebram.

## When to Use

* Ao auditar qualquer função/campo que recebe input (formulários, APIs, imports,
  parseadores, cálculos).
* Antes de confiar em um cálculo (saldo, XP, preço, contador, posição, índice).
* Quando o pedido menciona "edge cases", "boundary", "what about X values", "stress
  inputs".
* **Composição:** complementar, não substitutiva. Rode junto com
  `input-trust-audit` (esses valores viriam do cliente?), `business-logic-audit`
  (limites que são regras), `error-flow-audit` (o que acontece quando o edge case
  quebra), `data-integrity-audit` (o banco aceita esses valores?).

## Mental Model

A maioria do código é testada no happy path com valores "redondos" (1, 10, "hello").
Bugs vivem nas **fronteiras** — onde o input deixa de ser "normal" e expõe uma suposição
não escrita: "não será nulo", "não será vazio", "será positivo", "cabe em um int",
"é ASCII", "é único", "ainda existe".

A skill usa uma lista canônica de eixos de fronteira e, para cada campo/entrada
relevante, pergunta "o que acontece se este valor for `<eixo>`?". É exaustivo por
intenção, mas **triado por relevância**: nem todo eixo aplica a todo campo.

Eixos canônicos (do `plan.md` §6):

```text
null              empty             zero             negative
huge values       duplicates        Unicode          stale data
deleted data      expired data      repeated valid actions
```

## Investigation Procedure

1. **Listar entradas.** Identifique todos os campos/parâmetros/entradas que o
   componente recebe (do cliente, de outra camada, de um job, de um import).
2. **Para cada entrada, mapear o tipo e as suposições** — número? string? referência a
   entidade? data? Enumerar o que o código assume sobre ele.
3. **Gerar casos por eixo.** Para cada entrada × eixo aplicável, formule o caso.
   Ex: `balance` × `negative` → "saldo -50"; `name` × `Unicode` → "nome com
   zero-width/emoji/RTR"; `parentId` × `deleted data` → "referencia entidade deletada".
4. **Executar/verificar cada caso.** O que o sistema faz? Erro limpo? Silent fail?
   Estado corrompido? Crash? Comportamento errado sem erro?
5. **Triar.** Descarte casos onde o eixo não aplica (ex: `negative` em um enum).
   Priorize casos que corrompem estado ou causam comportamento errado silencioso.
6. **Confirmar com evidência** — reproduza o input e observe a saída/estado.
7. **Reportar** via `templates/audit-report.md`.

## Questions to Ask

* O que acontece se este campo for `null`? E vazio (`""`)? E só whitespace?
* E se for `0`? E `-1` / negativo?
* E se for enorme (overflow de int, string de 1MB, array de 10⁶ itens)?
* E se houver duplicata (dois iguais onde deveria ser único)?
* E se tiver Unicode exótico (zero-width joiner, RTL, emoji, combinando)?
* E se o dado referenciado foi deletado? (FK pendente, soft-deleted mas ainda usado)
* E se o dado está expirado? (token, sessão, oferta, cupom)
* E se for stale (cache desatualizado vs fonte)?
* E se a mesma ação válida for repetida N vezes? (limite, contador, reward)
* O erro (quando ocorre) é limpo e tratado, ou vaza crash/stack trace?

## Attack Patterns

```text
null
    field: null           → NullPointerException? 500? ou tratado como default?

empty
    name: ""              → validado? ou aceito e quebra display/sort?

zero
    quantity: 0           → cálculo de total = 0 ok? ou divisão por zero downstream?
    price: 0              → checkout grátis "válido"?

negative
    amount: -50           → transfere -50 (inverte fluxo)? saldo fica negativo?

huge
    count: 2147483648     → overflow int? loop eterno? OOM?
    file: 10GB            → limite de upload?

duplicate
    POST /create {slug:"x"} twice   → 409? ou cria dois?

Unicode
    name: "a​​b"          → zero-width; igual a "ab"? duplicata invisível?
    name: "‮"                  → RTL override; rendering invertido

deleted data
    POST /comment {postId: <deleted>}   → cria comentário órfão?

expired data
    redeem code expired   → ainda resgata? ou checa expiração?

stale data
    cache: balance=100, db: balance=50   → usa cache e permite gastar 100?

repeated valid action
    claim reward 5×       → limite por-janela respeitado? ou farming?
```

## Evidence Requirements

* **Nomear o eixo e o campo** testados.
* **Mostrar o input exato** usado (valor literal, não "um valor grande").
* **Mostrar a saída/estado resultante** — não só "quebra", mas *como* (erro 500,
  silent success com estado errado, crash, comportamento correto).
* **Escalar confiança:**
  * `CONFIRMED` — reproduziu com o input literal e observou o resultado.
  * `HIGH CONFIDENCE` — código mostra caminho que não trata o eixo, sem reprodução.
  * `POSSIBLE` — eixo plausível, caminho não confirmado.
  * `SPECULATIVE` — "pode quebrar com X" sem rastrear.
* Priorize `silent success com estado errado` — é pior que crash, porque não alerta.

## False Positives

* **Validação de tipo no boundary do framework** — se o ORM/schema rejeita null/empty
  antes do handler, o caso é tratado. Confirmar antes de reportar.
* **Default intencional** — alguns campos legitimamente defaultam null/0 e o código
  trata downstream. Não reportar "aceita null" se o nulo é intencional e tratado.
* **Unicode normalizado por design** — se o sistema normaliza (NFC) e colapsa
  zero-width de propósito, "duplicata invisível" é tratada, não bug.
* **Soft delete intencional** — referenciar entidade "deletada" (soft) pode ser
  desejado (histórico). Verificar se é hard ou soft delete antes de reportar.
* **Limite enorme não é defeito** — se o sistema *deve* aceitar arquivos grandes,
  "aceita 10GB" não é bug; "não limita e dá OOM" seria.
* **Caso não aplica** — `negative` em um boolean/enum não aplica; não force.

## Output Format

Para cada caso que produz comportamento errado (não só erro), um finding via
`templates/audit-report.md`. Em **Reproduction**, dê o input literal e o comando
request. Em **Actual behavior**, descreva exatamente o resultado observado. Em
**Recommendation**, indique validação (onde: schema vs handler vs sanitização).

Apresente a matriz de cobertura como tabela (entrada × eixos aplicáveis, marcando
✓ tratado / ✗ falha / — não aplica). Isto documenta quais eixos foram testados e
previne retrabalho. Silenciosos (estado errado sem erro) primeiro; crashes depois.
