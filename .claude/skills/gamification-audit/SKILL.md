---
name: gamification-audit
description: Detects abuse of XP, points, coins, reputation, achievements, streaks, likes, reactions, and referrals using the TRIGGER → CONDITION → REWARD → REVERSAL model, including self-reward, multi-account, replay, concurrency, and automation.
user_invocable: true
---


# Gamification Audit

## Objective

Ensinar o agente a modelar qualquer sistema de gamificação como um **loop de
recompensa** e a procurar onde o loop pode ser manipulado para produzir recompensa sem
o comportamento que ele deveria incentivar:

```text
TRIGGER
   ↓
CONDITION
   ↓
REWARD
   ↓
REVERSAL
```

Abusos em foco (do `plan.md` §9): XP, pontos, moedas, reputação, achievements,
streaks, likes, reactions, referrals.

## When to Use

* Em qualquer sistema com recompensa (XP, pontos, moedas, reputação, achievements,
  streaks, likes, reactions, referrals, rank).
* Quando uma recompensa tem valor real (rank, desbloqueio, moeda, status) — o incentivo
  à fraude cresce com o valor.
* Quando o pedido menciona "gamification", "XP farming", "streak", "referral abuse",
  "reward loop", "self-reward", "multi-account".
* **Composição:** núcleo de produto. Pareia com `business-logic-audit` (regras de
  recompensa), `idempotency-audit` (recompensa duplicada), `race-condition-hunter`
  (farming concorrente), `api-abuse-audit` (recompensa via API direta),
  `input-trust-audit` (XP/reward do cliente), `user-flow-audit` (fluxo do loop).

## Mental Model

Um sistema de gamificação é uma **máquina que emite valor**. O eixo é o loop
TRIGGER → CONDITION → REWARD → REVERSAL: algo dispara, uma condição é checada, uma
recompensa é emitida, e (idealmente) há um caminho de reversão.

Todo loop é manipulável quando uma destas quatro falha:

1. **CONDITION frágil** — a condição que impede o abuso pode ser falsificada
   (self-reward, multi-account, automação).
2. **REWARD sem reversão** — a ação pode ser desfeita e refeita ganhando de novo sem
   perder o ganho anterior (farming infinito).
3. **REWARD não-idempotente** — o mesmo trigger disparado N vezes (replay, retry,
   concurrency) concede N vezes.
4. **TRIGGER fabricável** — o trigger pode ser gerado artificialmente (bot, request
   direto, referral de si mesmo).

O teste canônico (do `plan.md` §9):

```text
ACTION
→ REWARD
→ REVERSE
→ ACTION
→ REWARD     ← farming se a reward não foi removida na reversão
```

E os vetores de abuso:

```text
self-reward     — dar a recompensa a si mesmo quando deveria ser de outro
multi-account   — contas paralelas para colher recompensas por-referral/conta
replay          — repetir o trigger depois de já colhido
concurrency     — disparar o trigger simultaneamente N vezes
automation      — bots executando o comportamento "incentivado"
```

## Investigation Procedure

> **Shared knowledge:** for reward ledgers, reversals and quota abuse models,
> read `knowledge/product/rewards-and-ledgers.md`, `knowledge/product/reversals.md`
> and `knowledge/product/quotas-and-limits.md`.



1. **Mapear cada recompensa como um loop** TRIGGER → CONDITION → REWARD → REVERSAL.
   Liste o trigger (ação), a condição (quem/quando), a reward (quantidade, como
   emitida), e a reversão (existe? remove a reward?).
2. **Para cada loop, aplicar o teste ACTION → REWARD → REVERSE → ACTION → REWARD.**
   A segunda ACTION concede de novo? Se sim, farming.
3. **Testar os vetores:**
   * **self-reward** — posso conceder a mim mesmo (reagir ao meu post, votar em mim)?
   * **multi-account** — posso criar contas paralelas e referir a mim mesmo?
   * **replay** — posso repetir o trigger após colhido (mesma ação, mesma entidade)?
   * **concurrency** — disparar o trigger N vezes simultâneas — N rewards?
   * **automation** — um bot consegue gerar o trigger artificialmente (não há
     proof-of-human / rate limit / captcha)?
4. **Verificar a reversão** — quando a ação é desfeita, a reward é removida de fato?
   (senão: reverse → action → reward = farming)
5. **Verificar idempotência da reward** — a mesma entidade × mesma ação é protegida por
   unique/check server-side? (dedup)
6. **Verificar a fonte da reward** — é calculada server-side pelo evento, ou confiável
   no payload? (input trust overlap)
7. **Confirmar com evidência** — reproduza o farming e observe a reward dupla.
8. **Reportar** via `templates/audit-report.md`.

## Questions to Ask

* Qual o loop completo de cada recompensa? TRIGGER → CONDITION → REWARD → REVERSAL?
* ACTION → REWARD → REVERSE → ACTION → REWARD: a segunda ACTION concede de novo?
* Self-reward é possível (reagir/curtir/votar no próprio conteúdo)?
* Multi-account pode colher reward por-conta (referral, bônus de novo usuário)?
* O mesmo trigger repetido (replay) concede de novo?
* N requests simultâneos para o mesmo trigger — N rewards?
* Um bot pode gerar o trigger artificialmente? (rate limit? captcha? assinatura?)
* A reversão (unreact, cancel referral) realmente remove a reward?
* A reward é determinada server-side ou aceita do cliente?
* A mesma (entidade, ação) é deduplicada por unique constraint?

## Attack Patterns

```text
farming infinito (reversal ausente)
    react → +10 XP
    unreact → -0 XP (reversão não remove!)
    react → +10 XP   ← farming: XP acumula sem limite por uma única ação

reversal que re-concede
    react → +10 XP
    unreact → -10 XP
    react → +10 XP   ← correto SE unreact removeu de fato. Testar se removou.

self-reward
    react no próprio post → +XP? (deveria ser proibido ou sem reward)
    vote em si mesmo → reputation?

multi-account referral
    criar conta B (via referral de A) → A ganha bônus
    repetir com B, C, D... → A ganha N bônus
    (defesa: restrição por IP/device/unique identidade — contornável?)

replay
    completar streak hoje → reward
    repetir o request do streak → reward de novo?
    (defesa: unique (user, day) no banco)

concurrency farming
    N requests simultâneos para /claim-streak
    todos passam a checagem read-then-write → N rewards
    (defesa: unique constraint, lock, ou idempotency key)

automation
    bot gera o "comportamento incentivado" artificialmente
    (se o reward exige comportamento humano e não há prova, a economia infla)

like/reaction abuse
    curtir/descurtir repetidamente para manter "engajamento"
    (se cada curti dá algo, o toggle é farming)

achievement farm
    condição de achievement forjável (ex: "compartilhe" sem share real)
    → achievement concedido sem o comportamento real
```

## Evidence Requirements

* **Mapear o loop completo** da recompensa (TRIGGER → CONDITION → REWARD → REVERSAL)
  no finding.
* **Nomear o vetor de abuso** (farming/reversal/self/multi-account/replay/concurrency/
  automation) e a fase do loop que falha (condição frágil, reversão ausente, reward
  não-idempotente, trigger fabricável).
* **Mostrar o mecanismo** — onde a condição é checada (server-side? só na UI?),
  onde a reversão não remove, onde o dedup falta.
* **Escalar confiança:**
  * `CONFIRMED` — reproduziu a recompensa dupla/injusta (ACTION→REWARD→REVERSE→
    ACTION→REWARD observado).
  * `HIGH CONFIDENCE` — código mostra condição frágil / reversão ausente em loop de
    reward claro.
  * `POSSIBLE` — loop plausivelmente manipulável, não confirmado.
  * `SPECULATIVE` — "pode ser farmável" sem rastrear o loop.
* Farming que infla economia com valor real (moeda/rank) = mínimo `HIGH CONFIDENCE`
  se o loop for claro.

## False Positives

* **Reversão correta** — se unreact remove a XP de fato (e é idempotente), o teste
  ACTION→REWARD→REVERSE→ACTION não concede de novo. Confirmar a remoção real.
* **Dedup por (entidade, ação)** — se há unique constraint server-side, replay e
  concurrency não concedem de novo. Confirmar antes de reportar.
* **Self-reward proibido e enforced** — se o servidor rejeita reagir ao próprio
  conteúdo, não há self-reward. Confirmar no handler.
* **Multi-account é risco de negócio aceito** — alguns produtos toleram (sem valor
  real). Marcar `POSSIBLE` se o valor da reward não justifica a defesa.
* **Rate limit/anti-bot suficiente** — se bot é barrado por rate limit + captcha +
  assinatura, automation é mitigado. Confirmar a barreira antes de reportar.
* **Reward é cosmética** — se XP não compra nada e não afeta rank, o farming é
  cosmetic; reportar com severidade baixa ou como nota de produto.
* **Streak com janela intencional** — reset diário é o design; não é bug.

## Output Format

Para cada loop manipulável, um finding via `templates/audit-report.md`. Em
**Affected flow**, nomeie a recompensa e o vetor. Em **Reproduction**, dê a sequência
concreta (ACTION→REWARD→REVERSE→ACTION ou os N requests) e o saldo final observado. Em
**Root cause**, diga qual fase do loop falha (condição frágil / reversão ausente /
reward não-idempotente / trigger fabricável). Em **Recommendation**, indique a defesa
(unique constraint por entidade+ação+janela; reversão que remove de fato; restrição de
self; rate limit + anti-bot; cálculo server-side da reward).

Apresente a tabela por recompensa (reward | trigger | condição | reversão? | dedup? |
vetor vulnerável | ✓/✗). Farming infinito e abuso com valor real primeiro; self-reward
e multi-account depois; automation e replay em seguida.
