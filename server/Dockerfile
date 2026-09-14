# LSC Billing server.
#
# Built on whatever architecture the host runs: arm64 on Lachlan's Mac for local
# testing, amd64 on the DXP4800 Pro's Core i3. Nothing here is arch-specific, so
# no --platform flag is needed in either place.

# ── Stage 1: dependencies ─────────────────────────────────────────────────────
# better-sqlite3 ships prebuilt binaries for common Node ABIs, but the build
# toolchain is here so a version without a prebuild compiles rather than fails.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
# The compilers stay behind in stage 1; this image carries only Node and the
# built modules.
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# PDF export (POST /api/estimates/:id/pdf) renders through this Chromium in
# headless mode via puppeteer-core — puppeteer-core ships no browser of its
# own, so the apt package is what actually does the rendering.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation \
 && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY public ./public

# /data is the volume mount point. Created and owned here so the container can
# write to it as the unprivileged `node` user.
RUN mkdir -p /data && chown -R node:node /data
USER node

ENV DATA_DIR=/data
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
