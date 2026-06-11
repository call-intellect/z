---
type: tz
status: ready-to-implement
feature: remaining-handoff-finishable-now
date: 2026-06-11
owner: Сергей (sergrv80@gmail.com)
branch_foundation: feature/finishable-now-2026-06-11
relates_to:
  - plans/tz/2026-06-11-chatbox-memory-finishing-and-tasks-from-chat.md
  - plans/tz/2026-06-11-mobile-cora-exec-manager.md
  - plans/tz/2026-06-11-cabinet-inbox-nav-ui-honesty.md
  - plans/tz/2026-06-11-prompts-finalization-MASTER-org-and-reports.md
  - second-brain/04_не-сделано/README.md
---

> **Для агента-продолжателя.** Это handoff-контракт: что НЕ доделано из пакета «6 ТЗ» и где
> именно подключаться. Фундамент уже на ветке `feature/finishable-now-2026-06-11` (15 коммитов).
> **Полные контракты каждой фазы — в исходных ТЗ** (ссылки во frontmatter); здесь — только остаток,
> точки врезки в УЖЕ написанный код и acceptance. **Сначала** `git fetch` + работай в своём worktree
> (`git worktree add ../z-remaining -b feature/remaining-handoff feature/finishable-now-2026-06-11`),
> чтобы не конфликтовать с параллельными сессиями. Перед каждой правкой — re-Read якорей (строки дрейфуют).

# ТЗ — доделать остаток пакета «6 ТЗ» (ChatBox · Мобайл · Кабинет-хвосты · промпты A4)

## Что УЖЕ сделано (фундамент — НЕ переписывать, опираться)

| ТЗ | Сделано на ветке | Не делать повторно |
|---|---|---|
| ASR сегментные тайминги | ✅ целиком (миграция `TranscriptTrack.segments`, персист, merge-переплётка, флаг) | всё |
| Промпты-MASTER | ✅ A1-A3 + B1-B4 (few-shot 11 промптов, гейт `isOrgNorm`, версии `CardVersion`, sync `ProcessStep`) | A1-A3, B |
| Кабинет Волна 1 | ✅ Ф1-Ф5 целиком | D1/D2/D6/D7/D10 |
| Кабинет Волна 2 | ✅ Ф6 (primary-nav+/feed+гард) + Ф7 (сворачивание Sidebar + welcome-тур) | Ф6, Ф7 |
| ChatBox | ✅ миграция (Task.meetingId nullable + `sourceType`/`sourceChatSessionId`/`sourceChatId` + модель `TaskSource` + `ChatboxCustomer/ChannelClient.linkedPersonId/linkMode`); Ф1 матчинг (`autoLinkCustomers` + `ChatboxCustomersService`/Controller + экран `/chats/integrations/chatbox/customers`); Ф5 задачи из переписки (`chatbox-analyze.worker.extractTasks`); Ф6 межисточниковый дедуп (`CrossSourceTaskDedupeService`); флаги `chatbox.taskExtraction.enabled`/`tasks.crossSourceDedupe.enabled` | миграция, Ф1, Ф5, Ф6 |
| Мобильная Кора | ✅ Ф0 (страница `/me/daily-brief` + `MyDailyBriefClient` + `daily-brief.api.ts`/`domain/me/daily-brief.ts` + `EnableMorningRemindersButton`); Ф1 (`useIsMobile`, `MobileShell` viewport-gate, `MobileTabBar`, `mobile-tabs.ts` с `tabsForRole`/`landingHrefForRole`, интеграция в `AppShell`) | Ф0, Ф1 |
| probe context-leak | ✅ целиком | всё |

> Флаги/ENV/миграции — в `docs/operations/feature-flags.md` и `docs/operations/prod-deploy-log.md` (блок 2026-06-11).

## Остаток (scope этого ТЗ) — dependency-ordered

```
A. ChatBox Ф2 (виджет) ∥ Ф3 (метрики) ∥ Ф4 (WARN sendMessage)   — независимы, поверх готового модуля
B. Мобайл Ф2 (Обзор) → Ф3 (разделы); Ф4/Ф5/Ф6 ∥ ; Ф7 (push) после Ф2; Ф8 (свайп, опц.)
C. Кабинет Ф9 (D8 уведомление — отдельный канал) ; Ф10 (pluralRu, опц.) ; Ф8/D5 (мини-дизайн, опц.)
D. Промпты A4 (insight few-shot) — ТОЛЬКО по «да» владельца
E. Прод-операции владельца (не код)
```

---

## A. ChatBox — Ф2/Ф3/Ф4 (полный контракт: `2026-06-11-chatbox-memory-finishing...` §Ф2/Ф3/Ф4)

### A1 — Ф2 «Чаты в памяти» (виджет) `[ ]`
- **Цель:** сводка «забрали N диалогов → проанализировали M → породили K карточек/задач».
- **Врезка:** новый агрегатный эндпоинт в `backend/src/modules/chatbox/*` (счётчики `ChatboxChat`/`ChatboxChatSession` по `analysisStatus` + блоки/задачи источника `chatbox`: `RawEvent(sourceType='chatbox')`, `Task(sourceType='chatbox')`). Виджет на `frontend/app/(authenticated)/chats/integrations/chatbox/ChatboxIntegrationClient.tsx` (рядом с уже добавленной карточкой «Клиенты и сотрудники») и/или в разделе «Чаты».
- **Acceptance:** виджет показывает забрано/проанализировано/в работе/ошибки + ссылки на карточки; цифры сходятся с `/chatbox/integration/sync/status`. Парные токены, только русский. typecheck/lint/build + spec.

### A2 — Ф3 метрики синка/анализа + алерт `[ ]`
- **Врезка:** prom-метрики через `BusinessMetricsService` в воркерах chatbox (`chatbox-sync.service`, `chatbox-analyze.worker`): счётчик синков, счётчик анализов, gauge pending-сессий, возраст последнего синка. Правило алерта «`analysisEnabled=false`, а чаты копятся» и «pending растёт».
- **Acceptance:** метрики в `/metrics`; алерт-правило задокументировано; unit на инкременты.

### A3 — Ф4 разбор WARN `sendMessage без id` `[ ]`
- **Врезка:** `backend/src/modules/chatbox/chatbox-chats.service.ts` `sendMessage` — по залогированной форме (`keys`) поправить парсер ответа ChatBox POST; убрать синтетический ключ `kora-out-…`, если реальный `id` под известным полем.
- **Прод-вход владельца:** 1 реальная отправка живому клиенту — снять форму ответа.
- **Acceptance:** реальная отправка → сообщение по настоящему `externalId`, WARN не появляется.

---

## B. Мобильная Кора — Ф2-Ф8 (полный контракт: `2026-06-11-mobile-cora-exec-manager.md` §Ф2-Ф8 + блок «контракт мобильных компонентов»)

> **Инвариант №1:** мобайл = тот же web-app, читает СУЩЕСТВУЮЩИЕ эндпоинты, десктоп НЕ меняем.
> Фундамент: `MobileTabBar` сейчас роутит табы на десктоп-роуты-заглушки (`mobile-tabs.ts`: Обзор→`/dashboard`,
> Команда→`/dashboard/operations`, Дела→`/dashboard/operations/weekly`, Цели→`/goals`, Спросить→`/chat`,
> Память→`/decisions`, Моё→`/me/daily-brief`). Задача — **заменить заглушки реальными мобильными экранами**
> `frontend/src/ui/mobile/exec/*` · `manager/*` · `shared/*` и навесить их на тот же роут под мобильным viewport
> (через `MobileShell`, как описано в исходном ТЗ §Б4).

### B1 — Ф2 exec «Обзор» (`MobileOverviewClient`) `[ ]`
- На `/dashboard` при мобильном viewport: строка «Требует тебя: N» (`requiresAction`/`signalCounters`) + 4 зоны (Команда/Дела/Главная цель/Что мешает) + полоса «Кора за неделю» (`valueStrip`) + кнопка «Спросить». Источники: `GET /dashboard/director` (`DirectorDashboardDto`) + `GET /operations/dashboard`. Cold-start (Р6) при пустом графе. Финансы НЕ показываем.
- **Acceptance:** мобильный `/dashboard` рендерит «Обзор»; десктоп не изменён; тап зоны → раздел (Ф3); cold-start индикатор. typecheck/lint/build.

### B2 — Ф3 exec разделы Команда/Дела/Цели + drill `[ ]`
- `MobileTeamClient`/`MobileDealsClient`/`MobileGoalsClient` (operations / `weekly-per-person` / `goalsPulse`/`goalTree`). Фокус «кому помочь», БЕЗ публичного «кто провалил» (Р4). Drill в существующие detail-страницы.

### B3 — Ф4 manager «Моё»+«Чек-ин» `[ ]`
- `MobileMyDayClient` (контент таба «Моё» поверх ГОТОВОЙ страницы `/me/daily-brief`/`MyDailyBriefClient` — переиспользовать; позитивная рамка уже в `domain/me/daily-brief.ts`). `MobileCheckinClient` — поток `/me/check-ins`, поле текст + микрофон (ASR), без inline-кнопок (Р7).
- **Acceptance:** grep запрещённых строк «провалил/просрочил/не сдал» в менеджерских строках = 0; ноль inline-кнопок-вариантов в системном вопросе.

### B4 — Ф5 таб «Спросить» (ChatV2/Concierge first-class) `[ ]`
- `MobileAskClient` — переиспользовать ChatV2/«Помощник компании»; промпт-кнопки в один тап; голос-ВВОД (ASR), ответ ТОЛЬКО текстом (Р8), с citation. grep «🔊/Слушать» = 0.

### B5 — Ф6 manager «Память» `[ ]`
- `MobileMemoryClient` — лента решений/договорённостей (`/decisions`/`/ideas`) + поиск, self-видимость по доступу.

### B6 — Ф7 утренний exec-push + cold-start + установка PWA `[ ]`
- `operations-daily-digest.cron.ts` — добавить доставку через `enqueuePushSend` (текст «Требует тебя сегодня: N», `actionUrl`→мобильный «Обзор»), под дневным бюджетом+тихими часами; kill-switch ON (AdminSetting `operations.daily_digest.deliver_to_webpush`), НЕ Telegram. Финализировать UX установки PWA (кнопка `EnableMorningRemindersButton` уже есть).
- **Прод-зависимость:** VAPID-ключи (`VAPID_*` + `NEXT_PUBLIC_VAPID_PUBLIC_KEY`) — без них push no-op.
- **Acceptance:** владелец с подпиской получает утренний push, тап → мобильный «Обзор»; дневной бюджет+тихие часы соблюдены; cold-start виден; smoke крона зелёный.

### B7 — Ф8 свайп внутри экрана (опц., низкий приоритет) `[ ]`
- `embla-carousel-react` (сверить API через Context7); листание недель / смахивание карточки; видимая альтернатива (стрелки), не конфликтует с системным edge-swipe iOS.

---

## C. Кабинет — хвосты Волны 2 (полный контракт: `2026-06-11-cabinet-inbox-nav-ui-honesty.md` §Ф8/Ф9/Ф10)

### C1 — Ф9/D8 уведомление «встреча без записи — анализа не будет» `[ ]`
- В backend **нет модуля notifications** под этот случай → оформить отдельным ТЗ `plans/tz/2026-06-11-meeting-no-recording-notification.md` с `[ASSUMPTION]` канала (in-app событие vs Telegram vs web-push). Точка: `webhooks/livekit-events.handler.ts` `onRoomFinished` — completed без `Recording`/транскрипта спустя грейс-период → событие владельцу встречи. Строка в `04_не-сделано` уже есть.

### C2 — Ф10 pluralRu консолидация (опц.) `[ ]`
- Единый util `frontend/src/lib/i18n/plural.ts` + `backend/src/common/utils/plural-ru.ts` (tuple `(n,[one,few,many])`); заменить 7+ фронт/≥5 бэк копий; ESLint/vitest-гард. **Риск:** `contribution.ts` возвращает строку С числом — проверить 5 потребителей поштучно.

### C3 — Ф8/D5 мини-дизайн слияния «Входящие+Подтверждения» (опц.) `[ ]`
- Только дизайн-документ `plans/analysis/2026-06-11-inbox-actions-merge-mini-design.md` (продуктовое решение владельца), кода навигации НЕ писать. Строка в `04_не-сделано` уже есть.

---

## D. Промпты — A4 insight few-shot `[ ]` — ТОЛЬКО по «да» владельца
- `knowledge-core/prompts/insight-extract.prompt.ts`: 2 примера (системный insight vs разовая жалоба) + гейт `isInsight` по образцу `decision-extract`. Без явного «да» — НЕ делать (риск тихой деградации recall без замера). Строка в `04_не-сделано`.

---

## E. Прод-операции владельца (не код)
- **ChatBox Ф0:** прогнать `patch-enable-chatbox-analysis.ts` (включить анализ переписки у «Ооо луа», tenant `cmpndk2tw…`).
- **VAPID:** сгенерировать пару (`npx web-push generate-vapid-keys`) и задать `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` + `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (для мобильного push, Ф7/Ф0).
- **AdminSetting-сиды (опц.):** `tasks.cross_source_dedupe_threshold` (0.85), `chatbox.match.name_fuzzy_enabled` (true) — работают на code-fallback (Ship-On), сид нужен только для редактирования из админки.

## Общий DoD каждой фазы
- `bun run typecheck` (вкл. `.spec`) · `bun run lint` (0 errors) · `bun run build` зелёные (back и/или front по фазе).
- Затронутые тесты `bunx vitest run <файл>` зелёные; новые — добавить (поведение, негативы, идемпотентность).
- Только русский UI; парные токены `bg-{color}`+`text-{color}-fg`; ApiDto→Domain в api-слое; SWR.
- Никаких `process.env.*` (TypedConfigService), `new PrismaClient()` (createPrismaClient), `prisma db push`, `git add .`.
- Закрыл пункт → убрать строку из `04_не-сделано/README.md`; обновить `second-brain/` и `prod-deploy-log.md` по DoD-таблице.

## Порядок
**A (ChatBox Ф2/Ф3/Ф4)** — быстрые независимые, поверх готового модуля → **B (Мобайл Ф2→Ф3, затем Ф4/Ф5/Ф6, потом Ф7)** — крупнейший остаток → **C/D/E** — хвосты/опц./прод. A и B можно параллелить (дизъюнктные зоны: chatbox-backend vs mobile-frontend).
