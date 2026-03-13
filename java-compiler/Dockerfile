# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — Dependency installer
#   Uses a Node.js image just to install npm packages (cache-friendly layer).
# ─────────────────────────────────────────────────────────────────────────────
FROM node:18-slim AS deps

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
#   We layer Node.js 18 on top so both `javac`/`java` and `node` are available.
# ─────────────────────────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jdk-jammy AS runtime

# ── Install Node.js 18 via NodeSource ──────────────────────────────────────
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    # Cleanup apt cache to shrink image
    apt-get purge -y --auto-remove curl && \
    rm -rf /var/lib/apt/lists/*

# ── Verify toolchain ────────────────────────────────────────────────────────
RUN java -version && javac -version && node --version && npm --version

# ── Create a non-root user for security ─────────────────────────────────────
RUN groupadd --gid 1001 appgroup && \
    useradd  --uid 1001 --gid appgroup --shell /bin/sh --create-home appuser

WORKDIR /app

# ── Copy production node_modules from stage 1 ───────────────────────────────
COPY --from=deps /build/backend/node_modules ./backend/node_modules

# ── Copy application source ──────────────────────────────────────────────────
COPY backend/package.json     ./backend/package.json
COPY backend/src               ./backend/src
COPY frontend                  ./frontend

# ── Directories the app writes to at runtime ─────────────────────────────────
# /tmp is already world-writable on Debian; no extra setup needed.

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
