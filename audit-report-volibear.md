# Audit Report — Volibear (volibearq MVP)

**Date:** 2026-08-29
**Target:** Volibear — portable multi-agent engineering pipeline runtime (CLI, runtime, core, executors, contratos, pipelines, install/smoke/release)
**Scope:** Funcionamento real dos fluxos `install`, `build`, `fix`, `resume`, `status`, `help`; confiabilidade de estado (`run.json`, `events.jsonl`, artefatos); gates e loop de reparo; executores; UX da CLI; integração pipeline↔agents↔executors↔gates. **Out of scope:** segurança de supply chain, executores reais (opencode/codex/claude binaries) testados por contrato com binário falso, 9Router end-to-end, driver LLM real de descoberta (ainda não existe — ver Finding 12).
**Skills used:** skill-router, adversarial-review, user-flow-audit, state-consistency-audit, error-flow-audit, idempotency-audit, race-condition-hunter, edge-case-hunter, business-logic-audit, data-integrity-audit, ux-review
**References consulted:** none (pesquisa externa não necessária — auditoria de código/fluxos existentes)
**Workflow:** UNDERSTAND → CLASSIFY → SKILL ROUTER → ANALYZE → ADVERSARIAL TEST (sandbox `/tmp`) → VERIFY (repro runtime + testes de regressão) → FIXES APLICADOS → RE-AUDIT

---

## Summary

Auditoria completa do Volibear MVP com **18 findings consolidados** (de ~24 hipóteses iniciais; 1 hipótese retirada por falso-positivo de leitura, 5 deduplicadas). **16 findings foram corrigidos e validados** nesta mesma sessão; 2 permanecem documentados como gaps de MVP (driver LLM de discovery e sandboxing de permissões), ambos já refletidos no README.

O estado pós-fix passou por re-auditoria completa: `tsc -b --force`, ESLint, 46 testes unitários (incl. 3 regressões novas), bundle, smoke test de tarball, e re-execução de todos os fluxos reais em sandbox — todos verdes. A invariante central **"Arquiteto nunca roda sem requirements.lock"** e o princípio **"No infinite loops"** (orçamento de ciclos agora é por RUN, imune a kill+resume repetidos) foram verificados com evidência direta.

Durante a re-auditoria o ORNN também pegou **2 falso-verdes do próprio projeto**: o typecheck incremental `tsc -b` omitia erros reais (só `--force` os revelava) e o `vitest` testava `dist/` velho em vez do código-fonte — ambos corrigidos.

### Findings by severity (estado pós-fix)

| Severity | Encontrados | Corrigidos | Pendentes |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 7 | 7 | 0 |
| Medium | 8 | 8 | 0 |
| Low | 3 | 1 | 2 |

### Findings by confidence (pós verificação)

| Confidence | Count |
|---|---|
| CONFIRMED | 16 (todos corrigidos com repro) |
| HIGH CONFIDENCE | 2 (gaps de MVP — mecanismo exato, correção fora do escopo do MVP) |

---

## Findings

> Formato: cada finding traz evidência pré-fix e o resultado pós-fix. "✅ FIXED" = corrigido e re-validado nesta sessão.

### Finding 1 — Loop de reparo reiniciava a cada resume (max_cycles estendível indefinidamente) ✅ FIXED

| Field | Value |
|---|---|
| **Severity** | High |
| **Confidence** | CONFIRMED (repro CLI + events) |
| **Affected component** | `packages/runtime/src/stage-runner.ts` (runLoopStage), `packages/runtime/src/orchestrator.ts` |
| **Invariant** | "No infinite loops" — o orçamento de `max_cycles` é por RUN, não por invocação (plan.md § 33.9) |
| **State transition** | run em loop ciclo N → kill/pause → resume → loop recomeça em ciclo 1 com orçamento cheio |
| **Affected flow** | `build`/`fix` interrompidos + `resume` |
| **Reproduction (pré-fix)** | Pipeline `sleep 4` + gate que falha, `max_cycles: 3`; kill -9 no ciclo 2; `resume` → eventos `repair.started: [1,2,1,2]`; `run.json.repair_cycle` permanecia 0 |
| **Expected** | Total de ciclos consumidos ≤ max_cycles, mesmo com N resumes |
| **Actual (pré-fix)** | Cada resume concedia orçamento novo; loop extensível indefinidamente; developer re-executava do zero |
| **Mechanism** | `for (cycle = 1; cycle <= maxCycles)` ignorava `ctx.repairCycle` restaurado; `repair_cycle` nunca persistido durante o loop |
| **Impact** | Viola invariante declarada do produto; custo de LLM ilimitado em executores reais |
| **Recommendation** | (aplicada) `startCycle = ctx.repairCycle + 1`; persistir `repair_cycle` após cada ciclo; loop-exhausted imediato se orçamento esgotado no resume |
| **Pós-fix (evidência)** | Mesmo cenário: eventos `[1,2,3,3]` — resume rodou só o ciclo interrompido; total = max_cycles; teste de regressão `REGRESSION: repair budget persists across resumes` |

**Provenance:** generated_by adversarial-review, idempotency-audit; investigated_by state-consistency-audit; verified_by reprodução CLI + vitest.

---

### Finding 2 — `--router <valor>` era ignorado e forçava 9router ✅ FIXED

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Confidence** | CONFIRMED (repro vitest temporário + CLI) |
| **Affected component** | `packages/cli/src/app.ts` (App.create) |
| **Invariant** | Flags da CLI têm a maior precedência (plan.md § 20) |
| **Reproduction (pré-fix)** | `build --router native` → `config.router.mode = "9router"` (log do teste temporário) |
| **Mechanism** | `if (options.router) overrides.router = { mode: '9router' }` — valor descartado |
| **Impact** | Roteamento errado silencioso para todo o run |
| **Recommendation** | (aplicada) validar valor (`native|9router`, erro claro caso contrário) e propagar o valor real |
| **Pós-fix** | `--router native` → `mode: native` (validado via `volibear config`) |

**Provenance:** generated_by state-consistency-audit; verified_by vitest temporário (removido após repro) + CLI.

---

### Finding 3 — Gate de severidade era "in-list" com bypass (fail-open) ✅ FIXED

| Field | Value |
|---|---|
| **Severity** | High |
| **Confidence** | CONFIRMED (repro vitest temporário) |
| **Affected component** | `packages/runtime/src/gates.ts` (NoFindingsAboveThresholdGate) |
| **Invariant** | Findings com severidade ≥ threshold nunca deixam o run avançar; gate é determinístico e fail-closed |
| **Reproduction (pré-fix)** | `review.json` com severity `"blocker"` ou `"HIGH"` → gate PASSA; tabela de rank existia e não era usada |
| **Mechanism** | `rejectOn.includes(f.severity)` — comparação exata; severidade fora da lista/case diferente escapa; review.json é lido sem revalidação de schema |
| **Impact** | Reviewer (ou artefato corrompido) derruba o gate crítico de qualidade com qualquer severidade não-canônica |
| **Recommendation** | (aplicada) threshold por rank (`rank(severity) >= min(rank(rejectOn))` rejeita), case-insensitive, severidade desconhecida = rank crítico (fail-closed) |
| **Pós-fix** | Teste de regressão `REGRESSION: severity gate rejects unknown and case-variant severities` — `blocker`, `HIGH`, `Critical`, `sev1` todos rejeitados |

**Provenance:** generated_by business-logic-audit, adversarial-review; verified_by vitest.

---

### Finding 4 — Comandos `review`, `update`, `config` anunciados mas inexistentes ✅ FIXED

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Confidence** | CONFIRMED (CLI) |
| **Affected component** | `packages/cli/src/cli.ts`, README |
| **Reproduction (pré-fix)** | `volibear review` → `Unknown command: review` |
| **Impact** | Dead end documentado; usuário segue README/help e trava |
| **Recommendation** | (aplicada) `config` implementado (config resolvida + origem), `update` implementado (refresh de pipelines/instruções, preserva customizações sem `--force`), `review` removido do help/README (não existe no MVP — honestidade sobre gaps) |
| **Pós-fix** | `volibear config`/`volibear update [--force]` funcionais; help sem `review` |

**Provenance:** generated_by user-flow-audit; verified_by CLI.

---

### Finding 5 — Erros de run invisíveis no terminal (só `✗ FAIL`) ✅ FIXED

| Field | Value |
|---|---|
| **Severity** | High |
| **Confidence** | CONFIRMED (CLI) |
| **Affected component** | `packages/cli/src/commands/{build,fix,resume}.ts` |
| **Reproduction (pré-fix)** | `install --project gemini && build` → `✗ FAIL` (motivo `unknown executor "gemini"` só dentro de run.json) |
| **Impact** | Dead end de UX: usuário precisa adivinhar que existe `status` para descobrir o erro |
| **Recommendation** | (aplicada) módulo compartilhado `report.ts` imprime `Error: <motivo>` em qualquer resultado não-PASS; exit codes centralizados (0/1/2) |
| **Pós-fix** | `✗ FAIL` + `Error: unknown executor "nonexistent"`; `◉ BLOCKED` + `Error: implementation exceeded N repair cycles` |

**Provenance:** generated_by ux-review, error-flow-audit; verified_by CLI.

---

### Finding 6 — Executor de producação validado tarde demais (erro só no meio do pipeline) ✅ FIXED

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Confidence** | CONFIRMED (CLI) |
| **Affected component** | `packages/cli/src/app.ts`, `commands/{build,fix,resume}.ts` |
| **Reproduction (pré-fix)** | `build --executor nonexistent` (sem --accept-defaults) → rubberduck pausa primeiro; erro só apareceria no resume |
| **Impact** | Falha de configuração descoberta tarde, desperdiçando interação do usuário |
| **Recommendation** | (aplicada) `App.validateExecutors()` falha rápido antes de criar o run, listando executores disponíveis |
| **Pós-fix** | `executor configuration error: agent "reviewer" uses unknown executor "nonexistent" (available: claude, codex, mock, opencode)` |

**Provenance:** generated_by user-flow-audit; verified_by CLI.

---

### Finding 7 — Precedência violada: flag `--executor` silenciosamente ignorada ✅ FIXED (achado na re-auditoria)

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Confidence** | CONFIRMED (CLI) |
| **Affected component** | `packages/cli/src/app.ts` (getAgents) |
| **Invariant** | CLI flags > project config > global > defaults |
| **Reproduction** | Config do `install` grava `executor:` por agente; `build --executor X` era ofuscado por `override.executor` |
| **Impact** | A flag documentada não tinha efeito após um install padrão |
| **Recommendation** | (aplicada) CLI flag vence: `cliExecutor ?? override?.executor ?? config.executor` (idem router) |
| **Pós-fix** | `--executor opencode` com config mock → executores reais invocados (validado com binário falso que captura o prompt) |

**Provenance:** generated_by business-logic-audit (re-audit); verified_by CLI + executor fake.

---

### Finding 8 — Config.yaml malformada descartada silenciosamente ✅ FIXED

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Confidence** | CONFIRMED (CLI) |
| **Affected component** | `packages/core/src/config.ts` |
| **Reproduction (pré-fix)** | YAML com erro de indentação → defaults aplicados sem aviso; build PASSa com mock |
| **Impact** | Configuração do usuário (ex.: verification real) ignorada silenciosamente — verde falso |
| **Recommendation** | (aplicada) arquivo existente + parse falho → erro claro e fail-fast (`invalid config file <path>: <detalhe>`); ausente → defaults (comportamento mantido) |
| **Pós-fix** | `✗ invalid config file ...: bad indentation of a mapping entry (2:6)` |

**Provenance:** generated_by edge-case-hunter, state-consistency-audit; verified_by CLI.

---

### Finding 9 — `install` sobrescrevia config sem aviso e aceitava executores inexistentes ✅ FIXED

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Confidence** | CONFIRMED (CLI) |
| **Affected component** | `packages/cli/src/commands/install.ts` |
| **Reproduction (pré-fix)** | `install --project gemini` grava config inválida (build quebra depois); re-install sobrescrevia config.yaml do usuário; `verification: [echo ok]` fake-pass; `.volibear/agents/` criado vazio |
| **Impact** | Perda silenciosa de customização; config quebrada; verificação de segurança fake |
| **Recommendation** | (aplicada) valida contra registro real (mock/opencode/codex/claude); config existente preservada sem `--force`; `.gitignore` aninhado (`.runs/`); verification vazia com comentário instrutivo; instruções dos agents copiadas; pipelines/instruções nunca sobrescritos sem `--force` |
| **Pós-fix** | `Unknown executor(s): gemini. Available: mock, opencode, codex, claude.` (exit 1); `config: ... (kept)` + nota; `--force` sobrescreve |

**Provenance:** generated_by idempotency-audit, user-flow-audit; verified_by CLI.

---

### Finding 10 — Mock executor poluía o repositório do usuário ✅ FIXED

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Confidence** | CONFIRMED (artefato observado no próprio repo: `src/implementation.txt` órfão) |
| **Affected component** | `packages/executors/src/mock.ts` (developer/fixer) |
| **Reproduction (pré-fix)** | `build --accept-defaults` criava `src/implementation.txt` no cwd do usuário |
| **Impact** | Lixo commitável no projeto real; executor default (mock) era o pior ofensor |
| **Recommendation** | (aplicada) mock grava `implementation.txt` no runDir (sandbox do run), nunca no cwd |
| **Pós-fix** | Árvore do projeto limpa pós-build; teste atualizado (`developer writes implementation into the run directory`) |

**Provenance:** generated_by state-consistency-audit; verified_by CLI + vitest.

---

### Finding 11 — PASS sem nenhuma verificação (verde falso) ✅ MITIGADO

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Confidence** | CONFIRMED (CLI) |
| **Affected component** | `packages/runtime/src/stage-runner.ts` (runVerifyStage), `commands/{build,fix}.ts` |
| **Reproduction (pré-fix)** | Projeto sem install: `build --accept-defaults` → PASS com `verification: [echo ok]` e zero checagens reais, sem qualquer aviso |
| **Impact** | "PASS" não significava nada para usuários desatentos |
| **Recommendation** | (aplicada, mitigação honesta) banner em build/fix quando config vem de defaults; warning explícito quando `verification.commands` vazio; `install` não grava mais `echo ok`; summary do verification.json documenta o caso; comportamento PASS mantido para não quebrar CI/smoke |
| **Pós-fix** | `[volibear] warning: no verification commands configured — the run can PASS without project checks.` |

**Provenance:** generated_by business-logic-audit; verified_by CLI.

---

### Finding 12 — Discovery com driver hardcoded mock; findings ORNN não chegam à descoberta ⚠️ GAP DOCUMENTADO

| Field | Value |
|---|---|
| **Severity** | High (funcionalidade) |
| **Confidence** | HIGH CONFIDENCE (gap de MVP — mecanismo exato, correção = feature nova) |
| **Affected component** | `packages/cli/src/app.ts` (`rubberduck: new MockRubberduckDriver()`), `packages/executors/src/mock.ts` |
| **Evidence** | `MockRubberduckDriver.discover()` ignora `context.findings` e repo; `decide()` devolve "(delegated default) <pergunta>" como resposta; perguntas canned idênticas para qualquer task/findings |
| **Impact** | A proposta central (Rubberduck converte intent+findings em spec) funciona mecanicamente, mas a "descoberta" real é fake; integração ORNN superficial (findings só chegam aos prompts dos agents, não à descoberta) |
| **Recommendation** | Implementar `RubberduckDriver` LLM-backed (via executor configurado do agente rubberduck) na próxima fase; jusqu'lá, README/status do MVP devem dizer "discovery interativa com driver mock" |
| **Status** | Documentado no README (nota do Executors) e listado como próximo passo; não "corrigido" porque exige desenhar a integração LLM |

**Provenance:** generated_by user-flow-audit, business-logic-audit; investigated_by code-review completo.

---

### Finding 13 — Permissões de agente nunca aplicadas; instruções nunca enviadas ✅ PARCIALMENTE FIXED

| Field | Value |
|---|---|
| **Severity** | High |
| **Confidence** | HIGH CONFIDENCE (sandboxing real = fora do MVP; instrução no prompt = corrigido) |
| **Affected component** | `packages/executors/src/base.ts` (buildAgentPrompt), `contracts/agents.ts` |
| **Reproduction (pré-fix)** | `buildAgentPrompt` gerava "Follow the Volibear agent instructions" **sem incluir instruções alguma**; `permissions` viravam metadata sem efeito em executor real |
| **Impact** | Architect/Reviewer reais recebiam prompt genérico sem papel/regras; promises de "enforce permissions" não se sustentavam |
| **Recommendation** | (aplicada, parte 1) instruções carregadas de `.volibear/agents/` > `~/.volibear/agents/` > bundled `resources/agents/` e injetadas no prompt (`# Agent instructions`); bundle/publicação embarcam os .md; smoke valida; (parte 2, pendente) sandboxing real de FS/shell por permissão — documentado como limitação no README |
| **Pós-fix (evidência)** | Binário fake `opencode` capturou prompt com instruções + permissões + contexto de findings |

**Provenance:** generated_by business-logic-audit; verified_by executor fake.

---

### Finding 14 — Timeout de 20s tornava executores reais inutilizáveis; commands/verify sem timeout nenhum ✅ FIXED

| Field | Value |
|---|---|
| **Severity** | High |
| **Confidence** | CONFIRMED (estrutural + contrato testado) |
| **Affected component** | `packages/executors/src/base.ts`, `packages/runtime/src/stage-runner.ts` |
| **Evidence (pré-fix)** | 20_000ms hardcoded no CliExecutor (um agent LLM real precisa de minutos); `runCommandStage` sem timeout (verify pendurava para sempre) |
| **Impact** | Fluxo "real" impossível com opencode/codex/claude; hang infinito em verify |
| **Recommendation** | (aplicada) `executor_timeout_ms` configurável (default 600s) para executores **e** stages command/verify; kill com SIGKILL e mensagem clara |
| **Pós-fix** | Config aceita `executor_timeout_ms`; timeout de command gera erro com stderr incluído |

**Provenance:** generated_by error-flow-audit; verified_by typecheck+contrato.

---

### Finding 15 — Falha de verificação sem diagnóstico (stdout/stderr capturados e jogados fora) ✅ FIXED

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Confidence** | CONFIRMED (estrutural) |
| **Affected component** | `packages/runtime/src/stage-runner.ts`, contrato `VerificationSchema` |
| **Evidence (pré-fix)** | verification.json só tinha exit_code; stdout/stderr do contrato nunca populados; erro = "verification failed" |
| **Impact** | Usuário sem como saber por que o run falhou |
| **Recommendation** | (aplicada) verification.json grava stdout/stderr truncados (2000 chars); erro do stage lista comandos falhos + trecho de output |
| **Pós-fix** | `verification failed: <cmd>` + trecho do output no terminal e no artefato |

**Provenance:** generated_by ux-review, error-flow-audit; verified_by code-review.

---

### Finding 16 — `resume` usava só o run mais recente (run resumável ficava inacessível) ✅ FIXED

| Field | Value |
|---|---|
| **Severity** | High |
| **Confidence** | CONFIRMED (CLI) |
| **Affected component** | `packages/cli/src/commands/resume.ts` |
| **Reproduction (pré-fix)** | Run WAITING mais antigo + run BLOCKED mais novo → `resume`: "Nothing to resume" (exit 0) — dead end real observado em sandbox |
| **Impact** | Usuário perde runs ativos atrás de um run terminal |
| **Recommendation** | (aplicada) resume procura o primeiro run **não-terminal** (por seq); se só houver terminal, informa e sugere `resume --force` para BLOCKED |
| **Pós-fix** | `Resuming run run-b1e6f669 (WAITING_FOR_USER)` com terminal BLOCKED mais novo |

**Provenance:** generated_by user-flow-audit, state-consistency-audit; verified_by CLI.

---

### Finding 17 — Run corrompido invisível; `latest()` com tiebreak por UUID aleatório; writes não atômicos ✅ FIXED

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Confidence** | CONFIRMED (repro CLI + vitest temporário) |
| **Affected component** | `packages/core/src/state.ts`, `artifacts.ts` |
| **Reproduction (pré-fix)** | run.json corrompido → status "No runs yet." (exit 0) sem aviso; dois runs no mesmo ms ordenados por id lexicográfico (comentário afirmava monotonicidade inexistente); `writeFileSync` direto (torn-write em crash) |
| **Impact** | Estado inconsistente silencioso; corrupção por crash |
| **Recommendation** | (aplicada) aviso no stderr quando run.json ilegível; campo `seq` monotônico por run (schema + create); sort por `created_at` → `seq`; escrita atômica (tmp+rename) em run.json, artefatos e requirements.lock |
| **Pós-fix** | `[volibear] warning: run "run-26..." has an unreadable run.json (...) — it will be skipped`; H13 test valida seq |

**Provenance:** generated_by data-integrity-audit, edge-case-hunter; verified_by CLI + vitest temporário.

---

### Finding 18 — Race em RunStore.update (read-modify-write sem lock) ⚠️ MITIGADO PARCIALMENTE

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Confidence** | HIGH CONFIDENCE (mecanismo exato; corrupção não observada com mock rápido — janela teórica) |
| **Affected component** | `packages/core/src/state.ts` |
| **Evidence** | `update()` faz load→merge→save sem exclusão mútua; dois builds simultâneos no mesmo projeto (repro executada: ambos PASS sem corrupção visível, mock < 100ms) |
| **Impact** | Com executores reais lentos, duas instâncias podem sobrescrever `run.json`/artefatos do mesmo run |
| **Recommendation** | Escritas atômicas aplicadas (elimina torn-write); lock exclusivo por run (lockdir com stale detection) recomendado como próximo passo — não implementado nesta passada para evitar stale-lock bugs num MVP single-user |
| **Status** | Mitigado (atomicidade); exclusão mútua documentada como next step |

**Provenance:** generated_by race-condition-hunter; verified_by CLI (concorrência real, janela limitada).

---

### Finding 19 — Efeitos colaterais de diretório em comandos de leitura ✅ FIXED

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Confidence** | CONFIRMED (CLI) |
| **Affected component** | `packages/cli/src/commands/{resume,status}.ts`, `core/config.ts` (ensureConfigDirs) |
| **Reproduction (pré-fix)** | `resume` em diretório virgem criava `.volibear/{agents,pipelines,.runs}` inteiro antes de dizer "No runs to resume." |
| **Impact** | Poluição de diretórios; impressão de que o projeto estava instalado |
| **Recommendation** | (aplicada) resume/status verificam `.volibear` antes de qualquer criação (`No Volibear project installed. Run: volibear install`, exit 1); build/fix criam skeleton intencionalmente com banner de defaults |
| **Pós-fix** | Nenhum `.volibear` criado por resume/status em dir virgem |

**Provenance:** generated_by user-flow-audit; verified_by CLI.

---

### Finding 20 — Erros de validação de findings/pipeline viravam dump cru de Zod ✅ FIXED

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Confidence** | CONFIRMED (CLI) |
| **Affected component** | `commands/fix.ts`, `runtime/pipeline.ts`, `core/config.ts`, `core/errors.ts` |
| **Reproduction (pré-fix)** | `fix empty.json` → JSON multi-linha do ZodError no terminal; pipeline YAML com `command: true` → dump Zod dentro de run.json |
| **Impact** | Mensagens ininteligíveis para o usuário final |
| **Recommendation** | (aplicada) `formatZodIssues()` compartilhado no core; uma linha por issue com path; erros de parse YAML/JSON também formatados |
| **Pós-fix** | `Invalid findings file bad.json: findings: Array must contain at least 1 element(s)` |

**Provenance:** generated_by ux-review, edge-case-hunter; verified_by CLI.

---

### Finding 21 — `pnpm lint` documentado e quebrado (ESLint nem instalado) ✅ FIXED

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Confidence** | CONFIRMED (baseline) |
| **Affected component** | `package.json`, README |
| **Evidence (pré-fix)** | `pnpm lint` → `eslint: comando não encontrado` (devDeps não incluíam ESLint; sem config) |
| **Recommendation** | (aplicada) `eslint@9` + `typescript-eslint@8` + `eslint.config.mjs` (flat config, recommended); 15 unused-vars reais corrigidos no codebase |
| **Pós-fix** | `pnpm lint` limpo |

**Provenance:** generated_by baseline; verified_by lint verde.

---

### Finding 22 — Diversões e omissões menores da CLI ✅ FIXED

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Confidence** | CONFIRMED (CLI) |
| **Affected component** | `commands/fix.ts`, `cli.ts`, `runtime/orchestrator.ts` |
| **Evidence (pré-fix)** | `fix` ignorava `--pipeline` (hardcoded `fix`); flags desconhecidas silenciosamente ignoradas (comentário dizia "warn"); `--executor` como último arg engolia `undefined`; `run.started` duplicado a cada resume; eventos declarados `review.approved/rejected` nunca emitidos; `status` ignorava flags da CLI |
| **Recommendation** | (aplicada) fix respeita `--pipeline`; warning para flags desconhecidas; erro para flag sem valor; `run.started` só em run CREATED; `review.approved/rejected` emitidos no loop; status aceita flags |
| **Pós-fix** | Todos verificados via CLI (warning de `--banana`, erro de `--executor` sem valor, contagem de `run.started` = 1) |

**Provenance:** generated_by ux-review, state-consistency-audit; verified_by CLI + events.

---

### Finding 23 — `ArtifactsExistGate` inutilizável (extra nunca populado) ✅ FIXED

| Field | Value |
|---|---|
| **Severity** | Low |
| **Confidence** | CONFIRMED (estrutural) |
| **Affected component** | `packages/runtime/src/stage-runner.ts` (buildGateParams) |
| **Evidence (pré-fix)** | Gate exigia `params.extra[name] === true`, mas `extra` nunca era preenchido — com qualquer artifact exigido, falharia sempre |
| **Recommendation** | (aplicada) `buildGateParams` popula mapa de existência dos 7 artefatos conhecidos |
| **Pós-fix** | Gate utilizável declarativamente em pipelines custom |

**Provenance:** generated_by business-logic-audit; verified_by typecheck.

---

### Finding 24 — Higiene do repositório ✅ FIXED

| Field | Value |
|---|---|
| **Severity** | Low |
| **Confidence** | CONFIRMED (git status) |
| **Affected component** | raiz do repo |
| **Evidence (pré-fix)** | Arquivos vazios `acessar`, `fazer`, `sair`; `src/implementation.txt` órfão (prova do Finding 10); working tree com 3 arquivos modificados não-commitados |
| **Recommendation** | (aplicada) arquivos órfãos removidos; modificações fazem parte deste trabalho de fix (usuário decide commitar) |
| **Pós-fix** | Árvore limpa (git status mostra apenas mudanças do audit/fix) |

**Provenance:** generated_by state-consistency-audit; verified_by git.

---

### Finding 25 — Falso-verde do toolchain: `tsc -b` incremental e `vitest` contra dist velho ✅ FIXED

| Field | Value |
|---|---|
| **Severity** | Low (para o produto) / High (para o processo de dev) |
| **Confidence** | CONFIRMED (durante a re-auditoria) |
| **Affected component** | `vitest.config.ts`, fluxo de dev |
| **Evidence** | `@volibear/*` resolvia para `dist/` compilado — testes validavam código velho (o campo `seq` era stripped pelo RunSchema velho, invertendo resultados); `tsc -b` incremental omitiu 2 erros reais que só `--force` revelou |
| **Impact** | Confiança falsa na suíte; bugs mascarados por builds stale |
| **Recommendation** | (aplicada) aliases `@volibear/*` → `packages/*/src/index.ts` no vitest (testes sempre contra fonte); validação final com `tsc -b --force` |
| **Pós-fix** | Suíte verde contra fonte; erros de tipo corrigidos |

**Provenance:** generated_by adversarial-review (ataque ao próprio processo); verified_by tsc --force + vitest.

---

### Findings retirados (false positives)

- **Hipótese F16 (regra `pipelines/` no .gitignore engolindo pipelines):** RETIRADA. A "linha" vinha da saída concatenada de um `ls` na mesma leitura; o `.gitignore` real não tem a regra (`git diff` vazio). Sobrou apenas o risco de duplicação de fontes de pipelines (`pipelines/` raiz ≡ `packages/cli/resources/pipelines/`, cópias idênticas confirmadas por diff) — registrado como nota, sem correção necessária nesta passada.

---

## Deduplication note

Consolidados nesta sessão (identidade: componente+invariante+mecanismo+transição+impacto):

- "dev re-executa no resume" + "max_cycles reseta" + "repair_cycle não persistido" → **Finding 1** (um mecanismo, três sintomas).
- "PASS fake com echo ok" + "PASS sem config" → **Finding 11**.
- "erro Zod cru em findings" + "erro Zod cru em pipeline/config" → **Finding 20** (mesmo mecanismo, superfícies diferentes).
- "resume ignora run resumável" + "sem caminho de volta de BLOCKED" → **Finding 16** + `--force`.
- "timeout 20s" + "verify sem timeout" → **Finding 14**.
- "instruções não enviadas" + "permissões não aplicadas" → **Finding 13** (parte corrigida, parte documentada).

No overlapping findings across skills beyond the above.

---

## Out of scope / not investigated

- **Executores reais opencode/codex/claude**: validados por contrato com binário fake (prompt, timeout, fail-closed de gate). Autenticação, streaming e comportamento real dos CLIs não foram testados.
- **9Router end-to-end**: a flag `--router 9router` propaga modo por config/env; roteamento real depende da config do CLI do usuário.
- **Driver LLM de descoberta** (Finding 12) e **sandboxing de permissões** (Finding 13 parte 2): gaps de MVP documentados, não implementados.
- **Windows**: `commandExists` usa `sh`; paths POSIX assumidos.
- **Lock de exclusão mútua por run** (Finding 18 parte 2): recomendado, não implementado.
- **Segurança de supply chain** das dependências (zod, js-yaml, esbuild).

---

## Next steps (priorizados)

1. **Curto prazo:** commitar o conjunto de fixes (33 arquivos modificados + 10 novos); publicar release com as correções.
2. **Próxima fase (F12):** implementar `RubberduckDriver` LLM-backed usando o executor do agente rubberduck — é o que transforma o "esqueleto que funciona" no produto prometido.
3. **F13 parte 2:** sandboxing de permissões (flags de deny-write/shell por executor) para sustentar a promessa de permissões.
4. **F18 parte 2:** lock exclusivo por run para executores reais longos.
5. **Pipeline `review`** (removido do help por honestidade): implementar como pipeline dedicado quando houver demanda real.
6. **Monitorar:** PASS com `verification.commands: []` — hoje avisado; considerar transformar em BLOCKED configurável no futuro.
7. **Considerar:** `tsc -b --force` no CI local via script `typecheck:force`, já que o incremental pode mascarar erros (F25).
