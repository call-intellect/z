# Z — PostgreSQL 16 + pgvector + Apache AGE (composite image для dev).
#
# Зачем composite: оба расширения нужны в одной БД, но публичные образы
# содержат только что-то одно. Этот Dockerfile собирает обе extension'ы из
# исходников и подкладывает их в стандартный postgres:16-bookworm.
#
# Версии зафиксированы под stable-теги:
#   - pgvector v0.8.0 — соответствует prod (Yandex Managed PostgreSQL 16).
#   - Apache AGE release/PG16/1.5.0 — последний stable-релиз под PG16,
#     совпадает с версией, доступной в Yandex Managed PostgreSQL 16.
#
# На prod образ НЕ нужен: Yandex Cloud Managed PostgreSQL 16 поддерживает
# обе extensions из коробки (см. second-brain/02_architecture/age-deployment-decision.md).
#
# Сборка:
#   docker compose build postgres
# Запуск:
#   docker compose up -d postgres

FROM postgres:16-bookworm

# Билд-зависимости. Снесём после установки, чтобы не раздувать image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        build-essential \
        git \
        flex \
        bison \
        postgresql-server-dev-16 \
    && rm -rf /var/lib/apt/lists/*

# 1. pgvector
RUN git clone --depth 1 --branch v0.8.0 https://github.com/pgvector/pgvector.git /tmp/pgvector \
    && cd /tmp/pgvector \
    && make \
    && make install \
    && rm -rf /tmp/pgvector

# 2. Apache AGE (тэг под PG16; ветка release/PG16/1.5.0).
RUN git clone --depth 1 --branch release/PG16/1.5.0 https://github.com/apache/age.git /tmp/age \
    && cd /tmp/age \
    && make PG_CONFIG=/usr/bin/pg_config \
    && make install PG_CONFIG=/usr/bin/pg_config \
    && rm -rf /tmp/age

# AGE требует preload-библиотеку. Postgres-сэмпл-конфиг проливается в
# реальный postgresql.conf при `initdb`, поэтому добавляем сюда.
RUN echo "shared_preload_libraries = 'age'" >> /usr/share/postgresql/postgresql.conf.sample

# Снижаем размер image — компилятор и dev-пакеты больше не нужны.
RUN apt-get purge -y --auto-remove \
        build-essential \
        git \
        flex \
        bison \
        postgresql-server-dev-16 \
    && rm -rf /var/lib/apt/lists/*

# Скрипт инициализации БД. Postgres-image вызывает любые *.sql/*.sh из
# /docker-entrypoint-initdb.d при первом старте контейнера на чистом
# volume.
COPY init.sql /docker-entrypoint-initdb.d/00-init.sql
