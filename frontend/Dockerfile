# syntax=docker/dockerfile:1.7
#
# Z frontend — сборка Next.js (output: 'standalone') ВНУТРИ контейнера на Bun.
#
# Результат сборки (`/app/deploy-out`) — самодостаточный артефакт:
#   server.js + минимальные node_modules + .next/static + public.
# Деплой-compose копирует его в host-директорию (FRONTEND_DEPLOY_DIR),
# где он запускается `bun server.js` под systemd, а nginx на хосте проксирует.
#
# ВАЖНО: NEXT_PUBLIC_* инлайнятся в бандл на этапе СБОРКИ — поэтому передаются
# как build-args (см. deploy/frontend/docker-compose.build.yml).

# ---------- deps ----------
FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# ---------- builder ----------
FROM oven/bun:1.3-alpine AS builder
WORKDIR /app
RUN apk add --no-cache coreutils
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Публичные ENV — инлайнятся в клиентский бандл во время `next build`.
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_BACKEND_URL
ARG NEXT_PUBLIC_LIVEKIT_URL
ARG NEXT_PUBLIC_FRONTEND_URL
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    NEXT_PUBLIC_BACKEND_URL=${NEXT_PUBLIC_BACKEND_URL} \
    NEXT_PUBLIC_LIVEKIT_URL=${NEXT_PUBLIC_LIVEKIT_URL} \
    NEXT_PUBLIC_FRONTEND_URL=${NEXT_PUBLIC_FRONTEND_URL} \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

RUN bun run build

# Собираем самодостаточный артефакт.
RUN mkdir -p /app/deploy-out \
 && cp -a .next/standalone/. /app/deploy-out/ \
 && mkdir -p /app/deploy-out/.next \
 && cp -a .next/static /app/deploy-out/.next/static \
 && if [ -d public ]; then cp -a public /app/deploy-out/public; fi

# ---------- runner (опционально: запуск фронта как контейнера) ----------
# Не используется в выбранной схеме (copy-to-host), оставлен для гибкости:
#   docker build --target runner ... && docker run -p 3001:3001 <img>
FROM oven/bun:1.3-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/deploy-out ./
USER app
EXPOSE 3001
CMD ["bun", "server.js"]
