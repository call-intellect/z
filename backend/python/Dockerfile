# syntax=docker/dockerfile:1.7
#
# z-gepa — отдельный контейнер для GEPA prompt evolution (Agents v2 Фаза C2).
#
# Раньше Python-runner вшивался в образ backend (pip install gepa/dspy через
# --break-system-packages в alpine) и запускался через child_process.spawn.
# Теперь это самостоятельный HTTP-сервис: backend (GepaRunnerService) ходит
# сюда по `POST http://gepa:8000/optimize`. Выигрыш — лёгкий и быстрый образ
# backend, изоляция тяжёлых ML-зависимостей, атомарность сборки.
#
# Build context — `backend/python` (см. docker-compose.yml service `gepa`).
#
# HTTP(S)_PROXY — опциональный прокси для pip на этапе сборки (как у backend).

FROM python:3.11-slim AS runner
WORKDIR /app

ARG HTTP_PROXY=""
ARG HTTPS_PROXY=""
ARG NO_PROXY=""

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    GEPA_PORT=8000

# gepa/dspy/litellm тянут компиляцию части колёс — нужен gcc для sdist-пакетов.
RUN apt-get update \
  && apt-get install -y --no-install-recommends gcc curl \
  && rm -rf /var/lib/apt/lists/*

# Сначала зависимости — кешируется отдельным слоем, не инвалидируется правкой кода.
COPY gepa/requirements.txt ./gepa/requirements.txt
RUN pip install --no-cache-dir -r gepa/requirements.txt

# Код runner'а + HTTP-сервера.
COPY gepa ./gepa

# Непривилегированный пользователь.
RUN useradd --create-home --uid 10001 app && chown -R app:app /app
USER app

WORKDIR /app/gepa
EXPOSE 8000

# server.py импортирует `from runner import _run_gepa` — запускаем из каталога gepa.
CMD ["python", "server.py"]
