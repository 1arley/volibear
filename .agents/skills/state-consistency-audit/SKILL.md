---
name: state-consistency-audit
description: Compares state across database, API, server state, cache, client state, and URL state, and looks for divergences where the layers disagree about what is true.
license: MIT
metadata:
    aes-category: audit
    aes-priority: high
---

# State Consistency Audit

## Objective

Ensinar o agente a tratar o "estado do sistema" não como uma coisa única, mas como
**várias cópias que devem concordar** — e a procurar os pontos onde elas divergem.

```text
database   API response   server (in-memory)   cache   client state   URL state
```

Um bug de consistência acontece quando duas camadas afirmam coisas diferentes sobre o
messe fato (ex: cache diz "saldo 100", banco diz "50") e o sistema age sobre a errada.

## When to Use

* Quando o sistema tem cache (CDN, Redis, in-memory, SWR/React Query no cliente).
* Quando o estado é refletido na URL (filtros, paginação, tabs, modais via querystring).
* Quando o cliente mantém estado (otimistic UI, estado local vs servidor).
* Quando há read replicas, eventual consistency, ou mensagens assíncronas.
* Quando o pedido menciona "stale", "out of sync", "cache", "refresh shows wrong",
  "desync".
* **Composição:** pareia com `user-flow-audit` (refresh/back-button causam desync),
  `data-integrity-audit` (o banco como fonte de verdade), `error-flow-audit` (estado
  parcial após falha), `edge-case-hunter` (stale data como edge).

## Mental Model

O "estado" não é uma variável — é um **conjunto de representações** que o sistema
mantém em diferentes latências e locais por performance/UX. Cada representação tem um
TTL, um caminho de invalidação, e um caminho de leitura. Bugs nascem quando:

1. **Invalidação ausente** — o estado muda no banco mas o cache não é invalidado.
2. **Ordem de invalidação errada** — escreve no cache antes do banco (e falha), ou
   invalida depois de servir a leitura stale.
3. **Otimistic UI não revertida** — o cliente assume sucesso, atualiza a UI, o servidor
   falha, a UI fica inconsistente com o servidor.
4. **URL como fonte de verdade sem servidor** — a URL diz um estado que o servidor não
   conhece (deep link para estado que expirou/foi revogado).
5. **Read replica lag** — escreve no primário, lê da replica antes da replicação, vê
   estado antigo.

A pergunta central para cada fato do sistema: **qual camada é a fonte de verdade, e
todas as outras convergiram para ela?**

## Investigation Procedure

> **Shared knowledge:** for copies-of-truth and divergence causes, read
> `knowledge/engineering/failure-models.md` and `knowledge/engineering/concurrency.md`
> when cache or multi-writer divergence is suspected.



1. **Inventariar as camadas de estado** para o componente/fluxo. Nem todos os fluxos
   usam todas as seis; liste só as que existem.
2. **Para cada fato relevante** (saldo, status do recurso, permissão, contador), rotule
   a **fonte de verdade** (geralmente o banco) e as **cópias** (cache, cliente, URL).
3. **Traçar o caminho de escrita** — onde o fato é mutado, e em que ordem as camadas
   são atualizadas.
4. **Traçar o caminho de leitura** — qual camada é lida em cada ponto, e se há fallback.
5. **Procurar invalidação ausente ou tardia** — quando o fato muda, cada cópia é
   invalidada/atualizada? Antes ou depois de servir leituras?
6. **Testar desyncs concretos:**
   * Mutar + ler imediatamente de cache (stale read).
   * Mutar no primário + ler de replica (lag).
   * Otimistic update + falha de servidor (UI não revertida).
   * Deep link via URL para estado revogado (URL ≠ servidor).
   * Duas abas / dois clientes mutando (um vê estado do outro?).
7. **Confirmar com evidência** — mostre as duas camadas discordando.
8. **Reportar** via `templates/audit-report.md`.

## Questions to Ask

* Quais camadas de estado existem neste fluxo? Qual é a fonte de verdade?
* Quando o fato muda no banco, o cache é invalidado? Quando — antes ou depois de servir?
* Há read replicas? A leitura após escrita vai para a replica ou o primário?
* A UI atualiza otimisticamente? Se o servidor falha, a UI reverte?
* A URL reflete estado? Esse estado é validado contra o servidor no carregamento?
* Dois clientes (duas abas, dois dispositivos) mutam o mesmo recurso — um vê a mudança
  do outro? Quando?
* Há TTL de cache maior que a janela de mutação esperada?
* O cache é populado por quem? E invalidado por quem? (populador ≠ invalidador = bug)

## Attack Patterns

```text
stale cache read
    write db: balance 50 (was 100)
    read cache: balance 100        ← invalidação faltou ou é assíncrona
    → age sobre 100, permite gastar além do real

read replica lag
    write primary: status "paid"
    read replica (imediatamente): status "pending"   ← replicação não convergiu
    → trata como pendente, reprocessa, duplica efeito

optimistic UI not reverted
    user clicks "like" → UI: liked ✓ (optimistic)
    server: 401/500                   ← falha
    UI permanece liked ✓              ← não reverteu
    → UI ≠ servidor

URL ≠ server state
    url: /doc/123?mode=edit
    server: doc 123 was deleted / permission revoked
    → carrega modo edit de recurso inacessível?

two-client divergence
    client A: edits resource, saves → server updated
    client B: still showing old version (no realtime/poll)
    → B edita sobre estado antigo, sobrescreve A

cache populated by A, invalidated by nobody
    service A writes cache on read (populate-on-miss)
    service B writes db directly, never invalidates cache
    → cache perpetuamente stale até TTL

in-memory server state across instances
    instance 1: local cache of "rate limit count"
    instance 2: separate local cache
    → limit bypassable by rotating instance (round-robin)
```

## Evidence Requirements

* **Nomear as duas camadas que discordam** e o fato específico.
* **Mostrar o estado em cada camada** (valor no banco vs valor no cache/cliente/URL).
* **Mostrar o mecanismo da divergência** — qual caminho de escrita não invalidou, qual
  lag, qual otimistic não revertido.
* **Escalar confiança:**
  * `CONFIRMED` — reproduziu e capturou os dois valores discordando (ex: resposta da
    API vs query no banco).
  * `HIGH CONFIDENCE` — código mostra invalidação ausente ou ordem errada, sem
    reprodução manual.
  * `POSSIBLE` — caminho plausível de desync, não confirmado.
  * `SPECULATIVE` — "pode ficar stale" sem rastrear o mecanismo.
* Desyncs que permitem **agir sobre estado errado** (gastar saldo stale) são mais
  graves que desyncs puramente visuais.

## False Positives

* **Stale visual aceitável** — alguns caches são *desenhados* para ser stale (ex:
  contagem de likes aproximada, eventual consistency por produto). Se o sistema
  tolera stale por design, não é bug. Marcar `POSSIBLE` e levantar como decisão de
  produto se duvidar.
* **Invalidação existe mas é assíncrona por design** — invalidação eventual dentro de
  uma janela documentada é aceitável; bug é só se a janela é indefinida ou não
  garantida.
* **URL é puramente de UI** — se a URL só controla view state (tab aberta) sem claims
  sobre dados, "URL ≠ servidor" não aplica.
* **Optimistic revert existe** — se há rollback no `onError`, não reportar. Confirmar
  a ausência antes.
* **Read replica com read-your-writes guarantee** — se a leitura pós-escrita vai ao
  primário (ou replica com lag < janela crítica), lag não é problema.

## Output Format

Para cada par de camadas que discorda com consequência, um finding via
`templates/audit-report.md`. Em **Affected component**, nomeie as camadas e o fato. Em
**Reproduction**, mostre a sequência (write → read) que produz a divergência e os dois
valores observados. Em **Root cause**, diga qual invalidação/ordem/lag/revert falta.
Em **Recommendation**, indique a estratégia (write-through, invalidação síncrona,
read-your-writes para o primário, rollback de optimistic, validação de URL no load).

Apresente um mapa de camadas por fato (fato | fonte de verdade | cópias | caminho de
invalidação | ✓/✗), marcando os desyncs. Desyncs que permitem agir sobre estado errado
primeiro; desyncs visuais depois.
