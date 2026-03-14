# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — Dependency installer
#   Uses a Node.js image just to install npm packages (cache-friendly layer).
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS deps

WORKDIR /build/backend

# Copy only manifests first — Docker caches this layer until they change
COPY backend/package*.json ./

# Install production dependencies.
# npm install is used instead of npm ci because no package-lock.json is
# committed to the repo. Once you commit the lockfile you can switch back
# to: RUN npm ci --omit=dev --no-audit --no-fund
RUN npm install --omit=dev --no-audit --no-fund


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — Final runtime image
#   Base: eclipse-temurin (OpenJDK 17 LTS, Debian Jammy slim)
#   Layers on top: Node.js 20, Python 3, GCC (C), G++ (C++), TypeScript (tsc), ts-node
# ─────────────────────────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jdk-jammy AS runtime

# ── Install Node.js 20 + Python 3 + GCC + G++ ────────────────────────────────
# All language runtimes are installed in a single RUN to minimise layers.
# TypeScript (tsc) is installed globally via npm after Node.js is available.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl ca-certificates \
        python3 python3-pip \
        gcc g++ && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    # Install the TypeScript compiler and ts-node globally so `tsc` and
    # `ts-node` are on PATH at runtime. Required by the TypeScript runner.
    npm install -g --no-audit --no-fund typescript ts-node && \
    # Cleanup apt cache to shrink image
    apt-get purge -y --auto-remove curl && \
    rm -rf /var/lib/apt/lists/*

# ── Verify the full toolchain ─────────────────────────────────────────────────
RUN java -version && javac -version && \
    node --version && npm --version && \
    python3 --version && \
    gcc --version && g++ --version && \
    tsc --version && ts-node --version

# ── Create a non-root user for security ──────────────────────────────────────
RUN groupadd --gid 1001 appgroup && \
    useradd  --uid 1001 --gid appgroup --shell /bin/sh --create-home appuser

WORKDIR /app

# ── Copy production node_modules from stage 1 ────────────────────────────────
COPY --from=deps /build/backend/node_modules ./backend/node_modules

# ── Copy application source ───────────────────────────────────────────────────
COPY backend/package.json     ./backend/package.json
COPY backend/src               ./backend/src
COPY frontend                  ./frontend

# ── Ownership → non-root user ─────────────────────────────────────────────────
RUN chown -R appuser:appgroup /app

USER appuser

# ── Runtime environment ────────────────────────────────────────────────────────
ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

# ── Healthcheck ────────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# ── Start the Node.js server ──────────────────────────────────────────────────
CMD ["node", "backend/src/server.js"]
