# The ECCS API as a container image, and the database tools beside it (Stage H, 19 Oct 2026).
# Built from the repo root (the build context; see .dockerignore):
#
#   docker build -f infra/docker/api.Dockerfile -t eccs-api:<tag> .
#   docker build -f infra/docker/api.Dockerfile --target migrate -t eccs-migrate:<tag> .
#
# infra/scripts/deploy.ps1 runs both. "eccs-api" is the server; "eccs-migrate" holds Prisma and
# the loaders, and runs `prisma migrate deploy` and `seed:live` (infra/server/compose.yml,
# service "migrate"). The two share the same Node base, so saving them together costs it once.
#
# Only the API and the packages it uses are installed (pnpm --filter "@eccs/api..."): the phone
# app's dependencies never enter the image. The running image is Debian's own Chromium (the
# PDFs), Noto fonts for all 12 app languages, the face models, and the API's production
# dependencies only, and runs as the unprivileged "node" user.

ARG NODE_IMAGE=node:24.22.0-trixie-slim

# ───────── Node and pnpm, for the stages that install and build ─────────
FROM ${NODE_IMAGE} AS base
# The version in package.json's "packageManager".
RUN npm install -g pnpm@12.9.1 && npm cache clean --force
ENV CI=true
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

# ───────── Build: everything the API and its packages need to compile ─────────
FROM manifests AS build
RUN --mount=type=cache,id=eccs-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store --filter "@eccs/api..."
COPY packages/shared packages/shared
COPY packages/i18n packages/i18n
COPY packages/db packages/db
COPY apps/api apps/api
# `prisma generate` reads the config, which wants a database address; nothing connects to it.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm --filter "@eccs/api..." run build
# The face models: the copies already in apps/api/models are kept when their SHA-256 matches,
# anything missing is downloaded and checked (models/manifest.json).
RUN node apps/api/scripts/get-face-models.mjs

# ───────── The API's production dependencies only ─────────
FROM manifests AS prod-deps
ARG TARGETARCH
RUN --mount=type=cache,id=eccs-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store --prod --filter "@eccs/api..."
# onnxruntime-node carries its runtime for Windows, macOS and Linux on both processors (about
# 240 MB); keep only this server's.
RUN set -eu; \
    arch=x64; [ "${TARGETARCH:-amd64}" = "arm64" ] && arch=arm64; \
    cd node_modules/onnxruntime-node/bin/napi-v6; \
    for dir in */*; do [ "$dir" = "linux/$arch" ] || rm -rf "$dir"; done; \
    ls -d */*

# ───────── The OCR's English data, fetched once here instead of at the first licence read ─────────
FROM prod-deps AS ocr
# The same folder the licence reader uses (os.tmpdir()/eccs-ocr, licence-reader.service.ts).
RUN mkdir /ocr \
    && node --input-type=module -e "import { createWorker } from 'tesseract.js'; const worker = await createWorker('eng', 1, { cachePath: '/ocr' }); await worker.terminate();" \
    && ls -l /ocr && test -s /ocr/eng.traineddata

# ───────── The database tools: Prisma (migrations) and the loaders (seed:live) ─────────
FROM manifests AS db-tools
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,id=eccs-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store --filter "@eccs/db"

# ───────── Shared by both final images: the system parts and the database's certificates ─────────
FROM ${NODE_IMAGE} AS runtime-base
# The managed database (Lightsail, an Amazon RDS underneath) signs its TLS with Amazon RDS's
# own authorities, which neither Node nor Debian trusts by default. Prisma's migration engine
# reads the system store; Node reads NODE_EXTRA_CA_CERTS.
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /usr/local/share/ca-certificates/aws-rds-global-bundle.crt
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/aws-rds-global-bundle.crt \
    NODE_ENV=production
WORKDIR /app

# ───────── migrate: `docker compose run --rm migrate` (see infra/RUNBOOK.md) ─────────
FROM runtime-base AS migrate
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && update-ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=db-tools /app ./
COPY --from=build /app/packages/db/package.json /app/packages/db/prisma.config.ts /app/packages/db/tsconfig.json packages/db/
COPY --from=build /app/packages/db/prisma packages/db/prisma
COPY --from=build /app/packages/db/src packages/db/src
COPY --from=build /app/packages/db/generated packages/db/generated
# No update checks or usage reports from the Prisma CLI.
ENV CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 npm_config_update_notifier=false
USER node
WORKDIR /app/packages/db
CMD ["npm", "run", "migrate:deploy"]

# ───────── api: the server itself (the default target) ─────────
FROM runtime-base AS api
# Chromium prints the reports to PDF. Noto covers every script of the 12 app languages:
# Latin, Devanagari (Hindi, Marathi), Telugu, Tamil, Kannada, Malayalam, Bengali, Gujarati,
# Gurmukhi (Punjabi), Odia and Urdu (Nastaliq and Arabic).
# tini runs as process 1 and clears away the processes Chromium leaves behind: without it every
# PDF printed left a few "zombie" processes in the container (measured 19 Oct 2026).
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-core ca-certificates tini \
    && update-ca-certificates && rm -rf /var/lib/apt/lists/*
# Which Noto face each script falls back to (see the file).
COPY infra/docker/fonts.conf /etc/fonts/local.conf
COPY --from=prod-deps /app ./
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/i18n/dist packages/i18n/dist
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/models apps/api/models
COPY --from=ocr --chown=node:node /ocr /tmp/eccs-ocr
ENV API_PORT=4000 \
    PDF_BROWSER_PATH=/usr/bin/chromium
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.API_PORT || 4000) + '/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
