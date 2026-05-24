---
date: 2026-05-24
type: reflection
session: wave2-finishing + phase2-polish
distilled: false
---

# Wave 2 finishing — Helpfulness/Recognition bridges + Web Push + IssueChat + Cmd+K + UI polish

## Что было поставлено

Третья сессия 2026-05-24. После Wave 2 backend + Phase 2 frontend (10 коммитов, ~21 000 строк) пользователь сказал «продолжай как оркестратор» — 8 параллельных subagent'ов на оставшиеся мелкие связки и большие новые модули:

**Группа 1 (5 backend параллельно):**
- **A1** — HelpfulnessSpotlight → Recognition bridge (20 мин).
- **A2** — RecognitionFormulateWorker → ActivityFeedService.publish (20 мин).
- **A3** — Seed LlmTaskRoute для 3 helpfulness taskType (15 мин).
- **A4** — HNSW pgvector index для HelpfulnessTrait.embedding (10 мин).
- **A5** — Backend web-push service (PushSubscription модель + endpoints + worker + cron, ~90 мин).

**Группа 2 (3 frontend параллельно):**
- **B1** — IssueChat real implementation (chat-v2 + голос через voiceApi.transcribe, 90 мин).
- **B2** — Cmd+K AI command palette (Provider + Trigger + AI ask + Concierge actions, 60 мин).
- **A6+A7+A8** — Toast в Board.tsx + Pagination UI инбокса + Badge непрочитанных в BottomNav (1 объединённый агент).

## Как решал

### Шаг 1 — разведка backend и frontend

Параллельно прочитал релевантные файлы:
- `helpfulness-spotlight.cron.ts` + `helpfulness-api.service.ts` — где approve логика.
- `recognition-formulate.worker.ts` — TODO на строке 138-146.
- `RecognitionService.enqueueFormulate` сигнатура + детерминированный jobId.
- `seed-llm-task-routes-recognition.ts` — шаблон-эталон (167 строк).
- `postgres-init.sql` — паттерн идемпотентных HNSW блоков.
- `frontend/src/ui/tracker/IssueChat.tsx` — stub статус.
- `frontend/src/ui/components/chat-v2/ChatPanel.tsx` + `chatV2Api` — что переиспользовать.
- `frontend/src/ui/concierge/ConciergeVoice.tsx` — паттерн ASR через voiceApi.transcribe.
- `frontend/src/ui/components/command-palette/CommandPalette.tsx` — была частично готовая γ-2 палитра, нужно расширить.
- `frontend/src/contexts/toast-context.tsx` — паттерн useToast().

### Шаг 2 — параллельный запуск 5+3 = 8 backend/frontend agents

5 backend параллельно (разные модули, разные файлы — никакого race). 3 frontend параллельно (3 разных области UI).

Между ними дополнительно — добавил `@dnd-kit/*` deps сам ДО запуска агентов (так как 2 frontend могут хотеть зависимостей).

### Шаг 3 — race condition в worktree (новый урок!)

A1 запустился раньше A2/A5 и попытался изолировать конкурентные uncommitted правки через `git stash` для отделения своих изменений. После завершения A1 я обнаружил:

- **A2 изменения утрачены** (FeedTypeSchema без 'recognition', recognition-formulate.worker.ts всё ещё с TODO).
- **A4 изменения утрачены** (helpfulness_trait_embedding_hnsw отсутствовал в postgres-init.sql).
- **A5 PushSubscription модель утрачена** (отсутствовала в schema.prisma — но Prisma client уже сгенерирован с моделью, поэтому typecheck зелёный!).
- **web-push npm зависимости утрачены** (отсутствовали в package.json/bun.lock).
- A5 сам в отчёте сообщил про сложности — обходил env.schema.ts через прямой `this.get('VAPID_*')` чтобы избежать .merge(PushSchema), но другие его файлы (queue, push module) сохранились.

**Корень проблемы:** агенты в параллели работают в одном worktree. Один агент решает изолировать конкуренту через stash → откатывает не только своё, но и чужое. После drop stash чужие правки безвозвратно теряются.

**Как восстановил:**
1. A2 — переделал вручную (FeedTypeSchema + worker publish + try/catch + два хелпера title/icon). ~10 минут.
2. A4 — добавил HNSW блок вручную в postgres-init.sql. ~3 минуты.
3. A5 — восстановил PushSubscription модель в schema.prisma + `bun add web-push @types/web-push` + `bun run prisma:push && bun run prisma:generate`. ~5 минут.

### Шаг 4 — 9 коммитов + push

После восстановления — отдельные коммиты по тикетам:
- `0365d6c` A1 Helpfulness→Recognition bridge (3 файла, +181)
- `1a35a38` A2 Recognition→ActivityFeed publish (2 файла, +72/-6)
- `0c02121` A3 seed helpfulness LlmTaskRoute (1 файл, +202)
- `389092a` A4 HNSW индекс (1 файл, +21)
- `e6ebe92` A5 backend web-push (18 файлов, +1533)
- `a85815e` B1 IssueChat real (2 файла, +428/-31)
- `8c1088a` B2 Cmd+K CommandPalette (5 файлов, +797/-200)
- `788ede0` A6+A7+A8 Toast/Pagination/Badge (6 файлов, +242/-22)
- `26da6fe` Integration (AppModule + policy.csv push_subscription)

Push `2e36d11..26da6fe dev -> dev` — успешно. До меня в dev попали 2 коммита владельца `1b2c521` + `2e36d11` про concierge философию (пока я работал — синхронно правил docs). Не пересеклось.

### Шаг 5 — second-brain + рефлексия

- `01_projects/tracker.md` — добавлена строка про Wave 2 finishing в «История реализации».
- `02_architecture/module-map.md` — большой раздел «Wave 2 finishing + Phase 2 polish (2026-05-24, вечер)» с описанием всех 8 тикетов.
- `05_история/2026-05-24-wave2-finishing.md` — эта рефлексия.

## Что вышло — результаты верификации

| Что | Проверка | Результат |
|---|---|---|
| Backend typecheck после ручного восстановления A2/A4/A5 | `bun run typecheck` | ✓ exit 0 |
| Frontend typecheck после B1/B2/A6-A8 | `bun run typecheck` | ✓ exit 0 |
| Backend tests push + recognition + helpfulness + activity-feed | `vitest run` | 19 файлов / 121 теста passed |
| Frontend tests | `bun run test:unit` | 2 файла / 14 тестов passed |
| Git push | `git push origin dev` | OK 2e36d11..26da6fe |
| Pre-сессионные untracked файлы | Не закоммичены | ✓ |
| Stash от A1 | drop'нут после восстановления | ✓ |

## Архитектурные решения принятые автономно

### 1. A2 хелперы title/icon как чистые функции в worker.ts
`recognitionFeedTitle(type)` + `recognitionFeedIcon(type)` — встроены прямо в worker файл, не выделены в separate module. Маппинг 6 значений, не растёт — premature abstraction не нужна.

### 2. A5 без отдельной PushSchema в env.schema.ts
A5 на момент работы попал в TS2589 на длинной .merge() цепочке env.schema. Обошёл через прямые `this.get('VAPID_*')` с дефолтами в `typed-config.service.ts.get push()`. Минус: переменные не валидируются Zod. Плюс: работает + не падает в TS2589.

### 3. A4 без GIN на topicHint
Проверил все use-cases в Specialist 3.8 module: только `WHERE topicHint IS NOT NULL` (фильтр, селективность низкая → GIN неэффективен) и `GROUP BY topicHint` (hash-aggregate лучше). Решение «нет, не добавляем» — обоснованно.

### 4. A1 двойная идемпотентность Helpfulness→Recognition bridge
Слой 1: FSM-guard в approveSpotlight (повторный approve уже-published → ForbiddenException, bridge не вызывается).
Слой 2: BullMQ jobId `recognition_thanks_helpfulness_<spotlightId>_ai` дедуплицирует на уровне очереди.

### 5. A2 кэшируем только 2xx? Нет — все
RecognitionFormulateWorker.publish — best-effort. try/catch вокруг. Recognition уже в БД (главный артефакт), упавший publish → WARN с recognitionId/type/visibility/err, worker возвращает void без проброса в BullMQ.

### 6. A5 — failure handling RFC 8030 §7.3
410 Gone / 404 Not Found → markFailure incrementing failureCount → удаление при >= PUSH_MAX_FAILURES. 5xx/network → log-warn без markFailure (push-сервис временно лежит, не выбрасываем рабочие подписки).

### 7. A5 — детерминированный jobId с минутным bucket
`push_<userId>_<fnv1a(title+body)>_<bucketMin>` — дедуп одинаковых уведомлений в одну минуту. Без `crypto` import — FNV-1a 32-бит достаточно.

### 8. A5 — `@Global` PushModule
Чтобы будущие модули (ActivityFeed, Recognition, Conversational) могли эмитить push через `CoreQueueService.enqueuePushSend` без re-import. PushModule экспортирует `WebPushSender` + `PushSubscriptionsService` для прямого инжекта.

### 9. B1 — серверный ASR через voiceApi.transcribe, не Web Speech API
В проекте уже есть production-grade серверный ASR (Vox/GigaAM) с лучшим качеством на русском. Переиспользую паттерн из ConciergeVoice. Обработка ошибок с русскими сообщениями: NotAllowedError/NotFoundError/audio_required/audio_too_large/asr_failed.

### 10. B1 — scope='card' fallback
`ChatV2ScopeEnum` не содержит 'issue'. Карточка задачи семантически близка к карточке в knowledge-core. TODO для отдельного спринта: добавить 'issue' + завести трекер-специалиста в card-specialist-registry.

### 11. B2 — глобальный listener в Provider, не в CommandPalette
Если listener в CommandPalette, кнопка-триггер из произвольной части UI не работает пока палитра скрыта (она монтируется всегда, но это хрупко). Plus избежали duplicate-listener risk.

### 12. B2 — два канала `>` и `?`
- `>` — Concierge tool-call (γ-2, императив, undo-toast)
- `?` — chat-v2 ask (вопрос-ответ по памяти компании)
Не дублируем γ-2 UX и сохраняем ICP-разделение «действие vs запрос знания».

### 13. A8 — badge с символом «·» вместо цифры
Backend пока не возвращает total в /me/inbox response. Workaround: `myInbox({limit:1})` → count ∈ {0, 1}. Не вводим пользователя в заблуждение «у тебя ровно 1» — рисуем «·» (есть что-то). aria-label содержит честное число. TODO: backend total endpoint.

### 14. Параллельные агенты в одном worktree: stash != безопасно
A1 ради изоляции своих изменений сделал stash + drop → потерял правки от A2/A4/A5 которые ещё не были закоммичены. Это новый урок для дистилляции.

## Чему научился (для дистилляции)

1. **⚠ Новый главный урок: агенты в параллельной оркестрации НЕ ДОЛЖНЫ stashить worktree.** Stash → drop = потеря чужой работы. Если агент видит конкурентные uncommitted правки, он должен либо: (a) работать с ними как с background, не трогая; (b) отчитаться оркестратору, не пытаясь stashить. Дистиллировать в feedback memory + в core-pitfalls + в шаблон промпта агента: **«НИКОГДА не делай git stash в параллельной сессии — это потеряет работу другого агента»**.

2. **`grep ClassName backend/src/` после параллельного запуска — тоже must-have.** Перед коммитом проверять что изменения агента физически в файлах. Семь раз отмерь, один отрежь — особенно в параллели.

3. **PushSubscription в Prisma client кэшируется отдельно от schema.prisma.** `bun run prisma:generate` создаёт `node_modules/.prisma/client/index.d.ts` с типами; даже если schema.prisma откатилась, client остаётся валидным до следующего generate. Это может маскировать проблемы — typecheck зелёный, но в БД таблицы нет.

4. **Восстановление потерянных изменений — копировать из отчёта агента, не пытаться replay.** Каждый агент в отчёте перечислил список изменений + ключевые фрагменты. Этого достаточно для ручного восстановления за 5-10 минут.

5. **Best-effort паттерн для publish/notify сервисов.** Recognition → ActivityFeed → Push push — каждый слой обёрнут в try/catch с warn-логом. Главный артефакт (Recognition в БД) — приоритет. Лента/push — best-effort. Это надёжнее transactional all-or-nothing для cross-system нотификаций.

6. **`@Optional() @Inject(...)` для @Global сервисов — defense-in-depth.** RecognitionModule + ActivityFeedModule оба @Global, но @Optional страхует от splitting процессов (worker vs api), edge-кейсов тестов и temporary disable feature flag.

7. **TS2589 на длинной merge цепочке Zod — обходить через прямые `this.get(...)` в TypedConfigService.** Не каждая новая фича требует добавления Schema в env.schema.ts.

8. **A1 → A2 race confirmation:** `git status backend/src/.../target-file.ts 2>&1` — если no output, файл не изменён vs HEAD. Это разоблачает потерю изменений из stash.

## TODO которые остались

### Wave 2 finishing — мелочи
- `/api/v1/me/inbox/count` или total в response `/me/inbox` — снять workaround в `useMyInboxCount` (cnt ∈ {0,1} → реальное число).
- Backend chat-v2 ScopeEnum добавить 'issue' + завести трекер-специалиста в card-specialist-registry — снять scope='card' fallback в IssueChat.
- TTS-озвучка ответа AI в IssueChat (voiceApi.synthesize готов, ~30 строк).
- /chat-v2?conversationId=... deep-link — ChatV2Client должен читать query-параметр.
- concierge-parse LlmTaskType backend для Cmd+K (`>` префикс сейчас через `conciergeApi.askOnce`).
- Голосовой ввод в CommandPalette (готовый ConciergeVoice → onTranscribed → setQuery).
- Recent/Pinned секция в Cmd+K idle-режиме.

### Wave 3 backend (приоритеты владельца)
- **β-8 COO Operations Dashboard + DailyCheckIn + PersonalRelation** (Sprint 12 в плане). ⚠ Sentiment чек-инов БЕЗ ручных кнопок 🟢🟡🔴.
- **Phase 4 Tracker РФ** — Telegram-бот для задач голосом, email-to-task, 10 шаблонов команд seed, локализация (даты/телефоны/ИНН/КПП), двусторонний календарь.
- **Phase 5 импорт** — Битрикс24 + Trello + Я.Трекер wizards.
- **γ-2 Concierge Agent backend extension** — concierge-parse LlmTaskType для Cmd+K + Telegram голос.
- **α-10 Admin LLM + Unit Economics** — LlmProvider/LlmModel/AiCostDaily/OrgBudgetCap/CurrencyRate, 5 cron'ов. Сначала унификация admin-групп.

## Prod-инструкция для владельца

1. **Pull dev:**
   ```bash
   git pull origin dev
   ```

2. **Установить новую зависимость web-push:**
   ```bash
   cd backend && bun install
   ```

3. **Применить Prisma миграцию (1 новая таблица PushSubscription):**
   ```bash
   bun run prisma:push
   bun run prisma:generate
   ```

4. **Применить новый HNSW индекс для HelpfulnessTrait.embedding:**
   ```bash
   bun run apply-postgres-init
   ```

5. **Seed LlmTaskRoute для 3 helpfulness taskType (без него worker Specialist 3.8 упадёт):**
   ```bash
   bun run scripts/seed-llm-task-routes-helpfulness.ts
   # или с флагом для обновления existing routes:
   bun run scripts/seed-llm-task-routes-helpfulness.ts --update-existing
   ```

6. **(Опционально) Web Push на prod:**
   ```bash
   # Сгенерировать VAPID пару (один раз):
   cd backend && bunx web-push generate-vapid-keys

   # Прописать в .env.production (backend):
   VAPID_PUBLIC_KEY=<public_key>
   VAPID_PRIVATE_KEY=<private_key>
   VAPID_SUBJECT=mailto:noreply@kora.app
   PUSH_MAX_FAILURES=5

   # Прописать в .env.production (frontend) — тот же public key:
   NEXT_PUBLIC_VAPID_PUBLIC_KEY=<тот же public key>
   ```
   Если ENV не выставлены — push отправка отключается с warn, persistence работает (граefulно).

7. **Пересобрать backend + frontend + перезапустить процессы.**

## Метрика темпа оркестрации

| Сессия | Коммитов | Строк |
|---|---|---|
| 2026-05-24 Sprint 1+2+3 (Wave 1 backend + frontend scaffold) | 13 | ~17 900 |
| 2026-05-24 Sprint 3 finishing + Wave 2 backend + Phase 2 frontend | 10 | ~21 000 |
| 2026-05-24 Wave 2 finishing + Phase 2 polish (текущая) | 9 | ~3 700 |
| **Итого за 3 сессии 2026-05-24** | **32 коммита + 3 docs** | **~42 600 строк** |

Wave 1 + Wave 2 + Phase 2 frontend закрыты полностью. Дальше — Wave 3 (β-8 COO Dashboard, Phase 4 РФ, Phase 5 импорт, γ-2 Concierge backend extension, α-10 Admin LLM).
