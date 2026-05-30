---
title: Сводный отчёт расхождений «задумано vs реализовано» по 27 процессам Z
date: 2026-05-29
type: analysis
status: ready_for_review
owner: Сергей
related:
  - plans/analysis/2026-05-29-business-processes-catalog.md
  - plans/tz/2026-05-29-commercial-reliability-package.md
  - second-brain/03_processes/index.md
amendments:
  - "2026-05-29 (поправки после проверки кода): §1.3 (self-referral) — на самом деле уже реализован; §1.6 (auto-invite) — закрыт продуктовым решением Zoom-модели."
---

# Сводный отчёт расхождений «задумано vs реализовано»

## 0. Что в этом документе

Этот отчёт — **итог Волны 2** каталога бизнес-процессов. 27 карточек в `second-brain/03_processes/` написаны по реальному коду (правило `feedback_processes_catalog_verify_with_code`). Здесь — **группировка всех обнаруженных расхождений между задумкой и реальностью** в одном месте, чтобы можно было решать «что чинить в первую очередь».

**Сводка статусов:** 18 ✅ implemented / 9 ⚠️ partial / 0 ❌ designed_only. Это значит, что **«ничего из задуманного не пустое плацебо»** — для каждого процесса в коде хотя бы базовый каркас есть. Расхождения — конкретные шаги внутри процессов.

---

## 1. Критические gap'ы (что **должно работать** по задумке — **не работает**)

Этот раздел — список реальных продуктовых багов. Если ты выкатил фичу и пользователь думает «зафиксировал», но в коде ничего не происходит — это критично.

### 1.1 Telegram free-note не попадает в граф знаний
- **Процесс:** [[telegram-inbox-ingestion]] (Шаг 5)
- **Что должно быть:** свободная заметка из бота → `RawEvent(sourceType='conversational')` → block-ingest → IdeaBlock
- **Что есть в коде:** `ConversationalService.dispatchInbound()` для `type='free_note'` handler **не зарегистрирован**, сообщение пишется в DEBUG-лог и теряется
- **Где фиксить:** `backend/src/modules/conversational/conversational.service.ts:741` — добавить `subscribeInbound('free_note', msg => ingestAdapter.ingestFreeNote(msg))` в `ConversationalModule`
- **Стоимость фикса:** ~30 минут
- **Контраст:** in-app free-note ([[inapp-free-note-ingestion]]) дотянут до конца через REST `/me/notifications/free-note`

### 1.2 Telegram `/myideas` команда отсутствует в коде
- **Процесс:** [[specialist-3-6-ideas]]
- **Что должно быть:** по ТЗ — функциональная команда (зафиксировано в `01_projects/ideas.md` как «теперь функциональна»)
- **Что есть в коде:** `TelegramBotAdapter` принимает только `/login` и `/start`. Ветка `/myideas` отсутствует в `TelegramBotMessageHandler`
- **Возможная причина:** отвалилось при zero-button rip-out (`plans/archive/2026-05-23-sba-beta-1-telegram-max-zero-button-ripout.md`) или не доведено
- **Решение:** либо вернуть команду в бот, либо снять упоминание из задумки

### 1.3 Cold-start gate в Probe — заглушка-всегда-false
- **Процесс:** [[probe-question-flow]]
- **Что должно быть:** на старте новой Org probe-вопросы не отправляются первые N часов (cold-start protection)
- **Что есть в коде:** `probe.service.ts:278` — `return elapsedMs < windowHours * 3600 * 1000 ? false : false;` (оба исхода `false`)
- **Метрика:** `probe_cold_start_dropped_total` стоит на нуле
- **Комментарий в коде:** «упрощаем в β-5»
- **Решение:** либо явно убрать gate из реестра, либо доделать

### 1.4 Skill-profile pipeline `/me/clone` и `/persons/:id/skill-profile` — redirects
- **Процесс:** [[specialist-gamma-1-skill-clone]]
- **Что должно быть по γ-1 ТЗ:** обязательные страницы `/me/clone` (для прозрачности перед носителем) и `/persons/[id]/skill-profile` (manager UI)
- **Что есть в коде:** обе страницы — redirects (`me/clone/page.tsx:5`, `persons/[id]/skill-profile/page.tsx:15`)
- **Причина:** **сознательное** решение Clones=Roles от 2026-05-25 (memory `project_clones_are_role_based`), DoD §16 γ-1 ТЗ отменён
- **Это не баг** — это `superseded` через ТЗ `2026-05-25-clones-role-based-rebrand.md`, нужно обновить `01_projects/skill-and-clone.md` чтобы не путало
- **`/roles/:id/skill-profile`** — REST GET есть (`clones.api.ts:249`), UI-маршрута нет; нужно решение владельца — восстановить или агрегат живёт внутри `/clones/[roleId]`

### 1.5 Tochka prod OAuth и frontend биллинга
- **Процесс:** [[billing-cycle-tochka]]
- **Что должно быть:** Фазы 7 (prod-OAuth) и 9 (~6 frontend-страниц) ТЗ от 2026-05-27
- **Что есть в коде:** backend Tochka-провайдера полный, юнит-тесты есть, но `BillingProviderConfig` пуст в проде; owner-страница `/settings/billing` показывает legacy entitlements; `/admin/orgs/[id]/billing` отсутствует
- **Известный gap** — зафиксирован в исходном ТЗ
- **Заметка:** Фаза 7 — операция владельца (не разработка)

### 1.6 Авто-приглашение гостя на встречу — ✅ ЗАКРЫТО продуктовым решением (2026-05-29)
- **Процесс:** [[meeting-create-and-invite]]
- **Решение владельца:** делаем модель Zoom — одна гостевая ссылка, гость представляется именем при входе (это **уже работает** в коде: [GuestNameForm.tsx:46](../../frontend/src/ui/components/lobby/GuestNameForm.tsx#L46) с `meetingsApi.join(meetingId, { guest_name: trimmed })`), хост может переименовать после встречи (новый endpoint в Фазе 3 ТЗ).
- **Никакие email-приглашения не делаем.** Хост сам шлёт ссылку через любой канал — Telegram, WhatsApp, email от себя.
- **Где зафиксировано:** [`plans/tz/2026-05-29-commercial-reliability-package.md`](../tz/2026-05-29-commercial-reliability-package.md) Фаза 3.

---

## 2. Routing-покрытие специалистов Слоя 3 неполное

Заслуживает отдельного раздела, потому что это **архитектурный gap**, влияющий сразу на несколько процессов.

### 2.1 Router в `core.specialist-routing` диспатчит не все нужные signalType-ы
- **Найдено в** [[specialist-3-3-decisions]], [[specialist-3-2-knowledge-clone]]
- **Что должно быть:** для 3.3 — все блоки `signalType ∈ decision/rationale/decision_basis`; для 3.2 — `expertise`, `experience`, `knowledge_gap`, `personal_request`
- **Что есть:** Router явно диспатчит `decision` (3.3), `fact с employee subject`/`knowledge_gap`/`personal_request` (3.2). Воркер 3.3 готов принять `rationale`/`decision_basis`, но Router их **не присылает**
- **Следствие:** часть блоков обрабатывается только базовым `block-ingest` мимо специалиста
- **Где фиксить:** `backend/src/modules/knowledge-core/services/router.service.ts` (расширить map)

### 2.2 Параллельные legacy-пути
- **Найдено в** [[specialist-3-1-regulations]], [[specialist-3-4-project-customer]]
- **3.1:** `block-ingest.worker → GraphService.upsertEntity` продолжает создавать legacy `Regulation`/`Process`/`Policy` без полей α-7. Существуют параллельно с новым путём через `core.specialist-routing`
- **3.4:** `BlockLinker` ставит `core.card-rollup-v2` в обход специалиста, минуя probe/conflict
- **Следствие:** часть rollup'ов проходит без §5-контракта (без conflict-events и probe-trigger'ов)

### 2.3 Метрика `core_specialist_routing_total{job_name, status}` не эмитится
- **Найдено в** [[specialist-3-1-regulations]] (примечание агента)
- **Воздействие:** в `/admin/platform/workers` нельзя увидеть, сколько jobs прошло через каждого специалиста и сколько упало

---

## 3. Реализовано иначе, чем задумано (sound decisions / квалифицированные отклонения)

Не баги — сознательные отклонения, которые **полезно зафиксировать в задумке**, чтобы не возвращаться через 3 месяца с вопросом «а почему не так?».

### 3.1 ENV для `@Cron` не работает — расписания хардкодом
- **Процессы:** [[theme-clustering]] (`'15 * * * *'`), [[reframing-cycle]] (`'0 3 * * *'`), entity-resolver (`'*/5 * * * *'`), [[specialist-3-5-insights]] (`INSIGHT_CLUSTER_CRON`), [[specialist-3-6-ideas]] (`IDEA_CLUSTERER_CRON`), [[specialist-gamma-1-skill-clone]] (4 ENV)
- **Причина:** `@Cron('expr')` принимает только литералы → ENV-переменные читаются, но не подставляются
- **Воздействие:** изменение расписания требует пересборки
- **Решение:** либо принять как факт, либо мигрировать на `CronManagerService` (он умеет dynamic)

### 3.2 `confidence` карточек — статический `0.9`
- **Процесс:** [[card-rollup-v2]]
- **Что есть:** `CARD_ROLLUP_V2_DEFAULT_CONFIDENCE = 0.9` потому что промпты возвращают prose без structured output
- **Решение:** оставить до доводки structured output во всех промптах

### 3.3 `theme-classify` primary — OpenAI gpt-5.4-nano, не DeepSeek
- **Процесс:** [[theme-clustering]]
- **Расхождение со стандартом** «DeepSeek primary везде» (memory `project_z_infra_and_ai`)
- **Решение:** уточнить, это сознательно (короткие классификации лучше у OpenAI?) или артефакт

### 3.4 Concierge ≠ free-note (in-app)
- **Найдено в** [[inapp-free-note-ingestion]]
- **Что есть:** `ConciergeFloatingButton` — AI-помощник (SBA γ-2), а не точка ввода заметки. Заметка — на `/me/notifications` → `FreeNoteCard` → `POST /me/notifications/free-note`
- **Противоречие с memory `feedback_concierge_entry_visible_button`** (где Concierge — главный вход)
- **Решение владельца:** добавить кнопку «Сохранить как заметку» в Concierge или это останется в `/me/notifications`?

### 3.5 Email-to-task живёт вне ConversationalModule
- **Процесс:** [[email-to-task]]
- **Что есть:** `MailInboundModule` со своим IMAP-cron'ом (`*/2 * * * *`), своей моделью `MailInboundLog`, своими метриками. `Channel(kind='email_imap')` в enum есть, но реального адаптера в `ChannelRegistry` нет
- **Параллельно:** `EmailFetchService` (`ingest/adapters/email/`) — per-tenant Source → RawEvent (другая цепочка)
- **Следствие:** два независимых IMAP-сервиса с копипастом connect-логики
- **Комментарий в коде:** `project-inbox.service.ts:44` — явный долг

### 3.6 `UserChannelPreference` как модель не существует
- **Найдено в** [[notification-dispatch]]
- **Что есть:** preferences живут в `ChannelBinding.preferences: Json` (zod `ChannelBindingPreferencesSchema`), per-binding не per-user
- **Это нормально**, но в архитектурных доках упоминается несуществующая модель — нужно поправить

### 3.7 Атрибуция в реферальной программе — last-touch, не first-touch
- **Процесс:** [[referral-program]]
- **Что есть:** `AttributionService.attributeOrg` ([attribution.service.ts:136-142](../../backend/src/modules/referrals/services/attribution.service.ts#L136)) безусловно перезаписывает `pendingAttributionSlug` — это last-touch.
- **Парадокс:** в [комментарии (line 11-19)](../../backend/src/modules/referrals/services/attribution.service.ts#L11) явно написано «attributeOrg идемпотентно: если у Org уже есть pendingAttributionSlug». То есть автор знал, как правильно, и реализовал противоположно. **Bug в реализации, не дизайн.**
- **Воздействие:** повторный клик по чужой реферальной ссылке отменит первое партнёрство.
- **Фикс:** [`plans/tz/2026-05-29-commercial-reliability-package.md`](../tz/2026-05-29-commercial-reliability-package.md) Фаза 2 — заменить `update` на `updateMany WHERE pendingAttributionSlug IS NULL`.

### 3.8 Self-referral — ✅ УЖЕ РЕАЛИЗОВАН (поправка к первому анализу)
- **Процесс:** [[referral-program]]
- **Что я писал в первом анализе:** «self-referral не блокируется».
- **Что на самом деле:** **уже реализовано.** Метрика `referral_self_referral_denied_total` ([business-metrics.service.ts:1367](../../backend/src/common/metrics/business-metrics.service.ts#L1367)) с пометкой `audit Б6 — попытка self-referral (Referral.ownerUserId совпал с member/owner целевой Org) отклонена`. Плюс дополнительная защита `referral_inn_mismatch_total` ([line 1374](../../backend/src/common/metrics/business-metrics.service.ts#L1374)) — блок при совпадении ИНН партнёра и клиента.
- **Это поправка к моему первому анализу.** Self-referral блок не нужно делать в Фазе 2 ТЗ — он уже работает.

### 3.8 EventEmitter2 для `billing.invoice.paid` — in-memory
- **Процесс:** [[referral-program]]
- **Воздействие:** если webhook и обработчик окажутся на разных backend-инстансах, реф-payout не дойдёт. Сегодня monolith, но при горизонтальном масштабировании сломается

### 3.9 `RoleProfileAgent` не запускается после регистрации
- **Процесс:** [[signup-and-onboarding-wizard]]
- **Что есть:** агент крутится своим cron'ом `0 */4 * * *` независимо. Первый build для новой Org случится в течение 4 часов после ≥5 IdeaBlock'ов
- **Воздействие:** UX «зарегистрировался — увидел свою роль» работает с задержкой
- **Решение:** добавить trigger от signup или принять как факт

### 3.10 Default landing по роли отсутствует
- **Процесс:** [[signup-and-onboarding-wizard]]
- **Что в ТЗ:** разные роли видят разный default landing
- **Что есть:** все идут на `/dashboard`

### 3.11 Онбординг — два разных wizard'а вместо одного
- **Процесс:** [[signup-and-onboarding-wizard]]
- **Найдено:** Блок A `/onboarding/welcome/step-1..6` (форсируется гардом, создаёт документ «Знакомство») + Блок B `/onboarding/company/step-1..5` (отделы/должности/сотрудники/инструкции, owner-only, **не форсируется**)
- **«5-шаговый wizard owner-only»** из задумки = Блок B, но он не запускается автоматически
- **Решение владельца:** обновить `01_projects/onboarding-wizard.md` под фактическую реальность или ввести «онбординг компании» как зонтик

---

## 4. Реализовано **без задумки в ТЗ** (полезные неожиданности — нужно отразить во втором мозге)

### 4.1 `tracker-to-knowledge` адаптер реально работает
- Я в первоначальном предположении считал `partial`, но **commit `3c547f7` от 2026-05-24** содержит полную цепочку: `TrackerEmitterService` (8 emit-методов) → шина `tracker.event_occurred` → `TrackerAdapter.handleTrackerEvent` (`@OnEvent` async) → `IngestService.ingest` → `core.raw-events` → `BlockIngestWorker` со специальной поддержкой `signalTypeHint` override (`block-ingest.worker.ts:183-207`)
- **Нужно отразить** в `01_projects/tracker.md`

### 4.2 Отдельный контур для `ProjectDocument`
- **Где:** commit от 2026-05-27 — второй event-name `tracker.project_document_changed` + второй handler `handleProjectDocumentEvent`
- **Причина:** у документа нет `issue.id`, общий контракт не подходил
- **Дедуп оконный по occurredAt-секунде** — auto-save каждые 3s НЕ создаёт лишние RawEvent
- **Не описано в ТЗ B1-3.1**

### 4.3 `signalTypeHint` fallback на синтетический блок
- **Где:** [[tracker-to-knowledge]]
- **Что:** при 0 LLM-блоков создаётся синтетический блок с факт `status_changed_to_blocked` — чтобы факт не потерялся в графе при пустом fullText
- **Придумано «по ходу»**, не в ТЗ

### 4.4 Debounce 60s в `core.card-rollup-v2`
- **Где:** [[card-rollup-v2]], [[meeting-post-processing]]
- **Что:** сглаживает серии быстрых встреч про одного клиента в один rollup
- **Не описано в ТЗ**

### 4.5 Best-effort try/catch ingest в `AnalyzeWorker`
- **Где:** [[meeting-post-processing]]
- **Что:** если ingest упадёт, AI-отчёт всё равно отдастся пользователю, только warning в логи
- **Не описано в ТЗ**

### 4.6 Tracing model через `llmTaskRouteId`
- **Где:** [[coo-daily-digest]]
- **Что:** поле в `DailyOperationsDigest`, формат `prompt-v1+<model>`. Помогает понять, какая модель сгенерировала каждый отчёт
- **Не описано в ТЗ**

---

## 5. Observability gap'ы

Зафиксировано в разных карточках — собрал в одно место:

| Процесс | Что не покрыто метриками |
|---|---|
| [[billing-cycle-tochka]] | Полное отсутствие `billing_*` / `invoice_*` / `subscription_*` метрик |
| [[referral-program]] | Полное отсутствие `referral_*` метрик |
| [[specialist-3-1-regulations]] и др. | `core_specialist_routing_total{job_name, status}` не эмитится |
| [[probe-question-flow]] | `probe_dispatched_total{kind}` хардкод `'in_app'` независимо от канала |
| [[inapp-free-note-ingestion]] | `conversational_inbound_total{kind=in_app,type=free_note}` не инкрементится для REST-пути |

**Рекомендация:** отдельный план в `plans/analysis/` на минимальный observability-set для коммерческих контуров (биллинг, рефералы) — без них нельзя мониторить продление и выплаты на проде.

---

## 6. Открытые вопросы для владельца

Эти вопросы — там, где требуется бизнес-решение или контекст, который агенты не могли восстановить из кода.

### Архитектурные
1. **`/myideas`** в Telegram — вернуть или web-only?
2. **Concierge** — добавлять «Сохранить как заметку» или оставить заметку на `/me/notifications`?
3. **Cold-start gate в Probe** — фиксировать как «not enforced by design» или закрывать долг?
4. **`Channel(kind='email_imap')`** в schema без адаптера — зарезервировано под объединение `MailInboundModule` + `ConversationalModule` или старый артефакт?
5. **Один Org per user** — действительно жёсткий контракт? Сейчас user в 2 Org получит 2 разных binding-набора
6. **`SPECIALISTS_COMBINED_ENABLED`** — отдельный процесс или вариант текущего routing?

### Встречи
7. **Race `egress_ended` vs `room_finished`** — есть ли страховка (retry/idle-cron)?
8. **Per-tariff retention для записей** — явное «сделаем позже» или забытое требование?
9. **Subtitles в активной встрече** — нужны для текущего ICP или MVP без них?

### Биллинг
10. **Self-referral** (партнёр кликает по своей ссылке) — блокировать?
11. **Фаза 7 Tochka** — считать это разработкой или эксплуатацией для статуса `partial` vs `implemented (требует prod-операции)`?

### Слой 3
12. **`/roles/:id/skill-profile` UI** — восстановить или агрегат живёт внутри `/clones/[roleId]`?
13. **`patch-backfill-card-versions.ts`** на проде применён?
14. **`IssueOverdueDetectorCron`** — пороги 1/3/7 дней разными signalType-ами?
15. **`comment.created` для голосовых** — гард на длину transcript?
16. **POST `/projects/from-template`** возвращает 501 — забытый wiring или намеренное?

---

## 7. Приоритизация — что чинить в первую очередь

Моя рекомендация по группам приоритетов. Не план — повод обсудить.

### P0 — критичные баги в проде (≤1 день каждый)
1. **§1.1** Telegram free-note handler (~1 час) — самый дешёвый и заметный фикс
2. **§3.7** First-touch вместо last-touch (риск денежных споров с партнёрами)

### P1 — продуктовые расхождения (1-3 дня)
3. **§1.6** Zoom-модель + endpoint переименования гостя (≤1 день, после решения владельца 2026-05-29)
4. ~~**§2.1** Router 3.3/3.2~~ — вынесено за пределы пакета, передано другому сотруднику.
5. **§5** Observability для биллинга и рефералов (минимальный набор, 1 день)

**Финальный пакет:** см. [`plans/tz/2026-05-29-commercial-reliability-package.md`](../tz/2026-05-29-commercial-reliability-package.md) — 4 фазы, 2.5-3 дня.

### P2 — техдолг с продуктовым следствием (1 неделя)
6. **§2.2** Legacy-пути в 3.1 и 3.4 — мигрировать или явно `@deprecated`
7. **§3.5** Объединение `MailInboundModule` ↔ `ConversationalModule` или фиксация раздельности

### P3 — обновление задумки в second-brain (без кода)
8. **§3.11** Онбординг (два блока вместо одного) — обновить `01_projects/onboarding-wizard.md`
9. **§1.4** Skill-profile — финализировать `01_projects/skill-and-clone.md` под Clones=Roles
10. **§4.1-4.6** Описать неожиданные реализации в profile-документах

---

## 8. Как пользоваться этим документом дальше

- **Когда что-то ломается** — открыть нужную карточку процесса (через [[03_processes/index]]), посмотреть раздел 6 (точки отказа) и раздел 8 (расхождения).
- **При планировании работы** — проверить, нет ли в §6 этого отчёта связанного открытого вопроса.
- **Перед изменением архитектуры** — обновить раздел 8 затронутой карточки и `last_audited` дату.
- **Раз в квартал** — пересмотр статусов: что переехало из `partial` в `implemented`, какие новые процессы появились.

---

## 9. Что осталось не сделано в каталоге

Не процессы, не вошедшие в первый круг (за пределами 27):
- **Простой инцидент** (security/data-leak/feature-failure) — нет процесса описания
- **Apache AGE rebuild graph** — отдельный технический процесс, не бизнес
- **Document-ingest** (PDF/DOCX → каркас) — упомянут вскользь в `raw-event-to-graph`, но достоин отдельной карточки
- **Knowledge-search (POST /api/v1/knowledge/search)** — это API, не процесс, но возможно стоит карточку про сценарий поиска

Решение по добавке — за владельцем после первого использования каталога.
