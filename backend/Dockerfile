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
# openssl — Prisma engine.
# postgresql16-client — pg_dump для авто-бэкапа БД перед `prisma db push
# --accept-data-loss` (apply-prod-deploy.ts --with-schema). pg16 = версия сервера.
#
# GEPA prompt evolution (Agents v2 Фаза C2) ВЫНЕСЕН в отдельный контейнер z-gepa
# (см. backend/python/Dockerfile). Python/pip в этом образе больше не нужны —
# backend ходит к gepa-сервису по HTTP (GepaRunnerService → GEPA_SERVICE_URL).
RUN apk add --no-cache openssl postgresql16-client
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

# Исходники src/ — нужны для prod-скриптов, которые импортируют из `../src/...`
# (например, seed-llm-model-prices.ts → '../src/modules/ai/services/model-prices').
# Bun исполняет .ts напрямую — компиляция не нужна. Размер +5-10 MB к образу.
COPY src ./src
COPY tsconfig.json ./

# Все prod-скрипты (patch/seed/backfill/migrate/setup/apply-postgres-init).
# Нужны в runner-образе для prod-операций: миграция через compose-сервис `migrate`,
# а также `docker compose exec backend bun run scripts/<name>.ts` для ручных операций
# по prod-deploy-log.md. Bun исполняет .ts напрямую, зависимости — только prod-deps.
# Исключения через .dockerignore (см. __snapshots__/, eval/, benchmark-*).
COPY scripts ./scripts

# Папка для авто-бэкапов БД (apply-prod-deploy.ts --with-schema пишет сюда
# pg_dump перед --accept-data-loss). Монтируется как volume z-backups в compose.
RUN mkdir -p /app/backups

# Непривилегированный пользователь.
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 3000

# HTTP-приложение. Worker запускается переопределением command в compose.
CMD ["bun", "dist/main.js"]
