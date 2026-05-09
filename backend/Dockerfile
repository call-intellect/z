# syntax=docker/dockerfile:1.7

# ---------- builder (bun) ----------
FROM oven/bun:1.1-alpine AS builder

WORKDIR /app

# Install dependencies (cache-friendly)
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile || bun install

# Copy sources
COPY tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
COPY src ./src

# Generate Prisma Client and compile TypeScript
RUN bunx prisma generate
RUN bun run build

# Prune dev dependencies for runtime
RUN bun install --production --frozen-lockfile || bun install --production

# ---------- runner (node 20 alpine) ----------
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Non-root user
RUN addgroup -S app && adduser -S app -G app

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/prisma ./prisma
COPY --from=builder --chown=app:app /app/package.json ./package.json

USER app

EXPOSE 3000

CMD ["node", "dist/main.js"]
