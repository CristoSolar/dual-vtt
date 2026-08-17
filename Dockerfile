# Single container: builds the web app and serves it + the API on one port
# (mirrors `pnpm -F @daggerheart/server host`, minus rebuilding on every start).
FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

WORKDIR /app

# Install first with only manifests present, so this layer caches across code changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/srd-data/package.json packages/srd-data/package.json
COPY packages/rules/package.json packages/rules/package.json
COPY packages/character/package.json packages/character/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm -F @daggerheart/web build

ENV NODE_ENV=production
# The server serves this build itself — no separate web process, no CORS relaxation.
ENV WEB_DIST_DIR=../web/dist
EXPOSE 4000

WORKDIR /app/apps/server
CMD ["pnpm", "start"]
