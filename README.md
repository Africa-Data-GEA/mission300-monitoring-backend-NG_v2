# Mission 300 Compact Monitoring Platform — Backend

NestJS API for the Mission 300 Compact Monitoring Platform. Run everything in Docker, or run the API on your machine with Docker providing only Postgres and RabbitMQ.

Requirements: Node 24.x, pnpm 10, Docker Desktop. A newer Node prints an engine warning but works.

On macOS or Linux use `cp` where the commands below use `copy`.

## Option 1: everything in Docker

```bash
pnpm install
copy .env.example .env.development
pnpm docker:dev
```

API at `http://localhost:3000`, Swagger at `/docs`. Wait for `Nest application successfully started`, then load data from a second terminal:

```bash
pnpm docker:prisma:seed              # roles, pillars, states and demo accounts (no demo data)
pnpm docker:api:build                # required before next line
pnpm docker:prisma:seed:reference    # real M300 data
```

Run `pnpm docker:api:build` again whenever the api container is recreated or restarted: it clears `dist` on every start.

## Option 2: API on your machine, Postgres and RabbitMQ in Docker

```bash
pnpm install
copy .env.native.example .env.development
docker compose -f docker/docker-compose.yml --env-file .env.development up -d postgres rabbitmq
```

Prisma and the seed scripts read `DATABASE_URL` from the shell, not from the env file. Set it first.

```bash
export DATABASE_URL="postgresql://m300:m300@localhost:5432/m300?schema=public"   # bash
$env:DATABASE_URL="postgresql://m300:m300@localhost:5432/m300?schema=public"      # PowerShell
set DATABASE_URL=postgresql://m300:m300@localhost:5432/m300?schema=public         # cmd
```

```bash
pnpm prisma:migrate:deploy
pnpm prisma:seed
pnpm build
pnpm prisma:seed:reference
pnpm dev
```

API at `http://localhost:3000`, Swagger at `/docs`. `pnpm start` runs the built output instead of watch mode.

## Option 3: nothing in Docker

Install Postgres 17 and RabbitMQ 4, create the database and user from `.env.native.example`, edit its `DATABASE_URL` and `RABBITMQ_URL` to match, then follow Option 2 from the `DATABASE_URL` step.

## Demo logins and data

Demo logins (`ChangeMe123!`): `admin@m300.local`, `provider@m300.local` (Ikeja Electric), `reviewer@m300.local`. The administrator uses `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` when they are set. Change these passwords before sharing the environment. The base seed loads no programmes, projects, KPIs or figures; all data comes from the reference load.

NERC DisCo data loads through Q2 2025. From July 2025 the energy sheets in the NERC workbook are on the wrong scale, so those months are skipped until NERC supplies a corrected workbook (`LAST_RELIABLE_PERIOD` in `prisma/ingest-nerc-disco-data.ts`).

## If something fails

- **Port already in use.** Set `API_HOST_PORT`, `POSTGRES_HOST_PORT`, `RABBITMQ_HOST_PORT` or `RABBITMQ_MANAGEMENT_HOST_PORT` in `.env.development`.
- **RabbitMQ slow to become healthy.** On slow machines it can take over a minute to start. Wait for it, or run `pnpm docker:dev` again.
- **`P1000 Authentication failed`.** An existing Postgres volume keeps the password it was created with. Reset it with `docker compose -f docker/docker-compose.yml --env-file .env.development down -v`, which deletes the database, then seed again.
- **Reference load stops at `backfill-institution-traceability` on "Sample DisCo".** The database holds old demo fixtures. Reset it as above and seed again.
- **Seed or build looks stale.** Rebuild the image and recreate the container:

```bash
docker compose -f docker/docker-compose.yml --env-file .env.development build api
docker compose -f docker/docker-compose.yml --env-file .env.development up -d --force-recreate -V api
pnpm docker:api:build
pnpm docker:prisma:seed:reference
```

(`pnpm docker:build` is a different, unused image.) After adding a dependency run `up -d --build --force-recreate -V`.

## Other scripts

```bash
pnpm docker:up       # background
pnpm docker:logs
pnpm docker:ps
pnpm docker:down     # keeps volumes
pnpm docker:kestra   # optional, see kestra/flows/
```

## Quality

Outside Docker, first run `copy .env.test.example .env.test`. `pnpm install` generates the Prisma client automatically.

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm check
```

`pnpm test:e2e` needs a Postgres database named `m300_test` and RabbitMQ on the ports in `.env.test`. Load its fixtures into that database only, and do not run the base seed on it first: `pnpm exec ts-node prisma/seed-e2e.ts`.

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
