---
title: Реализация CRM-карточек (Cards) и большой коммит накопленных ТЗ
date: 2026-05-10
distilled: false
---

# 2026-05-10 — Cards: от ТЗ через 3 итерации до полной реализации + коммит накопленного

## Что было поставлено

Параллельно с другой работой по сегодняшнему ТЗ обсудить с пользователем
расширение продукта Z идеей «истории встреч/чата по клиенту/теме». В итоге —
оформить ТЗ и реализовать его целиком через subagent/параллельные потоки,
а в конце сессии закоммитить и запушить накопленное в ветку `dev`.

## Как решал

### 1. Брейншторм и три итерации ТЗ

- Сначала предложил универсальный «Thread» (контейнер для связанных встреч)
  с auto-suggest через LLM и Smart Folder Rules. Описал риски и связь с LLM
  «простым языком» — пользователь получил картину «что делает AI и где
  безопасно».
- Пользователь скорректировал: «не надо автоматического угадывания, давайте
  CRM с карточками — встречу делаю физически из карточки, и она туда
  подтягивается». Перевёл ТЗ полностью на CRM-модель.
- Уточнил 4 вопроса (один контакт vs много, м-к-м vs one-to-many, AI rollup
  оставлять, имя сущности). Получил решения: один primary-контакт,
  one-to-many, AI rollup оставляем, «карточка» нормально.
- Полностью переписал ТЗ: [`plans/tz/2026-05-09-cards.md`](../../plans/tz/2026-05-09-cards.md).
  Старый файл `2026-05-09-people-folders-smart-organize.md` удалил.

### 2. Реализация по 12 фазам

Все 12 фаз ТЗ выполнил последовательно сам, с использованием TodoWrite для
отслеживания. Ключевые места:

**Backend:**
- Prisma модель `Card` + расширения `Meeting.cardId` (FK SetNull) +
  `MeetingChatMessage.cardId`. `bun prisma db push`.
- `modules/cards` (controller + service + repo + DTO) с link/unlink через
  `SELECT ... FOR UPDATE` и идемпотентным unlink.
- AI-pipeline: `card-rollup.service.ts` + `card-rollup.worker.ts` с дедуп
  через `jobId = "rollup:card:<cardId>"` + `delay: 5_000`. Промпты в
  `prompts/card-rollup.ts` (5 вариантов по `kind`). Триггеры из
  `analyze.worker` (после `ai_ready`), `regenerate.service.ts`,
  `cards.service.ts` link/unlink.
- Chat: расширил `ChatService.askCard` с RAG-фильтром по `Meeting.cardId`,
  `searchSimilarChunksByCard` через `prisma.$queryRawUnsafe`.
- Search-модуль для `⌘K` с Postgres ILIKE.
- Public REST API `cards.public.controller.ts` под Bearer-auth (read/write
  scopes). Webhook events: `card.created/updated/deleted`,
  `meeting.linked_to_card/unlinked_from_card`. Audit-константы. Метрики.

**Frontend:**
- Sidebar пункт «Карточки», страницы `/cards` и `/cards/[id]` (timeline +
  rollup-сайдбар + AI-чат). `CreateCardDialog`, `CardChat`, `CommandPalette`
  с `⌘K`/`Ctrl+K` хоткеем.
- `CreateMeetingFormV2` читает `?cardId=` из URL, передаёт в
  `meetingsApi.create` через `card_id`, показывает chip-индикатор привязки.
- Все мои файлы прошли `tsc --noEmit` без ошибок (backend и frontend).

**Тесты:**
- Юнит-тест `card-kind.spec.ts` на zod-схему / hex-regex (4 теста, все
  прошли через `bun run vitest run src/modules/cards/dto/card-kind.spec.ts`).

### 3. Инфраструктурный фикс — pgvector

При первом `bun prisma db push` поймал `extension "vector" is not available` —
postgres alpine не включает pgvector. Перевёл `docker-compose.yml` на
`pgvector/pgvector:pg16`, пересоздал volume (данных не было), добавил
`CREATE EXTENSION IF NOT EXISTS vector`, потом применил
`backend/scripts/postgres-init.sql` для HNSW-индекса. Это позволило не
только мою фичу заработать, но и pgvector-функциональность из AI Workspace
(которая лежала в working tree коллеги без возможности применения).

### 4. Коммит и пуш

Когда дошло до коммита — обнаружил, что в `git status` помимо моей работы
лежит **огромная масса параллельной работы коллеги** (AI Meeting Workspace,
standalone product, in-meeting chat — все помечены как реализованы 2026-05-09,
но не закоммичены). Это ~370 untracked файлов + ~70 modified, моя работа —
малая часть.

Я остановился, объяснил пользователю ситуацию и предложил три варианта.
Пользователь выбрал «коммитим всё, игнорируем правила про only-mine» — это
явное разрешение. Сделал один большой `feat`-коммит со всем содержимым
рабочего дерева:

- Hash: `e85e0ef`
- 426 файлов, 44848 insertions, 1714 deletions.
- Сообщение разбито по 4 ТЗ (AI Meeting Workspace, standalone product,
  in-meeting chat, Cards).
- `git push origin dev` прошёл: `9bc927b..e85e0ef  dev -> dev`.

## Что вышло

- ТЗ [`plans/tz/2026-05-09-cards.md`](../../plans/tz/2026-05-09-cards.md)
  закрыт (`status: done`), раздел «Итог» заполнен.
- Second-brain: новый [`01_projects/cards.md`](../01_projects/cards.md),
  расширение [`02_architecture/data-model.md`](../02_architecture/data-model.md),
  обновление [`index.md`](../index.md).
- Все 12 фаз реализованы. typecheck backend + frontend без ошибок,
  один юнит-тест проходит.
- Коммит запушен в `origin/dev`.

## Чему научился

1. **Спрашивать про границы коммита, когда working tree не моё.** При
   масштабной параллельной работе (когда коллега не закоммитил большой
   объём за день) правило «только своё» физически неприменимо — мои
   изменения встроены в чужие файлы. Правильно — спросить пользователя
   до `git add`. Я это сделал, и хорошо.

2. **pgvector не в alpine-Postgres.** Если в схеме есть
   `extensions = [pgvector(map: "vector")]`, а docker-compose использует
   `postgres:16-alpine`, `bun prisma db push` падает с `extension not
   available`. Готовый образ — `pgvector/pgvector:pg16`. Этот факт стоит
   занести в [`02_architecture/code-pitfalls.md`](../02_architecture/code-pitfalls.md).

3. **CRM-структура — конкретный сигнал «не используем LLM для решений».**
   Пользователь специально потребовал убрать LLM auto-suggest и smart-rules
   («тут не нужно никакого LLM»). Привязка только явная — встреча создаётся
   из карточки или прикрепляется руками. Это упростило дизайн и убрало
   класс рисков. AI остался только в безопасных режимах: rollup-сводка
   (читает summary, пишет 2 абзаца) и RAG-чат (отвечает с цитатами).
   Принцип, который применять во всех будущих фичах: **AI не принимает
   решений — пользователь подтверждает**.

4. **Дебаунс через BullMQ jobId — правильный паттерн для серий событий.**
   `jobId = "rollup:card:<cardId>"` + `delay: 5_000` — повторные постановки
   в окне 5 секунд игнорируются. Сэкономит LLM-вызовы при импорте
   нескольких встреч за минуту.

5. **`SELECT ... FOR UPDATE` через `prisma.$queryRaw` + `Prisma.sql`** —
   единственный способ избежать race-condition на конкурентный link
   встречи к двум разным карточкам. Стандартный `update` Prisma не лочит
   строку.

6. **Универсальный CommandPalette на `cmdk` + debounce 200ms** даёт нужную
   плотность UX для CRM при росте до 100+ карточек/встреч/задач без всякого
   ts_vector — Postgres ILIKE справляется, а HNSW не требуется.

## Что отложено (vNext)

Зафиксировано в «Итоге» ТЗ:

- UI-чип «Карточка: <name>» на странице результата встречи и кнопка
  «Прикрепить к карточке» — backend уже возвращает `cardId`, осталось
  только нарисовать.
- Фильтр-чип `Карточка` в журнале как UI-элемент (URL-параметр уже работает).
- Pinned/Recent секции в sidebar — пока только пункт меню.
- Несколько контактов на карточку (`CardContact` таблица).
- Привязка встречи к нескольким карточкам (м-к-м pivot).
