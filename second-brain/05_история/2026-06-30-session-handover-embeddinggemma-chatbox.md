---
distilled: false
---

# HANDOVER: продолжение работы в новой сессии

## Контекст задачи

Эта сессия (2026-06-30) сделала **2 крупные фичи** на ветке `fix/invite-password-existing-user-multi-org`:

1. **Embedding-миграция на `embeddinggemma:latest`** (локальная Ollama через `https://llm.korateam.ru/v1`, 768 dim вместо 1536)
2. **ChatBox analyze → event-driven** (удалили cron в 02:00, добавили race-protection + двойной дедуп + stuck-recovery cron)

БД локальная: `localhost:55435`, postgres+age+pgvector, arm64 (WSL2).

---

## Состояние git (на момент handover)

```
7f61972e refactor(chatbox): event-driven analyze вместо cron-а в 02:00  ← ПОСЛЕДНИЙ
49b9b72f fix(chatbox): analyze раз в сутки в 02:00 МСК (было каждые 10 мин)
b2fc5b07 feat(embeddings): SQL migrate-768 + backfill устойчивость
0b5eaad0 fix(security): заменить утёкший API-ключ в TZ на placeholder
aedde92c docs(second-brain): рефлексия — embeddinggemma 768 миграция
fe89f4e4 docs(second-brain,operations): embeddinggemma migration  ← ⚠️ УТЕЧКА СЕКРЕТА
be2f48f2 feat(embeddings): backfill + count scripts
4f499fd5 feat(embeddings): code+prisma for embeddinggemma 768 dim
```

Ветка: `fix/invite-password-existing-user-multi-org` (НЕ main, НЕ dev — пользователь работает в этой ветке).

**Незакоммиченных изменений нет** (всё закоммичено).

---

## ⚠️ КРИТИЧНО: утёкший секрет в истории git

**Проблема:** реальный `EMBEDDING_LOCAL_API_KEY=sk-emb-...` попал в коммит `fe89f4e4` дословно. Я это заметил и заменил в текущей версии файла на `<из .env: sk-emb-...>`, но **в истории коммитов секрет остался**.

**Что нужно сделать перед push (в любом порядке):**
1. **Сменить ключ** на llm.korateam.ru (старый считать скомпрометированным)
2. **Вычистить из истории** через `git rebase -i HEAD~8` → edit `fe89f4e4` → заменить строку → `git commit --amend --no-edit` → `git rebase --continue`
   - Альтернатива: `bunx git-filter-repo` (требует git-filter-repo в PATH)
3. **Push** (`git push origin fix/invite-password-existing-user-multi-org`) — rebase переписывает SHA, force-push не нужен (на origin её ещё нет)

---

## ✅ Что сделано в этой сессии

### 1. Embedding-миграция на `embeddinggemma:latest` (768 dim)

**Проблема:** Z использовал `text-embedding-3-small` через `proxy.agent-lia.ru` (1536 dim), OpenAI через прокси. Все 26 колонок `vector(1536)` в Prisma-схеме.

**Решение:**
- **ENV** уже настроен в `.env` (строки 123-127): `EMBEDDING_PROVIDER=local`, `EMBEDDING_MODEL=embeddinggemma:latest`, `EMBEDDING_DIMENSIONS=768`, `EMBEDDING_FALLBACK_LOCAL_URL=https://llm.korateam.ru/v1`, `EMBEDDING_LOCAL_API_KEY=sk-emb-...`
- **Код:**
  - `backend/src/common/config/env.schema.ts:140-152` — добавлен `EMBEDDING_LOCAL_API_KEY` (optional), дефолты: `EMBEDDING_MODEL=embeddinggemma:latest`, `EMBEDDING_DIMENSIONS=768`, `EMBEDDING_PROVIDER=local`
  - `backend/src/common/config/typed-config.service.ts:277-310` — `cfg.ai.embeddings.localApiKey` резолв
  - `backend/src/modules/embeddings/services/local-embedding.service.ts:32-43` — добавлен `Authorization: Bearer ${localApiKey}` header
  - `backend/src/modules/embeddings/services/vector-literal.util.ts:25` — комментарий обновлён (был "EMBEDDING_DIMENSIONS=1536", стало "= 768 для embeddinggemma")
  - **Prisma-схема:** все 26 колонок `Unsupported("vector(1536)")` → `Unsupported("vector(768)")` (`backend/prisma/schema.prisma`)
  - Старые backfill-скрипты обновлены под `vector(768)`:
    - `backend/scripts/backfill-goal-embeddings.ts:136`
    - `backend/scripts/backfill-context-header-reembed.ts:270`
- **Скрипты:**
  - `backend/scripts/backfill-embeddings-gemma-768.ts` (новый) — единый backfill для 26 таблиц, идемпотентен через `WHERE embedding IS NULL`, использует `EmbeddingFallbackService` напрямую. Race-safe через `CONCAT_WS(E'\\n\\n', …)` для склейки текстовых полей. Устойчив к отсутствующим таблицам (try/catch + skip).
  - `backend/scripts/count-embeddings.ts` (новый) — утилита оценки объёма (`SELECT COUNT(*) WHERE embedding IS NOT NULL`)
  - `backend/scripts/migrate-embeddings-dim-768.sql` (новый) — standalone SQL для прод-БД (Prisma не может сгенерить миграцию из-за AGE-trap)
- **Регистрация:** `backend/scripts/apply-prod-deploy.ts:1101` — `backfill-embeddings-gemma-768.ts` в STEPS, `phase:'backfill'`, `skipBootstrap:true`
- **Документация:** обновлены 7 файлов (см. коммиты)

**Проверено локально:**
- ✅ `bun run typecheck` чистый
- ✅ `bun run lint` чистый (0 errors)
- ✅ `bun run build` успешный
- ✅ `bunx prisma generate` пересобрал client
- ✅ Dry-run `backfill-embeddings-gemma-768.ts` прошёл (skip'ает 10 отсутствующих таблиц, остальные no-op)
- ✅ **Реальный backfill для Entity: 117/117 строк заэмбеджены**, размерность 768

### 2. ChatBox event-driven analyze

**Проблема:** `ChatboxAnalyzeCron.sweep` запускал анализ каждые 10 минут (лишние расходы). Пользователь требовал event-driven — analyze по факту забора, не по расписанию.

**Решение:**
- **Cron `ChatboxAnalyzeCron.sweep` (02:00 МСК) удалён** (`backend/src/modules/chatbox/chatbox-analyze.cron.ts` и `.spec.ts` — `rm`)
- **Новый `ChatboxStuckRecoveryCron` (раз в час)** (`backend/src/modules/chatbox/chatbox-stuck-recovery.cron.ts`) — safety-net: только re-enqueue залипших `analyzing` сессий (старше `chatbox.analyze.stuckAnalyzingMin`, default 30). НЕ запускает analyze по расписанию.
- **Race-protection в worker'е** (`backend/src/modules/chatbox/chatbox-analyze.worker.ts:73-84`):
  ```ts
  const claimed = await prisma.chatboxChatSession.updateMany({
    where: { id: sessionId, tenantId, analysisStatus: 'pending' },
    data: { analysisStatus: 'analyzing' },
  });
  if (claimed.count === 0) {
    await syncLog?.skip(run, 'session not pending');
    return; // race protection
  }
  ```
- **Двойной дедуп:**
  1. BullMQ `jobId = chatbox-analyze-${sessionId}` — повторный enqueue no-op (уже был в `queue.service.ts:42`)
  2. Conditional update в worker'е — race protection (новое)
- **`ChatboxSyncService.enqueuePendingAnalysisIfEnabled`** уже вызывается из `incrementalSync`, `fullSync`, `syncByScope` — событийная часть работала и до рефакторинга, cron был лишним
- **`ChatboxModule`** обновлён: `ChatboxAnalyzeCron` → `ChatboxStuckRecoveryCron` в providers
- **`seed-integration-crons.ts`** обновлён: `ChatboxAnalyzeCron.sweep` удалён, `ChatboxStuckRecoveryCron.recover` (`0 * * * *`) зарегистрирован
- **Документация:** `second-brain/02_architecture/module-map.md` — раздел cron'ов переписан (event-driven + два уровня дедупа)

**Проверено локально:**
- ✅ `bun run typecheck` чистый
- ✅ `rm` удалил старые cron-файлы
- ✅ Все упоминания `ChatboxAnalyzeCron` в коде заменены (только `seed-integration-crons.ts` и `module-map.md` упоминают его в историческом контексте)

---

## Состояние БД (на момент handover)

**БД:** `postgresql://z_app:DevcTTFuck1223S3128@localhost:55435/z_main` (локальный dev, postgres 16, age, pgvector)

- ✅ **Drift = 0** (БД == schema.prisma)
- ✅ **100/100 миграций applied** (был отставание на 15 миграций от 25 по 30 июня — все догнаны через `prisma migrate resolve --applied`)
- ✅ Legacy `Task` table + `TaskStatus` enum дропнуты
- ✅ **117 Entity embeddings заполнены** (vector(768), 768 dim) через `bun run scripts/backfill-embeddings-gemma-768.ts --only=Entity --batch=10`
- ✅ **0 embed-сессий с embedding IS NOT NULL в остальных таблицах** (count-embeddings показал 0 не-Entity)

**Redis:** `z-dev-redis` контейнер запущен на 6379 → проброшен на `localhost:6379` (я запустил его — он упал перед началом сессии)

**Доступные модели на `https://llm.korateam.ru/v1`** (проверено через `/v1/models`):
- `embeddinggemma:latest` ← наш primary
- `gemma4:e4b` ← для block-ingest tertiary (НЕ было раньше — пользователь добавил)
- `nomic-embed-text-v2-moe`
- `nomic-embed-text:latest`

**Smoke-тест провайдеров (`smoke-llm-providers.ts`):**
- DeepSeek (v4-flash, v4-pro, chat) — **✓** (пользователь обновил ключ в `.env`)
- OpenAI через proxy (gpt-5.5/5.4/5.4-mini/4.1-mini/4o-mini) — **✓**
- Anthropic через proxy (claude-sonnet/haiku/opus) — **✓** (MiniMax ключ был валидным, но Claude-канал не должен быть primary — РЕШЕНИЕ ВЛАДЕЛЬЦА)
- Ollama на `llm.korateam.ru`:
  - `qwen3.5:9b` — **✗ 404** (этой модели там нет)
  - `kwangsuklee/Nanbeige4.1-3B.Q4_K_M:latest` — **✗ 404** (тоже нет)
  - `gemma4:e4b` — **✓** (пользователь развернул, через `/v1/chat/completions` отвечает "Да" на 29+2 tok)
- KIE (claude-opus, gpt-5-4, gemini-3-flash, gemini-3-pro) — **✓**
- GRSAI gemini-3-pro/3.1-pro — **timeout** (не критично для нашей задачи)
- Embeddings openai (`text-embedding-3-small`, 1536) — **✓**
- Embeddings ollama (`bge-m3`) — **✗ 404** (этой модели там нет)

**Пре-existing проблемы (НЕ моя зона, НЕ чинил):**
- `LlmTaskRoute` для `block-ingest`/`tertiary` указывает на `ollama/gemma4:e4b` — раньше падал 404, сейчас работает
- `LlmTaskRoute` для многих задач содержат `qwen3.5:9b`/`kwangsuklee/Nanbeige...` — эти модели отсутствуют на `llm.korateam.ru`. Если в seed-скриптах они хардкодятся — нужно патчить
- DeepSeek API ключ в `.env` (`DEEPSEEK_API_KEY`) — пользователь обновил, теперь валидный
- BullMQ queues перед началом работы были очищены мной через `redis-cli EVAL` (удалены `:wait`, `:active`, `:delayed`, `:failed`)

---

## Текущее состояние сервисов (локально)

**НЕ запущены:** `bun run dev` НЕ запущен сейчас. Пользователь, возможно, запускает его по необходимости.
- Если запускает — block-ingest теперь работает (gemma4:e4b доступна)
- SourceEpisode таблица существует в БД (после моих миграций)
- Conversation/Message/PushToken/UserBlock/MessageReport/etc. — все таблицы созданы (ранее были отсутствуют)

**Что может упасть при следующем `bun run dev`:**
- Сообщения от gemma3:5b или qwen3.5:9b как tertiary fallback в других LlmTaskRoute — 404 на llm.korateam.ru
- Сообщения от kie/claude-opus-4-7 — если лимит превышен (smoke показал 33s response, медленно)
- Маленькая вероятность что часть LlmTaskRoute была через `ollama.agent-lia.ru` (другой хост) — если эти route есть, они будут работать только если `ollama.agent-lia.ru` доступен

---

## Архитектурные решения (принятые в этой сессии)

### Embedding — `embeddinggemma:latest` через `LocalEmbeddingService`

Цепочка (из `EmbeddingFallbackService.buildChain`):
- `EMBEDDING_PROVIDER=local` → `[LocalEmbeddingService, OpenAiProxyEmbeddingService]` (fallback)
- иначе (по дефолту, но теперь не наш кейс) → `[OpenAiProxyEmbeddingService, LocalEmbeddingService]`

Primary — локальная Ollama через `https://llm.korateam.ru/v1`. `Authorization: Bearer ${EMBEDDING_LOCAL_API_KEY}` (опционально — если шлюз открытый, можно без ключа).

Размерность — 768 (нативная для EmbeddingGemma). Поддерживает MRL (Matryoshka) — можно ужать до 512/256/128/64 если нужно в будущем.

### ChatBox analyze — event-driven

**Архитектура:**
1. **Sync** (cron 00:00 + fullSync + syncByScope) → emit event → analyze
2. **Stuck-recovery** (cron раз в час) → только safety-net для залипших `analyzing` сессий

**Дедуп два уровня:**
1. BullMQ `jobId = chatbox-analyze-${sessionId}` — повторный enqueue no-op
2. Conditional `updateMany({where: {analysisStatus: 'pending'}, data: 'analyzing'})` — race protection

**Failed-сессии** остаются в `failed` статусе, не ретраятся автоматически. Для retry — ручной re-enqueue через `ChatboxChatsService.analyzeChat` (отдельная задача, не сделано).

---

## TODO (что осталось)

### 🔴 БЛОКЕР перед push

1. **Сменить `EMBEDDING_LOCAL_API_KEY`** на `https://llm.korateam.ru` — старый ключ (префикс `sk-emb-…`) скомпрометирован (попал в git историю)
2. **Rebase `fe89f4e4`** для вычистки секрета:
   ```bash
   git rebase -i HEAD~8
   # в коммите fe89f4e4 поменять pick → edit
   # в `plans/tz/2026-06-30-embeddinggemma-768-migration.md` заменить
   # строку с реальным ключом на placeholder
   git add plans/tz/2026-06-30-embeddinggemma-768-migration.md
   git commit --amend --no-edit
   git rebase --continue
   ```
3. **Push** после rebase: `git push origin fix/invite-password-existing-user-multi-org` (force-push НЕ нужен — на origin этой ветки ещё нет)

### 🟡 Средний приоритет (отдельные задачи)

4. **Патч `seed-llm-task-routes-*.ts`** — заменить `qwen3.5:9b`/`kwangsuklee/Nanbeige...`/`bge-m3` (которых нет на llm.korateam.ru) на `gemma4:e4b`/`embeddinggemma:latest`. Файлы: `backend/scripts/seed-llm-task-routes-*.ts`. Регистрация в `apply-prod-deploy.ts STEPS`.

5. **Manual backfill failed-сессий** — добавить endpoint `POST /chats/:id/analyze-retry` или ручной скрипт для re-enqueue `analysisStatus='failed'` сессий (текущая реализация теряет их навсегда).

6. **Chatbox пустые сессии** — `rebuildSessions` создаёт сессии даже для пустых дней (0 сообщений). `ingestSession` всё равно ингестит их как RawEvent без текста. Нужно либо скипать в `rebuildSessions` если `messageCount=0`, либо скипать в `ingestSession`.

7. **`MAX_PAGES` cap в sync** — если sync не успевает за один проход (много чатов/сообщений), хвост остаётся в ChatBox API до следующего дня. Нужен catch-up механизм (например, `if (truncated) { re-run incrementalSync with since }`).

### 🟢 Низкий приоритет (можно отложить)

8. **Health-check для `llm.korateam.ru`** — добавить в `/health` endpoint пинг Ollama-список моделей.
9. **Prometheus-метрики** для embedding-стека: `embedding_duration_ms`, `embedding_failures_total{reason}`, по провайдерам.

---

## Ключевые файлы (для быстрой навигации)

### Код

- `backend/src/common/config/env.schema.ts:140-152` — `EmbeddingsSchema`
- `backend/src/common/config/typed-config.service.ts:277-310` — `cfg.ai.embeddings.*` резолв
- `backend/src/modules/embeddings/services/local-embedding.service.ts` — `Authorization: Bearer` header
- `backend/src/modules/embeddings/services/embedding-fallback.service.ts:43-48` — `buildChain`
- `backend/src/modules/chatbox/chatbox-analyze.worker.ts:73-84` — race-protection conditional update
- `backend/src/modules/chatbox/chatbox-stuck-recovery.cron.ts` — новый cron раз в час
- `backend/src/modules/chatbox/chatbox-sync.service.ts:270-296` — `enqueuePendingAnalysisIfEnabled` (событийная часть)
- `backend/src/modules/chatbox/chatbox-sync.service.ts:482-565` — `fullSync`, `incrementalSync`, `syncByScope`
- `backend/src/modules/chatbox/chatbox.module.ts:5,42` — `ChatboxStuckRecoveryCron` в providers

### Скрипты

- `backend/scripts/backfill-embeddings-gemma-768.ts` — единый backfill
- `backend/scripts/count-embeddings.ts` — оценка объёма
- `backend/scripts/migrate-embeddings-dim-768.sql` — SQL для прод-БД
- `backend/scripts/apply-prod-deploy.ts:1101` — регистрация backfill

### Документация

- `plans/tz/2026-06-30-embeddinggemma-768-migration.md` — ТЗ с 5 фазами, rollback, deploy-чеклист
- `second-brain/05_история/2026-06-30-embeddinggemma-768-migration.md` — рефлексия по embedding
- `second-brain/02_architecture/ai-integration.md` — раздел Embeddings переписан
- `second-brain/02_architecture/module-map.md:2338-2345` — ChatBox event-driven архитектура
- `docs/operations/prod-deploy-log.md` — блок «2026-06-30» с шагами 1/4/8/11/12 для embedding-миграции

### Prisma

- `backend/prisma/schema.prisma` — 26 колонок `vector(768)`, остальные типы как в мастер-копии

---

## Команды для быстрого старта в новой сессии

```bash
# 1. Поднять dev-БД (если упала)
docker ps -a | grep postgres
docker start z-postgres-age-pgvector  # если не запущена

# 2. Поднять Redis
docker start z-dev-redis  # если не запущен

# 3. Проверить состояние БД
DATABASE_URL="postgresql://z_app:DevcTTFuck1223S3128@localhost:55435/z_main" bun --env-file=../.env run scripts/count-embeddings.ts

# 4. Прогон backfill (если нужно)
DATABASE_URL="postgresql://z_app:DevcTTFuck1223S3128@localhost:55435/z_main" bun --env-file=../.env run scripts/backfill-embeddings-gemma-768.ts --dry-run

# 5. Typecheck/lint/build
cd /home/tozix/dev/z/backend && NODE_OPTIONS="--max-old-space-size=8192" bun run typecheck
cd /home/tozix/dev/z/backend && bun run lint
cd /home/tozix/dev/z/backend && bun run build

# 6. Запустить backend
cd /home/tozix/dev/z/backend && bun run dev

# 7. Сменить ключ + rebase + push (после проверок)
#    (см. секцию "🔴 БЛОКЕР перед push" выше)
```

---

## Контекст про пользователя

- Стиль общения: матерно-прямолинейный, требует конкретики. Не любит "воды"
- Предпочитает event-driven вместо cron, idempotency обязательна, контроль расходов (жалуется на "разорюсь")
- Помнит про безопасность секретов — спрашивал про rebase
- Работает в ветке `fix/invite-password-existing-user-multi-org` (НЕ dev/main)
- Использует локальный dev через `bun run dev` (БД в docker, Redis в docker), не production-style

---

## Контекст про проект (Z / Кора)

**Что это:** платформа памяти компании. Автоматически собирает граф знаний из встреч (LiveKit), чатов (ChatBox), решений, документов.

**Стек:**
- Frontend: Next.js 14 App Router, LiveKit React Components, Radix, Tailwind
- Backend: NestJS 11, Prisma 7 (pgvector, AGE), Redis (BullMQ), TypeScript strict
- БД: PostgreSQL 16 + AGE (graph) + pgvector (embeddings) — arm64/WSL2 локально
- AI: LlmRouter с провайдерами DeepSeek/OpenAI/Anthropic/Ollama; embeddings через embeddinggemma (новое); ASR через Vox
- Команды: `bun install && bun run prisma:migrate && bun run prisma:generate` для первого запуска. `bun run dev` для разработки.

**Правила проекта (см. CLAUDE.md):**
- **Backend единый стек TypeScript/Bun** — Python только в отдельных HTTP-микросервисах
- **Ship-On** — выкатываем включённым; kill-switch только аварийный
- **Крутилки в AdminSetting** — не в ENV; ENV только секреты, домены, bootstrap
- **Шаблон эмбеддингов сразу для типа встречи** — главное продуктовое отличие
- **Аудио — отдельными дорожками** — не общий микс
- **LiveKit — только медиа** — никакой бизнес-логики в LiveKit Server
- **Коммитить по доменам** (3 коммита в этой сессии для embedding-фичи)
- **Перед push — rebase для вычистки секрета**
- **Рефлексия в second-brain/05_история/ после push**

**Главные second-brain файлы:**
- `second-brain/index.md` — индекс всех разделов
- `second-brain/02_architecture/{ai-integration,knowledge-core,tech-stack,module-map,company-memory-overview}.md`
- `second-brain/01_projects/chatbox-integration.md`, `embeddings.md` (не существует, можно создать)
- `second-brain/05_история/` — рефлексии по сессиям

---

## Что нужно сделать СЕЙЧАС в новой сессии

1. Прочитать этот документ целиком
2. Если пользователь спрашивает про "продолжай embedding" — спросить хочет ли он сначала сделать rebase + push (блокер) или есть другая задача
3. Если пользователь спрашивает про "продолжай chatbox" — обсудить патч `seed-llm-task-routes` (TODO #4) или retry-endpoint для failed (TODO #5)
4. Если пользователь просит **rebase + push** — следовать инструкциям из секции "🔴 БЛОКЕР перед push"
5. Если пользователь хочет другую задачу — спросить, какую именно

Готов к продолжению!