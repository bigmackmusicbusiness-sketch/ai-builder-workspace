# Dockerfile — Railway deployment for the Fastify API.
# Uses Node 20 + corepack (pnpm). Bundles via esbuild to dist/server.js.

FROM node:20-slim

WORKDIR /app

# Enable corepack so pnpm is available without PATH games
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Copy workspace manifests first for layer-cache efficiency
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json              ./apps/api/
COPY apps/api/build.mjs                 ./apps/api/
COPY apps/api/tsconfig.json             ./apps/api/
COPY packages/agent-core/package.json   ./packages/agent-core/
COPY packages/db/package.json           ./packages/db/
COPY packages/project-types/package.json ./packages/project-types/
COPY packages/providers/package.json    ./packages/providers/
COPY packages/security/package.json     ./packages/security/
COPY packages/shared/package.json       ./packages/shared/
COPY packages/verify/package.json       ./packages/verify/
COPY packages/ui/package.json           ./packages/ui/
COPY tsconfig.base.json                 ./

# Install all workspace deps
RUN pnpm install --frozen-lockfile

# Copy all source now that deps are cached
COPY . .

# Build: typecheck + esbuild bundle → apps/api/dist/server.js
RUN pnpm --filter @abw/api build

ENV HOST=0.0.0.0
ENV PORT=3007
EXPOSE 3007

CMD ["node", "apps/api/dist/server.js"]
