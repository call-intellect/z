---
date: 2026-05-24
type: reflection
session: wave2-backend + phase2-frontend
distilled: false
---

# Wave 2 backend (Activity Feeds + Helpfulness + Recognition) + Phase 2 frontend (канбан DnD + PWA)

## Что было поставлено

После закрытия Sprint 3 finishing (3 коммита + рефлексия) — Wave 2 backend (4 потока) + Phase 2 frontend (2 потока):

- **α-5 DialogService** (Поток B Wave 2) — Agent 18 (~120 мин планировался).
- **Activity Feeds** (Поток D Wave 2) — Agent 15 (~90 мин).
- **Specialist 3.8 Helpfulness** (Поток D Wave 2) — Agent 16 (~90 мин).
- **Recognition + Gamification** (Поток D Wave 2) — Agent 17 (~60 мин).
- **`/me/inbox` + `/states` endpoints** (frontend Wave 2 prerequisite) — Agent 19 (~30 мин).
- **Канбан drag-n-drop + Bottom nav + useStates/useMyInbox real** (Поток A Wave 2 frontend) — Agent F1 (~75 мин).
- **PWA: manifest + service worker + push subscription UI** (Поток A Wave 2 frontend) — Agent F2 (~45 мин).

## Как решал

### Шаг 1 — обязательная разведка перед запуском (главный урок)

`grep "DialogLayer|ContextualizerService|MultiQueryExpansion"` → 44 файла в `backend/src/modules/dialog-layer/`. Полная реализация α-5 DialogService уже была:
- Module @Global с providers: ContextualizerService, ConfidenceEstimatorService, QueryClassifierService, MultiQueryExpansionService, AnswerCacheService, RetrievalCacheService, DialogService, CacheInvalidationService, ConversationSummarizerCron.
- Mode-specific prompts factual/synthetic/clone_style в chat-v2.
- 5 LlmTaskType реализованы и зарегистрированы в LlmRouterService.
- Tests + spec файлы для каждого сервиса.
- DialogService импортирован в `chat-v2.service.ts` как препроцессор.

**Решение:** Agent 18 НЕ запускался. 6-й случай за 2 сессии когда `grep "ClassName" backend/src/` экономит часы работы агента (после α-4, β-5, γ-1 в прошлой сессии и tracker-как-источник в Sprint 3 + ещё пара случаев).

Параллельно разведка Activity Feeds/Helpfulness/Recognition — все три ресурса в коде отсутствовали (моделей в schema.prisma нет, сервисов нет). Чистая работа.

### Шаг 2 — добавление 9 Prisma моделей единым коммитом

Wave 2 sub-ТЗ требовали 9 новых моделей в schema.prisma. Чтобы избежать race condition между 3 параллельными агентами:

1. Прочитал sub-ТЗ детально (`grep "^model "` по каждому из 3 sub-ТЗ файлов).
2. Один коммит `d8103b4` добавил 9 моделей разом + расширение IssueComment.thanksUserIds:
   - ActivityFeedItem + ActivityFeedSubscription (Activity Feeds)
   - HelpfulnessTrait (с pgvector embedding 1536) + SocialContributionProfile + HelpfulnessSpotlight
   - Recognition + Badge + UserBadge + ContributionSnapshot
3. `bun run prisma:push` ✓ (541 ms), `bun run prisma:generate` ✓, `bun run typecheck` ✓.

После этого 3 агента работали только в своих новых модулях — нулевая вероятность race на schema.prisma.

### Шаг 3 — параллельный запуск Agent 15-17 + Agent 19

Промпты явно требовали:
- РАЗВЕДКА через grep перед стартом.
- НЕ трогать app.module.ts (оркестратор соберёт в общем коммите).
- НЕ трогать policies/policy.csv (только сообщить нужные строки).
- ЭТИЧЕСКИЕ ЗАЩИТЫ для Helpfulness (3 правила) и Recognition (4 правила).
- Конкретные cron времена + endpoint paths.

Agent 19 запустил параллельно с Wave 2 (Agent 15-17) — он работает в существующем tracker module, не пересекается.

### Шаг 4 — typecheck-fixes Activity Feeds

После завершения 4 агентов, общий `bun run typecheck` выявил 2 ошибки в Activity Feeds:
- `feed.controller.spec.ts:32` — `role: 'manager'` (UserRole имеет только 'user'|'admin', Agent 15 спутал с MembershipRole).
- `feed.controller.ts:258` — type predicate `(r): r is string` для MembershipRole-значения.

Исправил сам (~3 минуты) вместо повторного запуска агента — проще.

### Шаг 5 — интеграция AppModule + policy.csv

- `backend/src/app.module.ts` — импорт 3 модулей в правильном порядке (ActivityFeedModule ДО ProbeModule/Helpfulness; HelpfulnessModule ПОСЛЕ ProbeModule; RecognitionModule ПОСЛЕ ActivityFeedModule).
- `backend/src/modules/rbac/policies/policy.csv` — 7 ResourceType (activity_feed_item, helpfulness_trait, social_contribution_profile, helpfulness_spotlight, recognition, badge, user_badge, contribution_snapshot) с правильной матрицей owner/admin/manager + visibility scope.

Общий typecheck ✓, vitest run activity-feed/helpfulness/recognition/tracker — **22 файла / 134 теста passed**.

### Шаг 6 — коммиты Wave 2 backend

- `8c233c4` feat(tracker): GET /me/inbox + /states endpoints (Agent 19) — 11 files, +742.
- `22f8ffc` feat(activity-feed,helpfulness,recognition): Wave 2 backend — 3 модуля параллельно + AppModule + policy.csv — 63 files, +10 285.

Push `d8103b4..22f8ffc dev -> dev`.

### Шаг 7 — Wave 2 frontend (параллельные Agent F1 + F2)

Зависимости установил сам ДО запуска агентов:
```bash
cd frontend && bun add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

Это снимает race на frontend/package.json между F1 и F2.

Параллельный запуск:
- **Agent F1** — `frontend/src/ui/tracker/Board.tsx` (DnD), `TrackerBottomNav` mount в AppShell, `useStates` (новый), `useMyInbox` real (переписать stub), `useTrackerLiveRefresh` extension для me.inbox префикса.
- **Agent F2** — `frontend/app/manifest.ts`, `public/sw.js`, `public/icons/*.svg`, `src/lib/pwa/*`, push subscription UI в settings/notifications.

Файлы пересечения:
- F1: `app/(authenticated)/layout.tsx` (Bottom nav)
- F2: `app/layout.tsx` (root — PWA init + metadata)

Разные файлы. Никакой race.

После завершения: typecheck ✓, lint ✓ (только 1 pre-existing warning в `IdeasListClient.tsx`), test:unit — 2 файла / 14 тестов passed.

### Шаг 8 — коммиты Wave 2 frontend

- `12664ee` feat(frontend,tracker): канбан drag-n-drop + Bottom navigation + useStates/useMyInbox real (F1) — 17 files, +1075/-436.
- `355e339` feat(frontend,pwa): manifest + service worker + push subscription UI (F2) — 13 files, +771.

Push `22f8ffc..355e339 dev -> dev`.

## Что вышло — результаты верификации

| Что | Проверка | Результат |
|---|---|---|
| Backend typecheck после 4 параллельных Wave 2 агентов + интеграция AppModule + policy.csv | `bun run typecheck` | ✓ exit 0 |
| Backend lint на новых файлах | `bun run lint` | ✓ 0 errors |
| Backend tests activity-feed + helpfulness + recognition + tracker | `vitest run` | 22 файла / 134 теста passed |
| Frontend typecheck после 2 параллельных F1+F2 | `bun run typecheck` | ✓ exit 0 |
| Frontend lint | `bun run lint` | ✓ 0 errors (1 pre-existing warning) |
| Frontend test:unit | `bun run test:unit` | 2 файла / 14 тестов passed |
| Git push backend | `git push origin dev` | OK d8103b4..22f8ffc |
| Git push frontend | `git push origin dev` | OK 22f8ffc..355e339 |
| Pre-сессионные untracked файлы | Не закоммичены | ✓ ни одного из 27 не попал |

## Архитектурные решения принятые автономно

### 1. Agent 18 НЕ запускался — α-5 DialogService уже готов

См. Шаг 1. Шестой случай за 2 сессии. Дистиллировать в core-pitfalls.md / feedback memory: **«перед каждым sub-ТЗ — grep `ClassName backend/src/`, минимум 30 секунд»**.

### 2. 9 моделей Prisma — один коммит ДО запуска агентов

Альтернатива (по агенту его модели в schema.prisma) → race на одном файле. Один коммит мной → агенты пишут только сервисы. Workflow дисциплина: координация через schema.prisma делается оркестратором, не агентами.

### 3. ActivityFeedItem.visibility — fallback in-memory фильтр после SQL WHERE

Prisma JSON-фильтр не поддерживает array contains (`@>` оператор). Решение: широкая выборка по `visibility` enum (public_org/team/role/private), пост-фильтр в памяти по `visibilityScope` Json (`{teamIds, roleIds, userIds}`). На MVP допустимо; в Wave 3 — переезд на raw SQL с Postgres `@>`.

### 4. ActivityFeedService — FSM идемпотентен и backward-толерантен

`markSeen` на запись со status='expired' — no-op, не throw. Сервис ленты не должен ронять пользовательскую бизнес-транзакцию из-за устаревшего UI-кэша.

### 5. react() через $transaction + per-user дедуп

Повторное нажатие thanks одним пользователем — no-op, метрика не растёт.

### 6. Recognition.visibility default='private', fromUserId nullable

Никакой автоматической публикации Recognition в Org-уровень. Recognition от AI (fromUserId=null) сохраняется в БД, в ленту НЕ уходит автоматически. Безопасный default для запуска фичи.

### 7. Self-thanks разрешён в массиве, НЕ инкрементит thanksReceived

UX-выбор Agent 17: toggle на свой комментарий работает (массив обновляется), но Recognition не эмитится → ContributionSnapshot не накапливает «искусственный» thanks.

### 8. HelpfulnessTrait — KNN merge через raw SQL `<=> vector_cosine`

Порог `distance < 0.15` (cosine similarity > 0.85), внутри одного `helperUserId` + одного `traitType`. Это **строже** sub-ТЗ (0.82), но даёт уверенный merge без потери разных тем.

### 9. PRIVATE_TRAIT_TYPES set + 6 точек защиты

`{question_unanswered, question_acknowledged_no_action}` упоминается ровно 6 раз в коде (тест проверяет состав):
- `persistTrait` — принудительно `visibility='restricted'`.
- `HelpfulnessSpotlightCron` — берёт только PUBLIC_TRAIT_TYPES.
- `SocialContributionProfileCron` — счётчики только для 5 публичных типов.
- `getProfileForPerson` — фильтр `notIn [...PRIVATE_TRAIT_TYPES]` для коллег.
- `HelpfulnessAdminController.unanswered` — единственное место где видны restricted, защищено `canWrite('helpfulness_trait')`.
- `question_chain_unanswered probe` — `recipientCandidates` только admin/owner.

### 10. RecognitionFormulateWorker — детерминистический fallback без LLM

`recognitionFallbackMessage(type)` — фиксированные шаблоны на ошибку LLM или пустой ответ. Никаких выдумок. Double-idempotency: BullMQ jobId + `findFirst` в worker.

### 11. StrategicAlignmentCron в knowledge-core + новый в goals/ — два независимых сигнала

Sprint 3 finishing: knowledge-core имеет LLM-based `StrategicAlignmentCron` (04:00 UTC, по темам/IdeaBlock). Wave 2 backend: добавлен issue-based `goals/cron/strategic-alignment.cron.ts` (06:00 UTC). Имя класса совпадает, разные модули — NestJS DI разруливает. Семантика разная.

### 12. Канбан DnD: `@dnd-kit/core`, не `@dnd-kit/sortable`

Reorder внутри колонки не нужен — backend хранит только stateId, sortOrder вычисляется отдельно. Использован DnD-Kit core без sortable → проще state machine.

### 13. PWA dev-guard: `NEXT_PUBLIC_PWA_ENABLE_IN_DEV`

SW регистрация в dev по умолчанию ВЫКЛЮЧЕНА. Спасает от типичного breakage: HMR + SW caching → stale chunks. Дополнительно `updateViaCache: 'none'` при регистрации SW — браузер не кэширует сам файл sw.js.

### 14. urlBase64ToUint8Array → ArrayBuffer (не Uint8Array)

`lib.dom.d.ts` ругается на несовместимость `Uint8Array<ArrayBufferLike>` с `BufferSource` для `applicationServerKey`. Возвращаем чистый `ArrayBuffer`.

### 15. Push subscription UI — graceful states без backend

POST `/api/v1/me/push-subscriptions` обернут try/catch `ApiError.code === 'http_404'` → console.warn + TODO. Позволяет проверить полный subscribe-flow (permission prompt + локальная подписка в браузере) ДО готовности backend web-push сервиса.

### 16. Канбан states fallback на category

Если `states` (≥1) → реальные колонки + drop включён. Если states пусто (старый проект до Sprint 3 или ошибка загрузки) → 5 виртуальных колонок по category + drop disabled. Backward-compat сохранён.

## Чему научился (для дистилляции)

1. **`grep ClassName backend/src/` перед каждым sub-ТЗ — must-have.** 6 случаев за 2 сессии (~12+ часов экономии). Reality-deltas документ от 2026-05-22 показал 60-70% Кора v2 готово — реальный код продолжает опережать план.

2. **9 моделей Prisma — один коммит ДО запуска параллельных агентов на модулях.** Координация schema.prisma — ответственность оркестратора, не агентов.

3. **«Не трогать app.module.ts / policies/policy.csv» — гарантия отсутствия race.** Агенты сообщают строки/imports в отчёте, оркестратор интегрирует в общем коммите.

4. **Type predicates с DB-enum типами часто ломаются.** `(r): r is string` для `MembershipRole` — TS считает что string не уже чем MembershipRole. Решение: `.map(String).filter(r => r.length > 0)` без predicate. Дистиллировать в code-pitfalls.

5. **UserRole vs MembershipRole — частая путаница агентов.** Тест с `role: 'manager'` падает потому что `CurrentUserPayload.role` это UserRole (user|admin), а manager — это MembershipRole. Дистиллировать.

6. **PWA dev-guard обязательно.** Без guard SW в dev блокирует HMR (типичный breakage Next.js + SW). `NEXT_PUBLIC_PWA_ENABLE_IN_DEV` + `updateViaCache: 'none'`.

7. **Bun lockfile change при `bun add` → попадает в коммит автоматически.** Не забывать включать `bun.lock` в git add при добавлении frontend зависимостей.

8. **Параллельные frontend агенты — разделяй по layout уровню.** F1 трогает `app/(authenticated)/layout.tsx`, F2 трогает `app/layout.tsx` (root) — разные файлы, нулевая race.

9. **`bunx vitest run <path1> <path2>`** работает с пробелами — несколько путей валидны для одного запуска. Удобнее одного `--dir`.

10. **CRLF warnings на Windows — норма.** Git автоматически конвертирует. Не блокер, не фиксить.

## TODO которые остались (для следующей сессии Wave 3)

### Wave 2 завершение
- **Backend web-push сервис:** POST/DELETE `/api/v1/me/push-subscriptions`, таблица `PushSubscription`, worker `push-sender` через npm `web-push`, VAPID ENV (`npx web-push generate-vapid-keys`).
- **HelpfulnessSpotlight → Recognition bridge:** в HelpfulnessSpotlightCron после spotlight publish → `recognition.enqueueFormulate({ type: 'thanks_helpfulness', contextEntityType: 'helpfulness_spotlight', contextEntityId: spotlightId })`.
- **ActivityFeed → Recognition integration:** в RecognitionFormulateWorker (`visibility ∈ {team, public_org}`) → `ActivityFeedService.publish(...)`.
- **HNSW pgvector index для HelpfulnessTrait.embedding** в `backend/scripts/postgres-init.sql`.
- **Seed LlmTaskRoute для 3 helpfulness taskType** (по примеру `seed-llm-task-routes-recognition.ts`).
- **DailyCheckIn integration** в ContributionSnapshotCron (currentCheckinStreak / longestCheckinStreak).
- **ConversationalService bulk-send** для FeedDigestCron channels.
- **`/me/settings/privacy`** opt-out endpoint для helpfulness + notification preferences для recognition.
- **Toast при ошибке transition** в Board.tsx (нужна стабилизация toast-API).
- **Component-тесты Board.tsx** (нужен `@testing-library/react`).
- **Reorder внутри колонки** канбана (нужен backend endpoint sortOrder).
- **Pagination UI** «Загрузить ещё» в InboxClient.
- **Badge непрочитанных** на иконке «Инбокс» в TrackerBottomNav.

### Wave 3 backend (по приоритетам владельца)
- **β-8 COO Operations Dashboard + DailyCheckIn + PersonalRelation** (Sprint 12 в плане). ⚠ Sentiment чек-инов — БЕЗ ручных кнопок 🟢🟡🔴 (решение владельца 2026-05-24). AI определяет sentiment автоматически.
- **Phase 4 Tracker РФ** — Telegram-бот для задач голосом, email-to-task, 10 шаблонов команд seed, локализация (даты/телефоны/валюта/ИНН/КПП), двусторонний календарь.
- **Phase 5 импорт** — Битрикс24 + Trello + Я.Трекер wizard'ы.
- **γ-2 Concierge Agent** — NL → command parser для Cmd+K + Telegram голоса.
- **α-10 Admin LLM + Unit Economics** — LlmProvider/LlmModel/AiCostDaily/OrgBudgetCap/CurrencyRate (ЦБ РФ), 5 cron'ов. ⚠ ДО старта — унификация admin-групп (admin)/admin/* vs (authenticated)/admin/*.

### Phase 2 frontend Wave 2 (отдельный поток)
- **Чат-в-задаче `<IssueChat>`** поверх chat-v2 с голосовыми + ASR Vox/GigaAM.
- **Cmd+K AI-парсинг** через `concierge-parse` LlmTaskType (после α-5 — α-5 уже готов!).
- **Optimistic updates** для всех мутаций (не только transitions).

## Prod-инструкция для владельца

Изменения этой сессии **требуют:**

1. **Применить Prisma миграции на prod БД:**
   ```bash
   cd backend && bun run prisma:push
   ```
   Создаст 9 новых таблиц + 1 колонку (IssueComment.thanksUserIds).

2. **Регенерировать Prisma client на prod:**
   ```bash
   cd backend && bun run prisma:generate
   ```

3. **Seed базовых badges (5 штук — ideator/expert/helper/aligned/consistent):**
   ```bash
   cd backend && bun run scripts/seed-badges.ts
   ```
   Идемпотентно по slug unique.

4. **Seed LlmTaskRoute для recognition-formulate:**
   ```bash
   cd backend && bun run scripts/seed-llm-task-routes-recognition.ts
   ```
   Без него `LlmRouterService.call({taskType: 'recognition-formulate'})` упадёт. Маршрут: DeepSeek primary, OpenAI proxy gpt-5.4-mini fallback, Ollama qwen3.5:9b tertiary.

5. **TODO для prod (отдельным тикетом):** Seed LlmTaskRoute для 3 helpfulness taskType (helpfulness-detect, helpfulness-trait-merge, helpfulness-spotlight-formulate) — script ещё не написан, нужно сделать по примеру recognition.

6. **PWA + push на prod (опционально, для запуска web push):**
   - Сгенерировать VAPID ключи: `npx web-push generate-vapid-keys`.
   - Выставить в `.env.production` (frontend): `NEXT_PUBLIC_VAPID_PUBLIC_KEY=...`.
   - Backend `/api/v1/me/push-subscriptions` endpoint — ещё не реализован, до него push-toggle UI работает только локально в браузере.

7. **Пересобрать backend и frontend:**
   ```bash
   cd backend && bun install && bun run build
   cd frontend && bun install && bun run build
   ```

8. **Перезапустить:** backend HTTP + worker процессы (новые cron'ы автоматически зарегистрируются через @Schedule), frontend Next.js.

9. **Проверить новые endpoints через Swagger** (`/api/docs`):
   - `/api/v1/feed/*` + `/api/v1/feed-subscriptions/*`
   - `/api/v1/me/social-contribution`, `/api/v1/feed/spotlights/*`, `/api/v1/admin/helpfulness/*`
   - `/api/v1/me/contributions`, `/api/v1/badges`, `/api/v1/me/badges`, `POST /api/v1/issues/comments/:id/thanks`
   - `/api/v1/me/inbox`, `/api/v1/states`

10. **Грабли prod:**
    - HelpfulnessTrait.embedding pgvector pока без HNSW индекса — на >10к записей seq-scan медленный. TODO: добавить в `postgres-init.sql`.
    - Push-subscriptions endpoint backend нет — UI в graceful disable.

## Метрика темпа оркестрации

| Сессия | Коммитов | Строк | Срок |
|---|---|---|---|
| 2026-05-24 Sprint 1+2+3 | 13 | ~17 900 | 1 длинная сессия |
| 2026-05-24 Sprint 3 finishing | 3 + 1 docs | ~3 900 | первая половина текущей |
| 2026-05-24 Wave 2 backend + Phase 2 frontend | 5 + 1 docs | ~13 100 | вторая половина текущей |
| **Итого за 2 сессии** | **22 коммита + 2 docs** | **~34 900 строк** | |

Дальше — Wave 3 backend (β-8 COO Dashboard + Phase 4 РФ + Phase 5 импорт + γ-2 Concierge + α-10 Admin LLM) и финальный Phase 2 frontend (IssueChat + Cmd+K + optimistic).
