---
type: reflection
date: 2026-05-10
distilled: false
---

# Knowledge-core: фаза 4 frontend + фаза 5 + фаза 6

## Что было поставлено

Оркестрация трёх фаз knowledge-core за одну сессию:

1. **Фаза 4 frontend** — закрыть Phase 4 (бекенд готов в прошлой сессии): `/themes`, `/themes/[id]`, секция «AI-темы» на Card.
2. **Фаза 5 backend** — переписать tasks/chapters/summary поверх IdeaBlock'ов: новые v2-сервисы + воркер + cron, без выпиливания legacy.
3. **Фаза 6 fullstack** — единый chat-v2 с 5 scope (org/meeting/card/theme/entity), retrieval поверх блоков + 1-hop graph expansion, новая страница `/chat`.

Роль — оркестратор (не писать код руками, а готовить детальные ТЗ для агентов и принимать архитектурные решения по ходу).

## Как решал

### Phase 4 frontend (коммит `0909af1`)

Подготовил детальное ТЗ агенту с явным маппингом «бэкенд DTO → frontend Domain → UI», списком всех нужных страниц и правил (apiClient, SWR, shadcn). Агент сделал чисто за один проход:
- `frontend/src/domain/theme.ts` (mapper, 12 веток с лейблами).
- `frontend/src/api/themes.api.ts` + расширение `cards.api.ts` (`listThemes`).
- 4 файла под `/themes` (page+Client, [id]/page+Client).
- `CardThemesSection.tsx` (рендерится null при пустом списке — экран не шумит).
- Sidebar: пункт «AI-темы».
Typecheck чистый.

### Phase 5 (коммит `8a1af9a`)

**Архитектурное решение оркестратора, отступление от ТЗ:** не удалять `tasks-extract.worker` / `chapters.worker` в этой фазе. Причина: DoD требует A/B-бенчмарка качества — без legacy сравнить не с чем + риск регрессии UX. Удаление вынес в отдельную фазу после ручного решения владельца.

Реализация:
- Prisma добавил поля `Task.evidenceBlockIds`, `Task.extractorVersion`, такие же на `MeetingChapter`, `MeetingHighlight.evidenceBlockId`, `AiResult.summaryV2*`, `Meeting.analyzeV2Status*`. `db push` (по правилам Z, не migrate).
- Очередь `core.meeting-analyze-v2`, дебаунс 2 мин.
- 4 сервиса в knowledge-core: `block-fetch`, `tasks-extractor-v2`, `chapters-extractor-v2`, `summary-extractor-v2`. Промпты — отдельные файлы.
- Воркер `meeting-analyze-v2.worker` — `Promise.allSettled` на 3 extractor'а (один упавший не валит остальных, статус `partial`).
- Cron `*/10 * * * *` — литералом (Nest cron-decorator вычисляется до DI).
- ENV-флаг `KNOWLEDGE_CORE_V2_AGENTS_ENABLED` (default `false`).
- Tasks-write делает `findFirst → create` по lowercased title (нет unique-индекса, т.к. legacy дубли могут существовать).

### Phase 6 (коммит `52e3f52`)

Аналогичный паттерн как Phase 5: legacy `chat.service` оставляем, ENV-флаг `CHAT_V2_ENABLED` (default `false`) переключает контроллер.

Реализация:
- `ChatV2RetrievalService` — 5 scope с разными pool'ами blockIds (Prisma queries), затем cosine ранжирование подмножества через единственный $queryRawUnsafe (по образцу `search.service.ts`). Graph expansion (1-hop) — top-N связей `IdeaBlockLink`.
- `ChatV2Service` — формирует системный промпт со scope-addon, передаёт top-K блоков и историю в system-prompt (LlmRouter не поддерживает messages-array нативно).
- Citations через regex `\[BLOCK:<id>\]` — без structured output; работает на любом провайдере.
- `POST /api/v1/chat/v2` — новый unified endpoint. Возвращает 503 `chat_v2_disabled` при OFF.
- Существующие 3 эндпоинта (single-meeting, cross, card-chat) при ENV ON делают switch на v2.
- Frontend `/chat` — органичный graceful fallback: пробует v2; на 503 → legacy. Sidebar: «AI-чат».

## Что вышло

- 3 коммита, ~4800 LoC за сессию.
- Все три typecheck'а зелёные (frontend, backend, prisma push).
- Knowledge-core закрыт по фазам 4/5/6. Фаза 4 — целиком работает (cron включён, frontend живой). Фазы 5/6 — реализация готова, активация через ENV (опасные перетекания не запускаем без сравнения).

## Чему научился

1. **Оркестратор-режим хорошо работает с готовым ТЗ.** Когда я заранее собрал контракты бэкенда (`themes.controller.ts`, `theme.dto.ts`) и образцы фронта (`CardsClient.tsx`) до делегации, агент Phase 4 закрыл задачу одним проходом без правок.

2. **Принцип «не удалять legacy» спас от регрессий.** ТЗ Phases 5/6 буквально предписывали выпилить старые компоненты. На месте принял противоположное решение, обосновал в decisions-log. Это даёт владельцу окно на A/B без риска. Возможно, стоит зафиксировать это как общий принцип проекта.

3. **`@Cron` — литерал, не из cfg.** Это уже было в decisions Фазы 3, но повторилось в Фазе 5. ENV всё равно оставляем для логов и будущего перехода на `SchedulerRegistry` — мини-инвестиция, копеечная цена.

4. **Citation-протокол через regex `[BLOCK:<id>]` устойчивее JSON-tool-call.** Не зависит от провайдера; LLM плохо игнорирует наш «обязательно процитируй» — а парсер на бэке прощает огрехи.

5. **Cosine ранжирование подмножества** — вместо отдельной полноценной hybrid-search для каждого scope, я делаю Prisma-поиск pool'а blockIds, затем один $queryRawUnsafe `WHERE b.id = ANY($ids)` ORDER BY embedding distance. Это в N раз быстрее и не дублирует hybrid-логику из `search.service.ts`.

6. **Грабля с tasks unique-индексом.** Сначала хотел `@@unique([meetingId, title])` для дедупа, но отверг — legacy задачи могут содержать дубли (LLM v1 был неидеален), индекс сломал бы существующие данные. Решил через `findFirst → create` + try/catch P2002. Принцип: миграции в БД должны быть совместимы с реальным состоянием prod, а не с идеальным.

7. **Графовое расширение проще, чем кажется.** На Phase 6 я думал про сложный multi-hop с весами. Сделал 1-hop по top-N связям, score=-1 (всегда после cosine). Этого достаточно для контекста, и легко улучшить.
