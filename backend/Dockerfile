# syntax=docker/dockerfile:1.7
#
# Z backend — полностью на Bun (последний 1.3).
# Образ используется и для HTTP-приложения (CMD по умолчанию),
# и для worker-процесса (command переопределяется в compose на
# `bun dist/workers/main.js`).
#
# Этапы:
#   deps    — установка ВСЕХ зависимостей (нужны devDeps для tsc-сборки)
#   builder — prisma generate + tsc-сборка в dist/
#   runner  — только production-зависимости + dist + сгенерированный Prisma Client

# ---------- deps (все зависимости) ----------
FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
# python3/make/g++ — для native-модулей (argon2, bcrypt) при отсутствии prebuild.
# openssl — требуется Prisma engine.
RUN apk add --no-cache python3 make g++ openssl
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# ---------- builder ----------
FROM oven/bun:1.3-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock* tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
RUN bunx prisma generate
RUN bun run build

# ---------- runner (bun, только prod) ----------
FROM oven/bun:1.3-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
ENV PORT=3000

# Только production-зависимости (без tsc/eslint/vitest).
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Prisma Client генерируем в уже урезанный node_modules (после prune).
# prisma.config.ts нужен CLI Prisma 7 (db push на старте + generate здесь).
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN bunx prisma generate

# Скомпилированный код.
COPY --from=builder /app/dist ./dist

# Скрипт инициализации pgvector-индексов (HNSW/GIN) + его SQL.
# Запускается отдельным compose-сервисом `migrate` (bun scripts/apply-postgres-init.ts).
# Зависит только от `pg` (prod-dep) — без импортов из src.
COPY scripts/apply-postgres-init.ts scripts/postgres-init.sql ./scripts/

# Непривилегированный пользователь.
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 3000

# HTTP-приложение. Worker запускается переопределением command в compose.
CMD ["bun", "dist/main.js"]
