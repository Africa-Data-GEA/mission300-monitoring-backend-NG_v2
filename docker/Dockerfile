# syntax=docker/dockerfile:1

# ---- deps: install full dependency tree (cached layer) ----
FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# ---- development: dependencies plus an initial source snapshot ----
# Compose Watch starts the container before its first sync can complete. Keep
# the source in the image so startup commands such as `prisma generate` never
# race the initial sync and fail because prisma/schema.prisma is absent.
FROM deps AS development
COPY . .

# ---- build: compile TypeScript + generate Prisma client ----
FROM development AS build
RUN pnpm prisma:generate
RUN pnpm build
RUN pnpm install --frozen-lockfile --prod

# ---- runtime: minimal image, no build tools ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --chown=app:app --from=build /app/node_modules ./node_modules
COPY --chown=app:app --from=build /app/dist ./dist
COPY --chown=app:app --from=build /app/assets ./assets
COPY --chown=app:app --from=build /app/prisma ./prisma
COPY --chown=app:app --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --chown=app:app --from=build /app/package.json ./package.json
RUN install -d -o app -g app /app/storage
USER app
EXPOSE 3000
CMD ["node", "dist/main.js"]
