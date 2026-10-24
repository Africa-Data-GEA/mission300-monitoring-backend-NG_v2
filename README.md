# M300 Nigeria Energy Compact Dashboard — Backend

NestJS API for the M300 monitoring dashboard. Docker-only — no native run path.

## Setup

```bash
pnpm install
copy .env.example .env.development
pnpm docker:dev
```

API at `http://localhost:3000`, Swagger at `/docs`.

```bash
pnpm docker:prisma:seed              # roles, pillars, states and demo accounts (no demo data)
pnpm docker:api:build                # required before next line
pnpm docker:prisma:seed:reference    # real M300 data
```

Always use the `docker:` scripts — bare host commands can't reach `DATABASE_URL`.

Demo logins (`ChangeMe123!`): `admin@m300.local`, `provider@m300.local` (Ikeja Electric), `reviewer@m300.local`. The administrator uses `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` when they are set. Change these passwords before sharing the environment. The seed loads no programmes, projects, KPIs or figures; all data comes from the reference load.

The e2e suite needs demo fixtures: `pnpm exec ts-node prisma/seed-e2e.ts` loads them into a throwaway test database only.

## If seed/build looks stale

```bash
docker compose -f docker/docker-compose.yml --env-file .env.development build api
docker compose -f docker/docker-compose.yml --env-file .env.development up -d api
pnpm docker:api:build
pnpm docker:prisma:seed:reference
```

(`pnpm docker:build` ≠ this — different, unused image.)

## Other scripts

```bash
pnpm docker:up       # background
pnpm docker:logs
pnpm docker:ps
pnpm docker:down     # keeps volumes
pnpm docker:kestra   # optional, see kestra/flows/
```

Port conflict → set `*_HOST_PORT` in `.env.development`.
New dependency → `up -d --build --force-recreate -V`.

## Quality

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm check
```

## Architecture

```
src/
  main.ts        bootstrap
  app.module.ts   wires modules + guards
  config/         env validation (zod)
  prisma/         PrismaService (global)
  events/         RabbitMQ
  common/         guards, decorators, interceptors, filters
  modules/        auth, health, institutions, submissions, kpis,
                  programs, bottlenecks, reports, stakeholders, administration
```

Enforced rules: KpiValue only written on approved submission; transitions
go through `submissions.state-machine.ts`; auth required by default
(`@Public()` opts out); cross-institution queries use
`scopeInstitutionFilter()`; mutations tagged `@AuditAction`.

## Deployment

Hostinger VPS, Docker Compose over SSH. Push `staging` → staging; tag
`v*.*.*` → production. Isolated by Compose project name
(`m300-backend-staging` / `-production`), ports `8099` / `8100`. See
`.github/workflows/deploy.yml`, `scripts/vps-bootstrap.sh`.

Before real launch: set `CORS_ORIGIN` per environment; wire a domain +
reverse proxy; swap health check to `scripts/health-check.sh`.

## Env vars

`.env.example` → copy to `.env.<environment>` (git-ignored). Same names as
GitHub Actions secrets (`.env.github.example`).
