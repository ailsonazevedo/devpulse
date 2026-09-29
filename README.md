# DevPulse

Feed e heatmap **unificados** das suas contribuições de dev em vários serviços
(GitHub, GitLab e, no futuro, Bitbucket/Gitea). Cada dev cria uma conta, conecta
suas contas dos provedores (via **OAuth** ou **Personal Access Token**, inclusive
instâncias **self-hosted**) e vê tudo agregado num só lugar.

## Arquitetura

Monorepo pnpm com dois processos que compartilham `packages/core`:

```
apps/web        Next.js (App Router): UI + API (auth, conexões, OAuth)
apps/worker     Consumidor BullMQ: backfill + sync incremental
packages/core   Prisma, adapters (GitHub/GitLab), cripto, filas, ingestão
```

- **PostgreSQL** guarda usuários, conexões (tokens **cifrados** AES-256-GCM),
  atividades normalizadas e os rollups diários (`DailyContribution`).
- **Redis + BullMQ** orquestram a sincronização assíncrona.
- **Adapter Pattern** isola cada provedor — adicionar um novo = um arquivo em
  `packages/core/src/adapters` + entrada no registry.

## Setup

Requisitos: Node ≥ 20, pnpm, Docker.

```bash
pnpm install
cp .env.example .env            # gere AUTH_SECRET e MASTER_KEY (openssl rand -base64 32)
pnpm infra:up                   # sobe Postgres (5433) e Redis (6379)
pnpm db:migrate                 # aplica o schema
```

Rode os dois processos (terminais separados):

```bash
pnpm dev            # web em http://localhost:3000
pnpm dev:worker     # worker de sincronização
```

> Em dev, o login é por email (sem senha) — apenas para desenvolvimento.
> Troque por magic-link/OAuth de login em produção (`apps/web/src/auth.ts`).

## Conectar provedores

- **OAuth**: registre um OAuth App no GitHub/GitLab e preencha `*_CLIENT_ID` /
  `*_CLIENT_SECRET` no `.env`. Callback: `{AUTH_URL}/api/oauth/{provider}/callback`.
- **PAT / self-hosted**: em *Conexões*, cole um token e (opcional) a base URL da
  instância self-hosted. Escopos mínimos: GitHub `read:user, repo`; GitLab
  `read_user, read_api`.

Ao conectar, um **backfill** é enfileirado; depois o worker roda sync
**incremental** a cada 15 min (configurável via `SYNC_INTERVAL_MIN`).

## Segurança

- Tokens dos provedores são cifrados em repouso (envelope AES-256-GCM,
  `MASTER_KEY`). Nunca são exibidos novamente nem logados.
- Multi-tenant: toda query é filtrada por `userId` da sessão.
- OAuth com validação de `state` (CSRF) em cookie httpOnly.

## AI Pulse

Detecta atividades assistidas por IA (Claude, Copilot, Cursor, Codex, Devin,
Gemini) a partir de, em ordem de força:

1. trailers de commit — `Co-Authored-By` com coautor de IA, `Generated-by`, `Assisted-by`;
2. rodapés das ferramentas — ex.: "🤖 Generated with Claude Code";
3. autores bot de agentes — ex.: `copilot-swe-agent[bot]`;
4. prefixos de branch — `claude/…`, `copilot/…`, `codex/…`.

A lógica é pura (`packages/core/src/ai-detect.ts`); cada adapter expõe
`aiEvidence(raw)`. Como a Events API do GitHub não traz mais as mensagens dos
commits e a do GitLab só traz o título, o sync **enriquece** pushes (compare
API) e PRs abertos, guardando em `raw._devpulse` (teto de 200 chamadas/sync).
No GitLab, isso requer acesso ao código do projeto (papel ≥ Reporter).
Um **Resync** reanalisa o histórico já ingerido.

## Scripts úteis

| Comando | O quê |
|---|---|
| `pnpm typecheck` | Type-check de todos os pacotes |
| `pnpm test` | Testes (vitest) do core |
| `pnpm db:studio` | Prisma Studio |
| `pnpm build` | Build de produção |
| `pnpm infra:down` | Derruba Postgres/Redis |

## Status (MVP)

- [x] Scaffold, infra, schema, cripto de segredos
- [x] Conexões: OAuth (GitHub/GitLab) + PAT (self-hosted)
- [x] Ingestão idempotente + rollups + worker/agendador
- [x] Feed unificado (filtros) + heatmap agregado + stats
- [x] Heatmap anual: GitHub (GraphQL `contributionsCollection`) e GitLab (`calendar.json`)
- [x] **AI Pulse** (`/ai`): % das entregas de código com participação de IA, por ferramenta e por semana
- [ ] Refresh de token OAuth, observabilidade, Bitbucket/Gitea
