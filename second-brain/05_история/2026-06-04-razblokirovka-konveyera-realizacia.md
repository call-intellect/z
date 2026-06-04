---
date: 2026-06-04
tags: [knowledge-core, pipeline, transcription, vox, graph, age, specialists, ingest, persons, meeting-status, mtz-1]
distilled: false
---

# Разблокировка конвейера встреча→граф→задачи (МТЗ №1, реализация)

## Что было поставлено

Реализовать МТЗ №1 «Разблокировка конвейера встреча→граф→задачи»
([`plans/tz/2026-06-04-razblokirovka-konveyera.md`](../../plans/tz/2026-06-04-razblokirovka-konveyera.md))
целиком — все 11 фаз, в ветке `feature/pipeline-unblock`. Корень проблемы из аудита
системы агентов (2026-06-04): встречи проходили, отчёт пользователю формировался, но
**граф знаний оставался пустым** — связка Vox→специалисты→canonical→AGE рвалась в
нескольких местах сразу, и каждый разрыв глотал ошибку молча. «Починить только Vox»
было недостаточно — фаз ровно столько, сколько мест разрыва.

## Как решал (по фазам, с коммитами)

- **Ф1 (`d5077155`) — Vox / транскрибация.** ENV `VOX_POLL_INTERVAL_MS` /
  `VOX_POLL_MAX_ATTEMPTS` (через `TypedConfigService`); `AudioTrack.voxTaskId` +
  `TranscriptTrack @@unique([transcriptId, livekitIdentity])` с `upsert` —
  per-track идемпотентность; параллельная транскрибация дорожек (пул 4,
  `Promise.allSettled`); `startedAt` из реального LiveKit
  (`extractEgressInfo.startedAt`). Файлы: `transcribe.worker.ts`, `env.schema.ts`,
  `typed-config.service.ts`, `schema.prisma`, `livekit-events.handler.ts`.
- **Ф2 (`39292119`) — топология специалистов.** ОДИН
  `SpecialistRoutingDispatcherWorker` на очереди `core.specialist-routing` вместо
  14 конкурирующих `Worker`'ов; 14 специалистов стали чистыми
  `@Injectable`-handler'ами (`handle(job)`); неизвестный `jobName` → `throw`;
  машинный гард «один Worker». Файлы: новый `specialist-routing-dispatcher.worker.ts`
  + 14 worker-файлов + `workers.module.ts` + `queues.ts` + role-map/helpfulness.
- **Ф3 (`ac75aca8`) — диспатч на canonical.** Маршрутизация специалистов перенесена
  из `block-ingest` (draft) в `block-distill` `markCanonical`/`mergeInto` (canonical);
  skip-метрика `core_specialist_skipped_total{specialist, reason}` во всех 14
  handler'ах.
- **Ф4 (`e4b6d6f6`) — projection-rebuilder.** `skillTrait.findMany` через
  `profile.tenantId` (у `SkillTrait` нет своего `tenantId`) + settle-обёртка: один
  битый подзапрос не роняет остальные 10 проекций.
- **Ф5 (`ee0bb910`) — AGE.** `ALTER ROLE ... search_path` (postgres-init) +
  per-connection `options` в `PrismaPg` — это и была причина «AGE не виден». Cypher
  развязан из транзакций (post-commit best-effort) в `upsertEntity` / `upsertDecision`
  / `addEdge` / `removeNode` / `removeEdge`; классификация ошибок + метрика
  `kc_typed_entity_failed_total{type, reason}`; при `age_unavailable` RawEvent **НЕ**
  помечается ingested (`throw` → ретрай); kill-switch `graph.ageEnabled` (AdminSetting,
  default true).
- **Ф6 (`eb7462ef`) — пороги графа = живые крутилки.** Геттер `knowledgeCore` на
  `resolveSync` для `linkMinConfidence` / `linkerMinBlocks` /
  `entityGraphMinComentions` / `themeClusteringMinBlocks` / `themeClusterMinSize`;
  ENV-дефолты понижены под малый тенант (LINKER_MIN_BLOCKS 50→3,
  THEME_CLUSTERING_MIN_BLOCKS 100→10, ENTITY_GRAPH_MIN_COMENTIONS 3→2,
  LINK_MIN_CONFIDENCE 0.75→0.5). `v2AgentsEnabled` НАМЕРЕННО оставлен на ENV.
- **Ф7 (`5277caa5`) — мост ingest.** Убран молчаливый `return null` в `analyze.worker`
  (провал → `failureReason` + `meeting_ingest_failed_total{reason}`, статус остаётся
  `ai_ready`); новый fallback-cron `meeting-reingest.cron.ts` (`@Cron('*/15')` —
  встречи с `transcript.turns` без `RawEvent` → идемпотентный `ingestMeeting`).
  Зарегистрирован в `IngestModule`.
- **Ф8 (`22446248`) — dataClassAudit.** `Json?` `dataClassAudit` в `Insight`/`Decision`
  (db push); cron `dataclass-audit-snapshot` обёрнут в `to_regclass`-гард;
  integration-тест + type-гард; дополнен `code-pitfalls.md`.
- **Ф9 (`7cffb1e3`) — Person владельца.** `ensurePersonForUser` (findFirst по userId →
  линковка осиротевшей Person из `membership.personId` → создание с `User.email`/`name`,
  `relationship='employee'`, P2002-устойчиво); `createForOwner` создаёт Person владельца
  + `Membership.personId`; `/me/promises` list graceful (`{items:[]}`), mark остаётся
  403; backfill `backfill-owner-person.ts` (+ STEPS в `apply-prod-deploy`).
- **Ф10 (`78e6cbff`) — free_note.** `SegmentBuilder` распознаёт `kind='free_note'`
  (чистый `text` вместо JSON.stringify-обёртки).
- **Ф11 (`de46e1a9` backend + `daff5f50` frontend) — статус `ai_failed`.** Enum
  `MeetingStatus += ai_failed`; `transcribe`/`merge`/`analyze` `onJobFailed` → `ai_failed`
  (не `failed`), `no_audio_tracks` остаётся `failed`; FSM `meeting-fsm.ts` разрешает
  `ai_failed`; фронт показывает плеер по `hasRecording`, `ai_failed` замаплен
  (`meetingStatusView`), баннер «AI-отчёт не сформирован», публичный shell не прячет
  запись.

## Что вышло (верификация)

- `typecheck` / `lint` / `build` / unit (`vitest`) — **зелёные по всем фазам**
  (фаза-за-фазой, зелёная верификация перед каждым коммитом).
- **НЕ прогнано** (открытый хвост): integration-тесты против реального Postgres
  (с AGE) и боевой харнесс прод-теста встречи — **Docker Desktop не стартовал в среде**.
  Это критично именно здесь: `tsc` зелёный не доказывает работу графа (см. урок ниже),
  а Ф5/Ф8 завязаны на реальные расширения/таблицы Postgres.

## Чему научился / зафиксировать

- **`tsc` слеп к вложенным ключам Prisma → нужен реальный Postgres.** `dataClassAudit`
  в `create` проходил typecheck зелёным, но падал в рантайме `42703 column ... does not
  exist`, пока поля не было в схеме. Зелёный typecheck ≠ работающий граф — для
  knowledge-core нужен интеграционный прогон против БД с AGE. (Уже в `code-pitfalls.md`.)
- **BullMQ: один job → один воркер.** Нельзя ставить per-jobName consumer на общую
  очередь — 14 Worker'ов на `core.specialist-routing` конкурировали, и job мог уйти
  «не тому» и тихо пропасть. Маршрутизация по типу — внутри одного диспетчера.
- **`v2AgentsEnabled` нельзя переводить в `resolveSync`.** Это мастер-флаг прод-выкатки,
  не «крутилка»; перевод в AdminSetting флипнул бы прод-флаг при первом резолве дефолта.
  Граница «крутилка vs флаг выкатки» — load-bearing.
- **Параллельная сессия в общем рабочем каталоге → коллизии git/HEAD.** Был случай,
  когда `amend` приклеился к чужому коммиту другой сессии. Перед волной — `git fetch` +
  `log --since=1h`, и не делать `amend` без проверки, что HEAD — мой.
- **Молчаливый `return null` — главный враг наблюдаемости.** Конвейер «работал», а граф
  был пуст, потому что КАЖДЫЙ разрыв глотал ошибку. Фикс класса: всюду заменить
  silent-skip на `throw` (ретрай) либо метрику-счётчик с `reason`-лейблом.

## Открытые хвосты

- [ ] Integration-тесты против реального Postgres+AGE (нужен живой Docker).
- [ ] Боевой харнесс: реальная встреча → проверить, что граф наполнился
      (IdeaBlock/Entity/Link/Theme непустые на малом тенанте с новыми порогами).
- [ ] Прод-применение: db push (новые поля/enum), `apply-postgres-init` (search_path +
      ALTER ROLE), `backfill-owner-person.ts`, проверка `graph.ageEnabled`. Полная
      инструкция и шаги — ведёт оркестратор в `docs/operations/prod-deploy-log.md`.
- [ ] Проверить `RECORDING_*` и `v2AgentsEnabled` остались на ENV (не утекли в крутилки).
