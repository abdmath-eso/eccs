# The ECCS console (apps/web, Next.js) as a container image (Stage H, 19 Oct 2026). It also
# serves the customer QR pages (/k/<token>), the quote pages (/q/<token>) and the legal pages
# (/legal/<key>). Built from the repo root (see .dockerignore):
#
#   docker build -f infra/docker/web.Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.<domain>/v1 -t eccs-web:<tag> .
#
# NEXT_PUBLIC_API_URL is written into the console's JavaScript when it is built, so an image
# belongs to one API address: a new address needs a new image. The server-side settings
# (API_INTERNAL_URL, PUBLIC_PAGE_BASE_URL) are read when it runs (infra/server/compose.yml).
#
# The running image is Next.js's "standalone" output (apps/web/next.config.ts): server.js and
# only the files it uses, run as the unprivileged "node" user.

ARG NODE_IMAGE=node:24.22.0-trixie-slim

# ───────── Node and pnpm, for the stages that install and build ─────────
FROM ${NODE_IMAGE} AS base
# The version in package.json's "packageManager".
RUN npm install -g pnpm@12.9.1 && npm cache clean --force
ENV CI=true NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ───────── What pnpm reads to install: kept apart so installs are cached until a dependency changes ─────────
FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/package.json packages/shared/
COPY packages/i18n/package.json packages/i18n/
COPY packages/db/package.json packages/db/
COPY packages/api-client/package.json packages/api-client/

# ───────── Build: the console and the packages it uses ─────────
FROM manifests AS build
RUN --mount=type=cache,id=eccs-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store --filter "@eccs/web..."
COPY packages/shared packages/shared
COPY packages/i18n packages/i18n
COPY packages/api-client packages/api-client
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL
RUN test -n "$NEXT_PUBLIC_API_URL" || { echo "Give the API's address: --build-arg NEXT_PUBLIC_API_URL=https://api.<domain>/v1"; exit 1; }
RUN pnpm --filter "@eccs/web..." run build

# ───────── web: the console server ─────────
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# The standalone folder mirrors the repo (apps/web/server.js, packages/*, node_modules). The
# browser's files (.next/static) and public/ are not in it and are copied beside server.js.
# Next.js writes its page cache under .next, so that folder belongs to the user it runs as.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static apps/web/.next/static
COPY --from=build /app/apps/web/public apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/login').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/web/server.js"]
