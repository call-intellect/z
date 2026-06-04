# ТЗ: Процессные контуры (pipelines), сквозной traceId и полное покрытие логами

Дата: 2026-06-03. Ветка: `logExt`.
Базируется на уже построенном `LoggingModule` (см. [2026-06-01-logging-module.md](2026-06-01-logging-module.md)).

## Цель
Доработать систему логирования в БД так, чтобы:
1. **Покрыть логами все аспекты приложения, КРОМЕ HTTP-запросов** (REQUEST убираем совсем).
2. **Разбить логи на модули и процессные контуры (pipelines)** — цепочки вызовов
   (встреча → запись/S3 → транскрипция → AI-анализ → граф знаний и т.д.), чтобы по
   `traceId` можно было увидеть всю цепочку одного действия (вызовы, результаты, ошибки).
3. **Админка**: фильтр по контуру/`traceId` + отдельный вид «Цепочка» (timeline по `traceId`).

## Решения (согласованы с заказчиком 2026-06-03)
- **D1.** Новое поле `pipeline` (enum `SystemLogPipeline`) + заполнение существующего
  `traceId`. Роль-`contour` остаётся как есть (роль/зона доступа). Одна цепочка = один `traceId`.
- **D2.** Полное покрытие всех модулей (многофазно).
- **D3.** REQUEST-логирование убрать совсем: снять `RequestLoggingInterceptor` из провайдеров.
  Ошибки запросов (4xx/5xx) продолжает писать `AllExceptionsFilter`.

## Архитектурные принципы
- **Мост Nest Logger → DB.** Все существующие `this.logger.log/warn/error/debug(...)` по всему
  бэкенду автоматически попадают в `SystemLog` через кастомный `LoggerService`
  (`app.useLogger`). Контекст логгера (`new Logger(X.name)`) → поле `module`. Это даёт
  покрытие «всех аспектов» без правки сотен call-site'ов.
- **ALS-контекст pipeline/traceId.** `RequestContextService` расширяется полями
  `pipeline`/`traceId`/`module`. Воркеры и точки входа цепочек оборачивают свою работу в
  `ctx.runWith({ pipeline, traceId }, fn)` — мост и `LogService.write()` обогащают записи.
- **Детерминированный traceId.** Для цепочки встречи `traceId = mtg_<meetingId>` на всех
  стадиях (проброс через payload не нужен — `meetingId` уже в каждом джобе). Для прочих —
  по якорной сущности (`doc_<id>`, `user_<id>`, `org_<id>`) или `requestId` для HTTP-инициированных.
- **best-effort.** Запись лога никогда не ломает бизнес-операцию (как и сейчас).
- **Анти-рекурсия/шум.** Мост игнорирует внутренние логгеры `LoggingModule`
  (`LogBufferService`, `LogCleanupService`) и фреймворковые контексты Nest (InstanceLoader,
  RoutesResolver, RouterExplorer, NestFactory, NestApplication).

## Таксономия контуров (SystemLogPipeline)
| pipeline | что входит (модули/воркеры) | traceId |
|---|---|---|
| `MEETING_LIFECYCLE` | meetings (FSM, create/start/join/leave/end), livekit (room, токены, webhooks) | `mtg_<meetingId>` |
| `RECORDING` | recordings, egress, S3-загрузка дорожек, recording webhooks | `mtg_<meetingId>` |
| `TRANSCRIPTION` | ai: transcribe, transcript-clean, transcript-index, merge | `mtg_<meetingId>` |
| `AI_ANALYSIS` | ai: chapters, analyze, tasks-extract, custom-report, clip-render, notify; knowledge-core: meeting-report-fast, meeting-analyze-v2, specialists-combined | `mtg_<meetingId>` |
| `KNOWLEDGE_GRAPH` | knowledge-core: ingest→block→distill→linker→entity-resolver→theme-clusterer, specialists 3-*, card-rollup, role-profile, skill-profile | `mtg_<meetingId>` / `doc_<id>` / `org_<id>` |
| `NOTIFICATIONS` | push, events (reminders), recognition, concierge, dialog-layer, proactive | по якорю (`user_`/`org_`) |
| `AUTH` | auth (login/guest/sessions/tokens), rbac | `requestId` / `user_<id>` |
| `BILLING` | billing/payments, entitlements, провайдеры (Tochka/Crossmark) | `org_<id>` / `requestId` |
| `INTEGRATIONS` | webhooks-out, tracker (import/triage), tables (sync/enrich), внешние API | по якорю |
| `ONBOARDING` | company-foundation, onboarding, role-map | `org_<id>` |
| `ADMIN` | admin/platform операции | `requestId` / `user_<id>` |
| `SCHEDULER` | cron'ы, retention, фоновые периодические задачи | `cron_<name>_<bucket>` |
| `SYSTEM` | прочее, bootstrap, не классифицировано | — |

## Фазы

### Ф1. Инфраструктура (схема + контекст + мост) — фундамент
- [ ] Prisma: `enum SystemLogPipeline` + `SystemLog.pipeline` + `@@index([pipeline, createdAt])` + `@@index([traceId, createdAt])`. `prisma:push` + `generate`.
- [ ] `log.constants.ts`: re-export `SystemLogPipeline`, `PIPELINE_VALUES`; `WriteLogInput.pipeline`.
- [ ] `RequestContextService`: добавить `pipeline`/`traceId`/`module` в store + геттеры + `runWith(partial, fn)` (мердж поверх текущего store, чтобы вложенные контексты наследовали request-поля).
- [ ] `LogService.write`: обогащение `pipeline`/`traceId` из ctx (приоритет прямым значениям). По умолчанию `pipeline = SYSTEM`.
- [ ] `DbLoggerBridge implements LoggerService`: форвардит в исходный `ConsoleLogger` + `LogService`. Нормализует pino-стиль (`(objOrMsg, ...params)`): если первый арг — объект, а последний — строка → message=строка, details=объект. Маппинг уровней Nest→Level (`log`→INFO, `verbose`→DEBUG, `debug`→DEBUG, `warn`→WARN, `error`→ERROR/FATAL). Денилист контекстов.
- [ ] `main.ts`: `bufferLogs: true` + `app.useLogger(app.get(DbLoggerBridge))`. Регистрация `DbLoggerBridge` в `LoggingModule` (provider+export).
- [ ] D3: снять `{ provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor }` из `LoggingModule`. Дефолт настроек: `enabledCategories` без REQUEST (или оставить, но интерцептора нет — REQUEST просто не пишется). Файл интерцептора оставляем (не удаляем код), но он больше не подключён.
- [ ] Проверка: `bunx tsc --noEmit` + `bun run lint` чисто. Юнит: `runWith` мердж, нормализация pino-стиля, денилист, маппинг уровней.

### Ф2. Хелперы инструментовки контуров
- [ ] `log-pipeline.ts`: `traceForMeeting(id)`, `traceForOrg`, `traceForUser`, `traceForDoc`, `traceForCron(name)`; `withPipeline(ctx, { pipeline, traceId, module }, fn)` — тонкая обёртка над `runWith`.
- [ ] `instrumentWorker(...)` или mixin: обёртка `process(job)` воркера в нужный pipeline+traceId (выводит meetingId/entityId из `job.data`), + лог `job.start`/`job.done`/`job.failed` (BUSINESS/JOB) с `durationMs`.
- [ ] Проверка сборки.

### Ф3. Контур встречи (флагман) — end-to-end
Сквозная инструментовка цепочки: meetings (FSM/lifecycle) → recordings/egress/S3 → ai transcribe/merge → ai analyze/chapters/tasks → knowledge-core (report-fast/analyze-v2/specialists). У всех `traceId = mtg_<meetingId>`, корректный `pipeline`. Точки: старт/успех/ошибка каждой стадии + ключевые бизнес-результаты (длительности, объёмы, переходы FSM).
- [ ] meetings + livekit (MEETING_LIFECYCLE)
- [ ] recordings + egress + S3 (RECORDING)
- [ ] ai transcription-воркеры (TRANSCRIPTION)
- [ ] ai analysis-воркеры (AI_ANALYSIS)
- [ ] knowledge-core meeting-воркеры (AI_ANALYSIS/KNOWLEDGE_GRAPH)
- [ ] Ручная проверка: одна встреча → в админке вся цепочка по `mtg_<id>`.

### Ф4. Остальные контуры (полное покрытие)
- [ ] KNOWLEDGE_GRAPH (ingest/distill/linker/entity-resolver/theme/specialists/card-rollup/profiles)
- [ ] NOTIFICATIONS (push/events/recognition/concierge/dialog/proactive)
- [ ] AUTH (auth/rbac)
- [ ] BILLING (billing/entitlements/провайдеры)
- [ ] INTEGRATIONS (webhooks-out/tracker/tables/внешние)
- [ ] ONBOARDING (company-foundation/onboarding/role-map)
- [ ] ADMIN + SCHEDULER (cron'ы, retention)
- [ ] Для каждого: pipeline+traceId на точках входа воркеров/сервисов + бизнес-логи.

### Ф5. Админка (UI/UX)
- [ ] Backend: `pipeline` в `SystemLogQuerySchema` + `buildLogWhere`; новый эндпоинт `GET /platform/logs/chain?traceId=` (все записи цепочки по времени, asc); `aggregates` — разрез `byPipeline`.
- [ ] Frontend `domain/system-logs.ts`: `LOG_PIPELINES`, поле `pipeline`/`traceId` в record; `chain` API.
- [ ] `LogsClient.tsx`: фильтр «Контур (pipeline)»; колонка pipeline; в Drawer деталей — кнопка «Показать всю цепочку» (по `traceId`) → отдельный Sheet с timeline (стадии pipeline, статусы, длительности, сворачивание details, подсветка ошибок). StatCard/таб «По контурам».
- [ ] Проверка: front `bun run typecheck` + `lint` + ручная проверка вида цепочки.

### Ф6. Финал
- [ ] backend+frontend tsc/lint/build чисто; юнит-тесты зелёные.
- [ ] second-brain: обновить `01_projects` (logging), `02_architecture/module-map` (DbLoggerBridge, pipeline), `data-model.md` (новое поле/enum/индексы).
- [ ] prod-deploy-log Шаг 4 (prisma push: enum + колонка + 2 индекса), Шаг 1 (если новые ENV).
- [ ] Рефлексия в `05_история/`.

## Итог
**Ф1, Ф2, Ф3, Ф5 — реализованы. Ф4 — широкий проход выполнен (48 воркеров инструментованы).**

- **Ф1.** `SystemLogPipeline` enum + `SystemLog.pipeline` + индексы `[pipeline,createdAt]`/`[traceId,createdAt]`
  (`prisma:push` на проде; локально `prisma:generate`). ALS-контекст расширен (`pipeline/traceId/module` + `runWith`).
  `LogService.write` обогащает pipeline/traceId. **`DbLoggerBridge`** подключён в `main.ts` (`bufferLogs`+`useLogger`).
  REQUEST-интерцептор снят. Юнит-тесты: 36/36 (вкл. 8 на разбор аргументов моста).
- **Ф2.** `log-pipeline.ts`: `traceFor*`, `deriveTraceFromJob`, `withPipelineJob/withPipeline`, `PipelineRunner`.
- **Ф3.** Цепочка встречи: `LivekitEventsHandler.handle` (старт, MEETING_LIFECYCLE/RECORDING) + 11 ai-воркеров
  (transcription/analysis) + 3 kc-воркера (report-fast/analyze-v2/specialists-combined). Общий `traceId=mtg_<id>`.
- **Ф4.** Ещё 34 воркера (knowledge-graph / notifications / integrations / onboarding / ...) через `PipelineRunner.job`
  (traceId автоматически из payload). Остальные `this.logger.*` покрыты мостом (module/level/message без pipeline).
- **Ф5.** Backend: `pipeline`/`traceId` в фильтрах, `GET /platform/logs/chain`, `byPipeline` в агрегатах.
  Frontend: фильтр «Контур (процесс)», колонки Контур/Цепочка, разрез «по контурам», **Drawer «Цепочка»** (timeline),
  русские лейблы всех enum'ов (`LEVEL/CATEGORY/CONTOUR/PIPELINE_LABELS`).
- **Ф7 (WebSocket live-стрим, по запросу заказчика).** `LogStreamGateway` (Socket.IO `/ws/platform-logs`,
  только super_admin) пушит пачки после flush'а буфера; `LogService.write` проставляет `id`+`createdAt`;
  фронт — хук `useLogStream` + тумблер «● Live» (клиентская фильтрация, дедуп, cap 300). Поллинг не нужен.

Проверки: backend `tsc` чисто (кроме предсуществующих `exceljs`-ошибок окружения), `eslint` 0 errors,
`vitest src/modules/logging` 36/36. Frontend `tsc`/`lint` чисто (кроме stale `.next/types`).
Worker-спеки в этом WSL-окружении падают «Worker exited unexpectedly» **и на оригинале** (предсуществующее, не связано).

### Остаётся (долг)
- Сшивка graph-цепочки с meeting-traceId (сейчас kc-graph-воркеры по block/entity-traceId, не mtg_): требует
  проброса `sourceMeetingId` в payload ingest. Отдельным ТЗ.
- Специалисты 3-1..3-14 с нестандартным handler'ом (не `async (job)=>this.process(job)`) — покрыты мостом, но без pipeline-тега. Точечно при необходимости.

## Прод-операции при выкате
- **Схема (Шаг 4)**: `bun run prisma:push` — `SystemLogPipeline` enum + `SystemLog.pipeline` + 2 индекса. Безопасно (nullable-колонка, новый enum).
- Seed/patch/backfill — нет. Старые логи остаются с `pipeline = NULL` (это нормально).
