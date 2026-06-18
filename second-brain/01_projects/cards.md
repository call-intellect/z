---
title: Cards — CRM-структура встреч
status: actual
updated: 2026-05-10
---

# Cards (CRM-структура встреч)

CRM-карточки, к которым подвязываются встречи. Реализовано 2026-05-09 по
[plans/archive/2026-05-09-cards.md](../../plans/archive/2026-05-09-cards.md).

## Главный сценарий

1. Пользователь создаёт карточку (клиент / сделка / проект / тема) на `/cards`.
2. На странице карточки нажимает «Запланировать встречу» → попадает на
   `/meetings/create?cardId=<id>` с readonly-меткой о привязке.
3. После создания встреча автоматически имеет `cardId` и появляется в ленте
   карточки.
4. После обработки AI запускается `card-rollup` (через дебаунс 5 сек) —
   `Card.summaryCache` пересобирается из последних 20 встреч.
5. AI-чат по карточке доступен на вкладке «AI-чат» — RAG среди всех встреч
   карточки.

## Backend — карта модулей

### Cards
- `backend/src/modules/cards/cards.module.ts` — controller + service + repo + DTO.
- `cards.service.ts` — CRUD карточек, link/unlink встреч с `SELECT ... FOR UPDATE`
  (защита от гонки при двух одновременных привязках).
- `cards.repository.ts` — низкоуровневые запросы; денормализованные счётчики
  `meetingCount` / `lastMeetingAt` пересчитываются методом `recountMeetings(cardId)`.
- DTO: `card-kind.ts` (5 видов: client/deal/project/topic/custom + hex-цвет regex),
  `create-card.dto.ts`, `update-card.dto.ts`, `list-cards.dto.ts` (zod-валидация).
- Эндпоинты — см. [api-layer](api-layer.md).

### AI-pipeline (расширения)
- `backend/src/modules/ai/services/card-rollup.service.ts` — синхронная сборка
  rollup-сводки. Берёт до 20 последних встреч карточки с непустым `aiResult.summary`,
  один LLM-вызов с промптом из `prompts/card-rollup.ts` (5 вариантов по `kind`).
- `backend/src/modules/ai/workers/card-rollup.worker.ts` — BullMQ worker очереди
  `ai.card-rollup`. Дедуп через `jobId = "rollup:card:<cardId>"` + `delay: 5_000`
  (серия встреч за минуту → один rollup).
- `LlmRouter` — добавлены taskType: `card-rollup`, `card-chat`.
- Триггеры rollup из:
  - `analyze.worker.ts` — после `ai_ready`, если `meeting.cardId != null`.
  - `regenerate.service.ts` — после `regenerateSection`. (Полная regenerate
    идёт через analyze, поэтому покрыта первым триггером.)
  - `cards.service.ts` `linkMeeting` / `unlinkMeeting`.

### Chat (расширение)
- `MeetingChatMessage.cardId` — новое опциональное поле. Инвариант на уровне
  сервиса: ровно одно из `meetingId | cardId` непустое.
- `POST /api/v1/cards/:id/chat` — RAG-чат по транскриптам встреч карточки.
  Реализация в `chat.service.ts.askCard` через `searchSimilarChunksByCard`
  (cosine similarity с фильтром `m."cardId" = $cardId`).
- `GET /api/v1/cards/:id/chat/history`.

### Search (новый модуль)
- `backend/src/modules/search/` — глобальный `GET /api/v1/search?q=&types=`
  для `⌘K` командной палитры. Postgres ILIKE по `Card.name/contactName/contactEmail`,
  `Meeting.title`, `Task.title`. ts_vector — vNext.

### Cross-cutting
- Webhook events: `card.created`, `card.updated`, `card.deleted`,
  `meeting.linked_to_card`, `meeting.unlinked_from_card`.
- Audit log: `CARD_CREATE`, `CARD_UPDATE`, `CARD_DELETE`, `CARD_RESTORE`,
  `MEETING_LINK_TO_CARD`, `MEETING_UNLINK_FROM_CARD`.
- Quotas: `MAX_CARDS_PER_USER` (по умолчанию 500), `MAX_CARD_ROLLUPS_PER_DAY`
  (по умолчанию 100).
- Retention: `Card.deletedAt < now - softDeleteGraceDays` → hard-delete в
  `retention-extras.cron.ts`. FK `Meeting.cardId` имеет `onDelete: SetNull`,
  поэтому привязки встреч обнуляются автоматически.
- Metrics: `cards_total{kind, action}`, `card_rollup_runs_total{status}`,
  `chat_request_total{scope=card}`.

## Public REST API

`/api/public/v1/cards` под `BearerAuthGuard`:

- `GET /cards` — список (read).
- `GET /cards/:id` — карточка (read).
- `GET /cards/:id/meetings` — встречи карточки (read).
- `POST /cards` — создать (write).
- `PATCH /cards/:id` — обновить (write).
- `DELETE /cards/:id` — soft-delete (write).
- `POST /cards/:cardId/meetings/:meetingId` — link (write).
- `DELETE /cards/:cardId/meetings/:meetingId` — unlink (write).

Реализация — `backend/src/modules/public-api/cards.public.controller.ts`,
переиспользует `CardsService` (через `CardsModule` импорт в `PublicApiModule`).

## Frontend — карта страниц

### Новые
- `app/(authenticated)/cards/page.tsx` + `CardsClient.tsx` — список карточек:
  grid с фильтрами по `kind`, поиском, разделом «Закреплённые».
  Кнопка «Новая карточка» открывает `CreateCardDialog`.
- `app/(authenticated)/cards/[id]/page.tsx` + `CardDetailClient.tsx` — страница
  карточки: шапка с действиями (Pin/Archive/Delete), таб «Обзор» (timeline +
  rollup-сайдбар), таб «AI-чат». Кнопка «Запланировать встречу» на
  `/meetings/create?cardId=<id>`.

### Расширенные
- `app/(authenticated)/meetings/create` (`CreateMeetingFormV2`) — читает
  `?cardId=` из URL, показывает chip «Карточка: <name>», передаёт
  `card_id` в `meetingsApi.create`.

### UI-компоненты
- `frontend/src/ui/components/cards/CreateCardDialog.tsx` — модалка создания.
- `frontend/src/ui/components/cards/CardChat.tsx` — RAG-чат по карточке
  (history + send + цитаты-чипы на встречи).
- `frontend/src/ui/components/command-palette/CommandPalette.tsx` — ⌘K/Ctrl+K
  глобальная палитра поиска (cmdk + searchApi). Монтируется в `AppShell`.

### Sidebar
- `Sidebar.tsx` — добавлен пункт меню «Карточки» (иконка `FolderKanban`).

## DB-модели (новые)

### `Card`
- Один primary-контакт полями (`contactName/Email/Phone`).
- `Meeting.cardId` (one-to-many, `onDelete: SetNull`).
- Soft-delete с 30-дневным grace.
- `summaryCache` + `summaryUpdatedAt` — кэш AI-rollup.
- Денорм. `meetingCount`, `lastMeetingAt`.

### Расширения
- `Meeting.cardId String?` + индекс `[cardId, createdAt]`.
- `MeetingChatMessage.cardId String?` + индекс `[cardId, createdAt]`.

## Knowledge-core (Фаза 4 — 2026-05-10)

### Расширения `Card`
- `entityId String?` — primary-сущность карточки (FK на `Entity`, `onDelete: SetNull`).
- `relatedEntityIds String[] @default([])` — список дополнительных сущностей.
- `bornFromThemeId String?` — если карточка создана из Theme через
  `POST /api/v1/knowledge/themes/:id/save-as-card`.
- `cachedTopThemeIds String[] @default([])` — кэш топ-3 связанных тем
  (заполняет `card-rollup-v2.worker`).
- Индексы: `@@index([entityId])`, `@@index([bornFromThemeId])`.

### Card-rollup-v2 (новый воркер, параллельно со старым)
- `backend/src/modules/knowledge-core/services/card-rollup-v2.service.ts` —
  собирает блоки карточки через **встречи** (`RawEvent.sourceExternalId`) +
  через **сущности** (`IdeaBlockEntity.entityId IN (Card.entityId ∪ Card.relatedEntityIds)`),
  фильтр `status='canonical'`, top 50 по `updatedAt DESC`. Топ-3 темы — из
  `ThemeIdeaBlock` по подсчёту блоков.
- `backend/src/modules/knowledge-core/workers/card-rollup-v2.worker.ts` —
  consumer очереди `core.card-rollup-v2`. Concurrency=2.
- 5 промптов по `Card.kind` (client/deal/project/topic/custom) — все
  возвращают plain-текст (без markdown).
- Дебаунс: `CoreQueueService.enqueueCardRollupV2(cardId)` с
  `delay = CARD_ROLLUP_V2_DEBOUNCE_MS` (60s по умолчанию), `jobId='card_rollup_v2_<cardId>'`.
- **Старый `card-rollup.worker` живёт параллельно** — переключение pipeline'а
  на v2 запланировано в Фазе 5/6.

### API (новые)
- `GET /api/v1/cards/:id/themes` — топ-3 темы для карточки (через её блоки).
  Возвращает `{ items: [{ id, name, description, branch, blocksInCommon }] }`.
- Связанные эндпоинты themes — см. [[themes]].

Все модели — в [`backend/prisma/schema.prisma`](../../backend/prisma/schema.prisma).
Применение схемы — версионируемые миграции (`bun run prisma:migrate`); `db push` — только для черновых локальных проб (см. [prisma-db-push-rules](../../.claude/skills/prisma-db-push-rules/)).

## Что осознанно НЕ сделано (vNext)

- Несколько контактов на карточку (отдельная таблица `CardContact`).
- Привязка встречи к нескольким карточкам (м-к-м pivot).
- Auto-suggest «прикрепить к Ивану?» через LLM — выкинуто по решению владельца:
  привязка только явная.
- LLM-угадывание участников / Smart Folder rules с DSL.
- Pinned/Recent секции в sidebar — пока только пункт меню. UI расширяется при росте.
- Импорт карточек из CSV / интеграция с внешними CRM.
- Sentiment / прогресс-метрики по карточке (для психолога: динамика жалоб).

## Источники

- ТЗ: [plans/archive/2026-05-09-cards.md](../../plans/archive/2026-05-09-cards.md)
- Базовое ТЗ: [plans/archive/2026-05-09-standalone-product.md](../../plans/archive/2026-05-09-standalone-product.md)
- AI Workspace: [plans/archive/2026-05-09-ai-meeting-workspace.md](../../plans/archive/2026-05-09-ai-meeting-workspace.md)
