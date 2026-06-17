---
type: analysis
status: research-complete
feature: umbrella-sequencing-six-tz-2026-06-17
date: 2026-06-17
owner: sergrv80 (владелец Z)
relates_to:
  - plans/tz/2026-06-17-cora-feed-into-dashboards.md
  - plans/tz/2026-06-17-fix-incomplete-setup-banner-progress.md
  - plans/tz/2026-06-17-intake-issue-linked-meeting-ids-fix.md
  - plans/tz/2026-06-17-probe-system-phase2-completeness.md
  - plans/tz/2026-06-17-cabinet-breadcrumbs-and-mobile-back.md
  - plans/analysis/2026-06-17-probe-system-completeness.md
---

# Зонтичный план: порядок реализации 6 документов от 2026-06-17

> **Назначение:** это не новое ТЗ, а **мета-план очерёдности** для пяти готовых ТЗ
> и одной аналитики, написанных 2026-06-17. Отвечает на вопрос владельца «какой
> первый, какой второй, чтобы логически легли». Код не пишется — это подготовка к
> реализации. Построено независимым чтением всех 6 документов + кода **и**
> многоагентной верификацией (11 суб-агентов, состязательное ревью, 2026-06-17).

## 1. Состав набора

| Док | Тип | Слой | Объём | Риск | Прод-операции | Готовность |
|---|---|---|---|---|---|---|
| **A** [fix-incomplete-setup-banner-progress](../tz/2026-06-17-fix-incomplete-setup-banner-progress.md) | ТЗ | фронт, **1 файл** | S | низкий | нет | ready |
| **B** [intake-issue-linked-meeting-ids-fix](../tz/2026-06-17-intake-issue-linked-meeting-ids-fix.md) | ТЗ | бэк: схема+сервисы+backfill | S–M | низкий | миграция + backfill | ready |
| **C** [cora-feed-into-dashboards](../tz/2026-06-17-cora-feed-into-dashboards.md) | ТЗ | фронт | S–M | низкий | нет | ready |
| **D** [cabinet-breadcrumbs-and-mobile-back](../tz/2026-06-17-cabinet-breadcrumbs-and-mobile-back.md) | ТЗ | фронт: каркас + ~15 страниц | M | низкий | нет | ready |
| **E** [probe-system-phase2-completeness](../tz/2026-06-17-probe-system-phase2-completeness.md) | ТЗ | бэк: LLM + pgvector, **6 фаз** | L | средний | миграция + индекс + seed + smoke | ready |
| **Φ** [probe-system-completeness](2026-06-17-probe-system-completeness.md) | **анализ** | — (read-only) | — | — | нет (кода не пишет) | research-complete |

Ключевой факт: **граф зависимостей разреженный**. Из 6 документов реальное жёсткое
ребро ровно одно. Остальное — независимые точечные работы. Поэтому план — это не
линейная очередь, а **три почти не связанных потока + один read-only артефакт** с
единственной точкой синхронизации на выкате.

## 2. Граф зависимостей между документами

```
Φ (анализ probe) ──hard──▶ E (probe-phase2)      жёсткое: нельзя кодить E
                                                  до фиксации решений Q1–Q4 из Φ

D (breadcrumbs) ──soft──▶ C (cora-feed)           мягкое: сначала каркас навигации,
                                                  потом контент-виджет в дашборд

A (banner)        — независим, никого не блокирует, никем не блокируется
B (intake-fix)    — независим, никого не блокирует, никем не блокируется
```

- **Φ → E (hard).** Аналитика `probe-system-completeness` выводит весь scope E
  (gap-таблица G1–G7) и фиксирует решения владельца Q1–Q4: answer-first исключён,
  свободный ответ через `dialog-classify` (интент `probe_reply`), ровно один re-ask,
  статистику не ждём. Без этих развилок E реализуется **не по тому контракту**
  (например, добавят answer-first или второй переспрос). Φ кода не пишет — её
  «исполнение» = прочитать ДО первой строки кода E.
- **D → C (soft).** Оба фронтовые. D ставит общий навигационный каркас (chrome) в
  `AppShell`/`Header`/`AuthenticatedShell`; C вставляет контент-виджет в
  `DirectorDashboardClient`/`MeClient`. Файлы почти не пересекаются — это предпочтение
  очерёдности, не блокер. Можно и параллельно на одной фронт-ветке.
- **A, B — независимы.** Ни один не создаёт данных/полей/UI, которые потребляют
  другие документы. Важно (перепроверено по коду): **B НЕ кормит ленту C** — intake-fix
  наполняет `Issue.linkedMeetingIds` для секции «Задачи» карточки встречи
  (`MeetingActionItemsService.listForMeeting`), а C читает независимый
  `GET /feed/cora`, где `linkedMeetingIds` не встречается. Классической ошибки
  «фича показывает поле раньше, чем фикс его заполнил» здесь нет.

## 3. Карта пересечений по файлам (где реально столкнутся)

Логических коллизий бизнес-логики нет. Все пересечения — **текстовые add/add-мержи
в общих реестрах** и общий каталог фронта. Разрешаются тривиально, но при параллельных
ветках конфликт неизбежен.

| Зона | Кто делит | Риск | Природа |
|---|---|---|---|
| `backend/scripts/apply-prod-deploy.ts` (массив `STEPS`, :45; seed :66; backfill :355) | B (backfill) + E (seed) | low | add/add — обе строки нужны |
| `docs/operations/prod-deploy-log.md` (раздел «🚨 Накоплено к выкату») | B (Шаги 4/8) + E (Шаги 4/5/7/12) | low | add/add в один список |
| `docs/operations/feature-flags.md` | E (4 kill-switch + 3 крутилки `probe.*`) | low | B флаг не вводит → почти нет |
| `backend/prisma/schema.prisma` | B (`IntakeIssue` ~9567, `Issue` ~9073) + E (`ProbeEvent` ~6485) | low | **разные модели, далёкие регионы** — текстового конфликта почти нет |
| `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx` | C (**пишет** виджет) + A (**только читает** как образец `getSetupProgress`, :223) | none-low | A файл НЕ редактирует — write/write-конфликта нет |
| `frontend/app/(authenticated)/me/MeClient.tsx` | C (пишет виджет) | none | D его не трогает |
| `frontend/src/ui/components/app-shell/*`, `nav-subset.spec.ts` | D (`AppShell`/`Header`) + C (правит `nav-subset.spec.ts`, удаляя `/feed`) | low | разные строки одного каталога |

**Внимание — `seed-admin-settings.ts`** уже содержит 10 ключей `probe.*`; E дополняет
секцию (не создаёт файл заново).

## 4. Единый порядок реализации (если делать последовательно)

Порядок rank 1→5 уважает оба ребра графа и ставит дешёвые изолированные фиксы вперёд
тяжёлого probe-трека. Аналитика **Φ** — не код, а блокирующее предусловие для шага 5.

> **Предусловие шага 5 (Φ).** Перед стартом E исполнитель **обязан прочитать**
> `probe-system-completeness` и зафиксировать решения Q1–Q4. Не параллельно с кодингом —
> ДО первой строки Ф1.

1. **A — `fix-incomplete-setup-banner-progress`** (баннер «N из 6»).
   Самый дешёвый и изолированный: один файл `IncompleteSetupBanner.tsx`, бэк-контракт
   `GET /orgs/:orgId/setup-progress` уже готов и проверен (QA B6, 2026-06-15), миграций/
   решений владельца/прод-операций нет. Чинит видимую ложь владельцу («0 из 6» при
   реально заведённых отделах). Быстрая победа.

2. **B — `intake-issue-linked-meeting-ids-fix`** (задачи встречи не видны в карточке).
   Фундаментальный backend data-фикс ядра: под включённым в проде флагом
   `knowledge.meetingTasksToTrackerOnly` задачи создаются, но не показываются, потому что
   `meetingId` не пробрасывается в `Issue.linkedMeetingIds`. Принцип «чинить фундамент до
   надстройки». Изолирован в `tracker/`. **Его версионируемая миграция
   `add_intake_issue_meeting_id` — эталон механики и для E** (см. §6). Идёт раньше E,
   чтобы первым занять общие реестры маленьким диффом.

3. **D — `cabinet-breadcrumbs-and-mobile-back`** (хлебные крошки + мобильная «назад»).
   Фронтовый каркас навигации для всей `(authenticated)`. Перед C по soft-ребру:
   сначала стабилизировать общий shell (`AppShell`/`Header`), чтобы вставка виджета
   ленты шла по зафиксированной навигации. Флаг не нужен (Ship-On, откат = revert).

4. **C — `cora-feed-into-dashboards`** («Лента Коры» в дашборды, удалить `/feed`).
   Фронтовая фича-надстройка поверх каркаса D. Бэкенд/API не трогает.
   **Нюанс удаления (по ревью):** убрать ТОЛЬКО `feed/page.tsx` и `feed/FeedClient.tsx`.
   Сиблинги `feed/insights`, `feed/probe-questions`, `feed/spotlights` — **живые,
   остаются**; приёмочный греп искать **точное концевое** совпадение `href '/feed'`,
   а не префикс `/feed` (иначе заденет сиблинги).

5. **E — `probe-system-phase2-completeness`** (доведение probe-системы, Ф1–Ф6).
   Самый тяжёлый и рискованный (effort L, 6 фаз, новый `taskType probe-quality-judge`,
   расширение `dialog-classify`, оба бот-адаптера, `llm-router`, pgvector-колонка
   `ProbeEvent.questionEmbedding` + HNSW-индекс, 4 kill-switch + 3 крутилки).
   Внутри `probe/` высокая связность (Ф4↔`probe.service`, Ф2/Ф3/Ф5↔`dispatcher`+`cron`,
   Ф5 от Ф2, Ф6 после Ф2) — **вести одним исполнителем строго фазово, не распараллеливать
   внутри**. Последним, потому что автономен в коде, но занимает общие реестры позже.

## 5. Параллельный вариант (если есть ресурс на fan-out)

Те же документы раскладываются на **три ветки**, запускаемые одновременно:

- **Поток A (backend probe):** Φ (прочитать Q1–Q4) → E. Изолирован в
  `probe/` + `dialog-layer` + conversational-адаптеры + `llm-router`. Старт E **только
  после** фиксации Q1–Q4. Не дробить `probe/` между агентами.
- **Поток B (backend tracker):** intake-fix (B). Изолирован в `tracker/` + backfill.
- **Поток C (frontend):** banner (A) + breadcrumbs (D) на одной фронт-ветке (разные
  файлы), затем cora-feed (C) поверх.

Волны:
- **Волна 0** — прочитать Φ (предусловие потока A).
- **Волна 1** — параллельно: A-стартует E · B · C (banner+breadcrumbs).
- **Волна 2** — cora-feed на ветке C поверх каркаса.
- **Волна 3** — координация выката (см. §6): ручной мерж реестров A↔B + единый канал
  миграций; intake-backfill ПОСЛЕ деплоя кода.

## 6. Сквозные риски и обязательные согласования

1. **🔴 Единый канал миграций (обязательное согласование, не просто риск).**
   ТЗ **E** в исходнике предписывает катить колонку `ProbeEvent.questionEmbedding` через
   `prisma:push` / «штатный механизм схемы» (НЕ `migrate`). Это **прямо противоречит
   методологии Z** (с 2026-06-05 любое изменение БД = версионируемая миграция;
   `db push` только для некоммитимых проб) и сосуществует на одном выкате с
   `prisma:migrate` из **B** → «двойная механика схемы», чувствительная к baseline-логике
   Prisma (`ensureBaseline`). **Решение:** привести колонку E к версионируемой миграции
   (как `add_intake_issue_meeting_id` у B), оставив в `postgres-init.sql` **только**
   HNSW-индекс `idx_probeevent_qembed_hnsw` (он не выражается в `schema.prisma`).
   → Поправить этот пункт в ТЗ E перед стартом Ф4.

2. **Реестровый add/add-мерж** (`apply-prod-deploy.ts` `STEPS`, `prod-deploy-log.md`,
   `feature-flags.md`) между потоками A (probe) и B (intake). Нужны ВСЕ строки, ничего
   не выкидывать. B (маленький дифф) занимает реестры раньше A.

3. **Не дробить `probe/`** между параллельными агентами — внутрифазовая связность
   ломает `probe.service`/`dispatcher`/`cron`. Один исполнитель, строго Ф1→Ф6.

4. **Объединённый фронт-билд.** banner+breadcrumbs+cora-feed на одной ветке делят
   `DirectorDashboardClient` (A не пишет → ок) и каталог `app-shell`/`nav-subset.spec.ts`.
   Финальный `typecheck/lint/build/test:unit` (особенно `nav-subset.spec.ts` после
   удаления `/feed`) гонять на **объединённой** фронт-ветке, не пофайлово.

5. **Новый `taskType probe-quality-judge`** — исторически в Z `taskType` терялись в
   реестре (3 ранее). Обязательны seed-route (`deepseek-v4-flash → gpt-5.4-mini →
   ollama`) и smoke (Шаг 12); проверить, что не уходит в DEFAULT-цепочку.

6. **Ship-On для probe:** 4 kill-switch выкатываются ВКЛЮЧЁННЫМИ — каждый должен реально
   работать при ON и иметь корректный fallback при OFF; все → строки в `feature-flags.md`.

7. **Параллельные сессии Claude Code** (известная грабля Z): `git fetch` + `git log
   --since=1h` перед каждой волной; явный `git add` по путям, без `git add .`/`-A`.

8. **Агенты могут отметить `[x]` без правок:** после каждого исполнителя грепать маркеры
   (`linkedMeetingIds` в `issues.service`; `probe_reply` в `classify.prompt`;
   `CoraFeedWidget`; `buildBreadcrumbTrail`; `questionEmbedding` **в миграции**, а не
   только в push) и `git status` до commit; re-Read после каждого Edit.

## 7. Прод-операции по документам (сводка)

| Док | schema | postgres-init | seed | backfill | ENV | smoke | Деплой |
|---|---|---|---|---|---|---|---|
| A | — | — | — | — | — | — | сборка frontend |
| B | миграция `add_intake_issue_meeting_id` (Шаг 4) | — | — | `backfill-meeting-linked-ids` (Шаг 8) | — | — | `docker compose up -d --build backend` + backfill после |
| C | — | — | — | — | — | — | сборка frontend |
| D | — | — | — | — | — | — | сборка frontend |
| E | миграция `ProbeEvent.questionEmbedding` (Шаг 4, **через migrate — см. §6**) | HNSW `idx_probeevent_qembed_hnsw` (Шаг 5) | `probe.*` + route `probe-quality-judge` (Шаг 7) | не нужен (окно 72ч наполнится) | предпочт. нет | `probe-quality-judge` (Шаг 12) | `docker compose up -d --build backend` |

## 8. Итог

- **Рекомендуемый порядок (последовательно):** A → B → D → C → E; перед E прочитать Φ.
- **Если fan-out:** 3 ветки (A-probe / B-intake / C-frontend), одна точка синхронизации
  на выкате (§6.1–6.2).
- **Состояние:** все 5 ТЗ — `ready-to-implement`; единственная правка контракта до старта —
  единый канал миграций для E (§6.1). Реализация **не начата** — ждёт явного
  «начни реализацию».

_(Заполнить по факту: что взято в работу, в каком порядке, отклонения.)_
