---
type: project
status: implemented
phase: SBA γ-1
date: 2026-05-22
---

# SBA γ-1 — SkillProfile + ExecutablePersona + Clone API

## Что это

Финальная фаза SBA — **Employee Clones**. Самая чувствительная зона: клоны сотрудников. Skill — рабочий артефакт компании, не персональные данные сотрудника.

Главные сущности:
- **SkillProfile** (1:1 с Person для `relationship='employee'`) — навыковый профиль сотрудника.
- **SkillTrait** — отдельная черта подхода к решениям. Эмерджентная категория (LLM придумывает), гипотезная формулировка («похоже»/«склонен»/«в большинстве случаев»).
- **ExecutablePersona** — версионированный snapshot «думай как X» / «думай как Role». Используется как system prompt при ответе клона.

## Источник данных

Только `IdeaBlockEntity.role='subject'` от Person с `signalType ∈ {reasoning, rationale, decision_basis}` (где сам сотрудник объясняет «почему я так решил»). Минимум `SKILL_MIN_OBSERVATIONS=5` цитат для появления trait'а.

**НЕ источник:** mentioned-блоки, не-reasoning signalType, внешние Person'ы (relationship≠'employee').

> ⚠️ **Вскрыто боевым прод-тестом 2026-06-22** ([[../05_история/2026-06-22-clone-prod-test-and-signaltype-tz]]): узкий набор `{reasoning, rationale, decision_basis}` — узкое место. block-ingest метит «как сотрудник работает» как `methodology_step` («Шаг методологии»), а не `reasoning` → эти блоки до клона НЕ доходят, профиль не наполняется (у активных Org 0 клонов). Гейт `<5` делает полный skip. Фикс (расширить набор на `methodology_step`, единая константа + 3 рубежа + backfill) — ТЗ [`plans/tz/2026-06-22-clone-signaltype-methodology-step.md`](../../plans/tz/2026-06-22-clone-signaltype-methodology-step.md), реализация не начата. Набор скопирован литералом в ≥6 местах — рассинхрон и есть корень.

## Жизненный цикл

| Event | Action |
|---|---|
| `signalType='reasoning'` блок canonical → RouterService dispatch | enqueue `core.specialist-routing` jobName='3-7-skill' |
| Worker диспетчер находит subject-Person employee → создаёт/получает SkillProfile | enqueue `core.skill-profile-rebuild` (debounce 60s) |
| RebuildWorker → `Specialist37Service.rebuildProfile` | KNN-группировка блоков → LLM skill-trait-detect → KNN-merge с активными → decay |
| Person.relationship → `former` | `SkillProfile.status='archived'`, snapshots остаются |
| Person.relationship → `candidate` | `paused_relationship` |
| Person.relationship → `employee` (возврат) | `active` |

## Auto-canonical (без pre-approval)

Skill traits **НЕ проходят** через `CurationService.triage` pre-approval. Auto-canonical при confidence>=medium. Manager mark_as_misleading **постфактум** (через `POST /api/v1/clones/skill-traits/:id/mark-misleading` + новый enum `CurationDecisionType.mark_as_misleading`).

## Видимость (RBAC)

| Кто | Что видит |
|---|---|
| owner / admin | Все профили Org |
| direct manager | Профили подчинённых (Membership.role='manager' + та же primaryDepartment) |
| Сам носитель | Только факт существования + `/me/clone` (диалог) |
| Прочие member'ы | НЕТ доступа |

В UI `/persons/:id/skill-profile` подмечает кнопкой «Помечу неверным» только тем, у кого есть `canMarkMisleading` (owner/admin/direct manager). Носитель не может помечать собственные traits — это post-hoc контроль.

## Crons (3 шт.)

| Cron | Расписание | Назначение |
|---|---|---|
| `SkillProfileRecalibrateCron` | `0 5 * * *` | Daily decay (high→medium→low) + archive старых traits |
| `ExecutablePersonaBuildCron` | `0 6 * * SUN` | Weekly snapshots scope='person' + scope='role' (агрегат) |
| `SkillManagerDigestCron` | `0 9 * * MON` | Weekly digest direct manager'ам «новые черты у подчинённых» |

## API

| Endpoint | Что делает |
|---|---|
| `POST /api/v1/clones/persons/:personId/ask` | Ответ от клона сотрудника. Rate limit 20/сутки. Mode='clone_style'. |
| `POST /api/v1/clones/roles/:roleId/ask` | Ответ от агрегатного клона роли (top traits всех employee'ев). |
| `GET /api/v1/clones/persons/:personId/skill-profile` | Read профиля для manager/admin/self. |
| `GET /api/v1/clones/roles/:roleId/skill-profile` | Агрегатный профиль роли + список людей. |
| `POST /api/v1/clones/skill-traits/:traitId/mark-misleading` | Manager/admin помечает trait как неверный. |

## UI (ОБЯЗАТЕЛЬНОЕ)

- `/me/clone` — обязательная страница «Попробовать своего клона» (зонтичный §3.3 правило C5).
- `/persons/:id/skill-profile` — для manager / admin / self.
- `/roles/:id/skill-profile` — агрегат + кнопка «попробовать клона роли».

**НЕ показывается:** кнопка «отключить наблюдение» (§3.4 — никаких прав скрытия от руководителя).

## LLM (4 taskType)

| TaskType | Primary | Secondary | Tertiary |
|---|---|---|---|
| `skill-trait-detect` (⚠ критично) | `deepseek:deepseek-v4-pro` | `openai-via-proxy:gpt-5.4` | `ollama:qwen3:30b` |
| `skill-trait-merge` | `deepseek:deepseek-v4-flash` | `openai-via-proxy:gpt-5.4-mini` | `ollama:qwen3:30b` |
| `executable-persona-compile` | `deepseek:deepseek-v4-flash` | `openai-via-proxy:gpt-5.4-mini` | `ollama:qwen3:30b` |
| `clone-respond` | `deepseek:deepseek-v4-flash` | `openai-via-proxy:gpt-5.4-mini` | `ollama:qwen3:30b` |

⚠ `skill-trait-detect` — primary должна быть capable. **Решение по primary 2026-05-25 (Фаза 6.1):** прогон golden-набора на двух моделях — `deepseek-v4-pro` 24/25 (96%) при $0.02 против `gpt-5.4` 23/25 (92%) при $0.10. Переключили. `pinnedVersionNote` заполнено в seed: «Закреплено на deepseek-v4-pro 2026-05-25...». **Перед сменой primary — обязательно прогнать** `SKILL_TRAIT_DETECT_GOLDEN_REAL=1 bunx vitest run backend/test/eval/skill-trait-detect-golden` + snapshot-тест seed сломается на любой правке цепочки.

## Метрики

- `skill_profiles_active_total` (gauge)
- `skill_traits_per_profile` (histogram)
- `skill_traits_marked_misleading_total{category}` (counter)
- `persona_active_total{scope}` (gauge)
- `persona_build_duration_seconds` (histogram)
- `clone_ask_total{scope}` (counter)
- `clone_ask_by_owner_total` (counter — engagement)
- `core_specialist_*{type='skill_trait'}` стандартные.

## Probe-events

| Reason | Trigger | Recipient |
|---|---|---|
| `skill.profile_starved` | Employee >3 мес, reasoning-блоков <5 за 3 мес | Direct manager (fallback admins) |
| `skill.contradicting_traits` | Новый trait противоречит существующему high-confidence | Direct manager |

## Открытые вопросы (решения γ-1)

1. **SkillTrait.category — Text-поле** в γ-1 (отдельная модель — γ+).
2. **ExecutablePersona — раз в неделю (cron) + on-demand rebuild** через ClonesService при отсутствии active snapshot.
3. **Manager visibility — direct manager** (1 уровень).
4. **«Попробовать своего клона» для пустых профилей <3 traits** — disabled с tooltip.
5. **Rate limit Clone API (актуальное, ТЗ 2026-05-31)** — единая per-user дневная квота `ai_chat_messages_per_day` через `AiChatQuotaService` (модуль `ai-chat-quota`, глобальный): Concierge + клоны считаются ОДНИМ счётчиком на пользователя. Лимит по роли в Org: admin (owner/admin/coo) → `AI_CHAT_DAILY_LIMIT_ADMIN=50`, остальные → `AI_CHAT_DAILY_LIMIT_MEMBER=20`. UI читает через `GET /api/v1/me/ai-chat/quota`. Старый ENV `CLONE_ASK_PER_USER_PER_DAY=20` и Redis-ключ `clone:ask:*` — **deprecated** (оставлены как code-fallback для безопасного rollback, в следующем выкате удалим). См. ТЗ [`2026-05-31-ai-chat-quota-unified-per-user`](../../plans/archive/2026-05-31-ai-chat-quota-unified-per-user.md).

## Чувствительность

Этот sub-TZ — самый чувствительный во всём SBA. Любая ошибка в формулировках, утечка manager-видимости носителю, потеря качества `skill-trait-detect` — подорвёт восприятие продукта. После deploy 1–2 dev-куратора должны лично подтвердить «traits похожи на правду» (manager validation note).

## Доработки 2026-05-25 — clone-reliability-hardening

ТЗ: [`plans/archive/2026-05-25-clone-reliability-hardening.md`](../../plans/archive/2026-05-25-clone-reliability-hardening.md). Закрыто 7 фаз из 8 (см. рефлексию [`05_история/2026-05-25-clone-reliability-hardening-wave.md`](../05_история/2026-05-25-clone-reliability-hardening-wave.md)).

### Что изменилось в γ-1 после доработок

| Аспект | Было до 2026-05-25 | Стало после |
|---|---|---|
| Антифальшивка | Одна строка в промпте `clone-respond.prompt.ts` (пункт 6). | **Программное правило** в [`ClonesService.askPerson`/`askRole`](../../backend/src/modules/clones/services/clones.service.ts) до вызова LLM: `cfg.skill.cloneTopicMinBlocks=2` блоков с косинусной близостью >= `cfg.skill.cloneTopicSimilarityThreshold=0.70` к вопросу — иначе отказ без LLM. DTO `refused`/`refusalReason`, метрика `clone_ask_refused_total{reason}`. Snapshot-тест на промпт + integration-тест 3-х сценариев. |
| Категории SkillTrait у разных людей | Эмерджентный текст без нормализации — три формулировки одной черты у трёх человек считались разными. | См. [[skill-trait-concepts]] — модель `SkillTraitConcept` с порогом совпадения 0.85 и порогом слияния 0.92. Cron `0 3 * * *` сливает близкие концепты, LLM `skill-trait-concept-name` (DeepSeek V4 Flash) предлагает каноническое имя только при слиянии 2+. |
| Probe-получатель | Только админы (нет поля «глава отдела»). | `Department.headPersonId` + общий helper [`resolveProbeRecipients`](../../backend/src/modules/knowledge-core/services/probe-recipient.util.ts): глава отдела → fallback к admin/owner. |
| Триггер пересборки персоны | Только cron раз в неделю (вс 06:00). | Cron `0 */2 * * *`, реактивный по `cfg.skill.personaRebuildTraitDeltaThreshold=2` новых traits за 24ч ИЛИ `personaRebuildMaxAgeHours=48`. Кнопка «Обновить клона» на `/me/clone`, в чате клона и на `/persons/[id]/skill-profile` (при `canMarkMisleading=true`). |
| Заморозка модели | Только комментарий в seed-script. | Поле `LlmTaskRoute.pinnedVersionNote` + snapshot-тест [`seed-llm-task-routes-skill-and-clone.snapshot.spec.ts`](../../backend/scripts/seed-llm-task-routes-skill-and-clone.snapshot.spec.ts) — фиксирует точные provider/model для 4 цепочек. Любая правка → snapshot ломается. UI `/admin/llm-routes` показывает warning для критичного списка `{skill-trait-detect, clone-respond, block-ingest}` при пустой заметке. |
| Golden-набор | Не было. | [`backend/test/eval/skill-trait-detect-golden/`](../../backend/test/eval/skill-trait-detect-golden/) — 20 валидных + 5 reject фикстур, 84 unit-теста, инварианты `categoryKeywords` / `statementContainsQualifier` / `forbiddenWords` против приговорного стиля. Реальный прогон через LLM включается `SKILL_TRAIT_DETECT_GOLDEN_REAL=1`. |

### Фаза 6.1 — реализована 2026-05-25

✅ **Закрыта.** Цепочка событий:
1. Параллельный фикс владельца — коммит `a8b2ab6 feat(ai/deepseek): авто-конвертация json_schema → tool для V4-Pro` + рефлексия `8f8ad86`. `DeepSeekService.buildParams` теперь автоконвертит `response_format: json_schema strict` в `tools[]` + `tool_choice: 'auto'` с виртуальным tool `submit_<schemaName>`, а `mapResponse` читает результат из `tool_calls[0].input` обратно в `text`. Это сняло технический блокер.
2. Реальный прогон golden-набора `backend/test/eval/skill-trait-detect-golden/` под `SKILL_TRAIT_DETECT_GOLDEN_REAL=1` на двух моделях: `deepseek-v4-pro` 24/25 (96%) при $0.02 против `gpt-5.4` 23/25 (92%) при $0.10. DeepSeek победил по обоим показателям.
3. Решение владельца — переключить. Правка в [`seed-llm-task-routes-skill-and-clone.ts`](../../backend/scripts/seed-llm-task-routes-skill-and-clone.ts): primary `deepseek:deepseek-v4-pro`, secondary (страховка) `openai-via-proxy:gpt-5.4`. Snapshot-тест обновлён через `bunx vitest --update`.
4. `pinnedVersionNote` для `skill-trait-detect` заполнено прямо в seed (поле в `LlmTaskRoute`, синхронизируется на все tier-записи) с описанием результатов прогона.

Применить на проде: `bun run scripts/seed-llm-task-routes-skill-and-clone.ts --update-existing` (если у Org нет `editedByAdmin=true` на этих роутах) ИЛИ через UI `/admin/llm-routes` вручную для каждой Org.

## Доработки 2026-05-26 — clone-respond v2 (Фаза 7 §9)

**Источник:** [`plans/archive/2026-05-25-llm-architecture-changes-from-experiments.md`](../../plans/archive/2026-05-25-llm-architecture-changes-from-experiments.md) — Фаза 7 §9. Раскатана в рамках общей миграции LLM на DeepSeek V4 Pro.

Цель — поднять качество диалога с клоном на уровень chat-v2 (multi-query expansion + temporal filter + history) без потери антифальшивки и сохранить дешёвую one-shot ветку для quick-look сценариев.

| Аспект | Было (γ-1) | Стало (v2, под флагом `CLONE_V2_ENABLED`) |
|---|---|---|
| Сценарий | Только one-shot `POST /clones/.../ask` (без памяти диалога) | + новый многотуровый `POST /clones/persons/:id/conversations` и `POST /clones/roles/:id/conversations` поверх `ChatV2Conversation(mode='clone_style')` |
| TaskType | `clone-respond` (DeepSeek flash) | `dialog-multi-query-clone` (**DeepSeek V4 Pro** → gpt-5.4 → qwen3.5:9b) |
| Retrieval | Прямой KNN по embeddings вопроса | Dialog-layer: расширение запроса (multi-query) + temporal-фильтр `validAt` (поддержка «что мы знали тогда», как у chat-v2 SBA α-5) |
| Режимы | Только нейтральный | `factual` (только подтверждённые блоки) и `judgmental` (можно делать выводы / оценки на стиле носителя — но с тем же дисклеймером и антифальшивкой) |
| Доступ | Чистый RBAC (owner/admin/self/manager) | + явный ACL через модель **`CloneAccessGrant`** (см. [[../02_architecture/data-model]] §Clones v2) — per-pair (grantee × subject) с опц. `expiresAt` и `revokedAt` |
| Антифальшивка | ≥2 reasoning-блока с cosine≥0.70 | **Без изменений** — программное правило живёт до LLM, действует одинаково на v1 и v2 |
| Дисклеймер | Обязательный «(клон; могу ошибаться)» | **Без изменений** |
| Флаг | — | `CLONE_V2_ENABLED` (default off). v1 и v2 живут параллельно для A/B. |

Связанные изменения:
- API: добавлены 2 endpoint'а в [[api-layer]] §Clones.
- LLM: добавлен taskType `dialog-multi-query-clone` в [[ai-jobs]] (массовая миграция на Pro).
- DB: новая модель `CloneAccessGrant` в [[../02_architecture/data-model]].

⚠ **Ролевые клоны** (решение 2026-05-25, см. memory `project_clones_are_role_based`) сохраняются: ExecutablePersona строится по должности; UI — только `/clones` и `/roles/[id]/clone`. v2-эндпоинты под persona предусмотрены ради коллабораций («дай мне поговорить с клоном Маши»), но в UI остаются ролевые карточки, а персональный доступ закрывается через `CloneAccessGrant`.

## Доработки 2026-05-26 — CloneAccessGrant admin CRUD + frontend marketplace

**Источники:**
- [`plans/archive/2026-05-26-clone-access-grant-admin-api.md`](../../plans/archive/2026-05-26-clone-access-grant-admin-api.md) — admin CRUD + патч-миграция + фикс RBAC (Задачи 1/2/4 копилки follow-up).
- [`plans/archive/2026-05-26-clones-marketplace-frontend.md`](../../plans/archive/2026-05-26-clones-marketplace-frontend.md) — frontend маркетплейс + admin-страница.

Коммиты: `fc3d6fe` (rbac+schema), `c96505a` (admin/user API), `87fef5d` (patch-скрипт), `578a777` (user UI), `eab4d8f` (admin UI).

### Модель доступа CloneAccessGrant — финальные правила

| Правило B | Кто получает грант | Когда |
|---|---|---|
| Носитель роли | Свой role-клон | Active `Appointment` (validTo IS NULL, status IN active/acting), у Person есть `userId` |
| Manager того же department | Role-клоны подчинённых | `Membership.role='manager'` + Person в том же `primaryDepartmentId` |
| Owner / admin Org | Все активные role-клоны Org | По одному гранту на каждый клон |
| Person-клоны (`cloneType='person'`) | **НЕ выдаются автоматически** | Клоны ролевые — личные доступы открывает админ point-and-click через `/admin/clones` |

**Поля схемы** (см. [[../02_architecture/data-model]] §Clones v2): `cloneType` + `cloneRefId` + `grantedToUserId` + `grantedById` + `grantedAt` + (новое 2026-05-26) `revokedAt` + `revokedBy` + `expiresAt`. Unique-индекс `(tenantId, grantedToUserId, cloneType, cloneRefId)` гарантирует одну активную/revoked запись на пару (получатель × клон). При re-grant поверх revoked старая запись физически удаляется в транзакции — audit-trail остаётся в `AdminAuditLog`.

**Фильтр активности (фикс RBAC).** `RbacService.canAccessPersonClone` / `canAccessRoleClone` теперь делают `findFirst` с условием `revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now())`. Helper'ы `RbacService.buildActiveGrantWhere(tenantId, userId, cloneType, cloneRefId)` (SQL where) и `isGrantActive(grant)` (in-memory). До фикса `findUnique` принимал revoked/expired гранты как валидные — скрытый баг, теперь покрыт 14 кейсами в `rbac-clone-access.spec.ts`.

### Идемпотентный patch-скрипт первичной миграции

`backend/scripts/patch-migrate-clone-access.ts` — запускается перед включением `CLONE_V2_ENABLED=true` на проде. На пустом проде даёт 0 записей (мы стартуем без активных Appointment'ов с userId). Через `createMany({ skipDuplicates: true })` опираясь на unique-индекс — повторный запуск = no-op. Флаг `--tenant <orgId>` для отладки. `grantedById` — первый owner Org по `joinedAt asc` (детерминированно), иначе первый admin, иначе пропуск тенанта с warn-лог.

### Admin CRUD + in-app уведомления

5 endpoints под `/api/v1/admin/clones/access-grants` (см. [[api-layer]] §Clones admin). `AdminAuditInterceptor.classifyAction` расширен 3 ветками: `grant_clone_access` / `revoke_clone_access` / `extend_clone_access` (severity `high` — `reason` обязателен).

При создании гранта (НЕ при revoke / extend) `ConversationalService.sendNotification` шлёт `eventType=clone.access_granted` (in-app + Telegram). Try/catch вокруг — notification-failure не откатывает grant (warn-log). Frontend подсвечивает новые гранты через хук `useUnseenCloneGrants`.

### User API + frontend маркетплейс

- `GET /api/v1/me/clone-access` — что мне выдано (для `useMyCloneAccess` хука; грейсфул на 404).
- `GET /api/v1/clones/conversations?cloneType&cloneRefId` — мои диалоги с клоном. Cursor-pagination (cursor — UUID, **не cuid** — ловушка из исходной ТЗ). Маппинг на `ChatV2Conversation(scope='card')` — отдельной модели `CloneConversation` в проекте нет, диалог это «обёртка над chat-v2».
- Маршруты `/clones`, `/clones/[roleId]`, `/clones/[roleId]/chat/[conversationId]`, `/admin/clones` — см. [[frontend-pages]] §«Clones — маркетплейс».

## Доработки 2026-06-08 — качество клона сотрудника (8 фаз)

**Источник:** ТЗ [`plans/tz/2026-06-08-clone-quality-improvements.md`](../../plans/tz/2026-06-08-clone-quality-improvements.md). Ветка `feature/2026-06-08-tz-batch-tables-clones-shipon` (коммиты `dbf9b0d4`, `8446e89a`, `fc8901fe`, `3376fae1`, `2b59c8da`, `4c28bea1`). Цель — устранить системные искажения в построении профиля и persona. Схема (новый enum) — [[../02_architecture/data-model]] §SkillTraitStatus; новый taskType/cron — [[ai-jobs]], [[workers-queues]]; chatbox-атрибуция по говорящему — [[knowledge-clone]].

| Фаза | Что изменилось | Файл/механизм |
|---|---|---|
| **Ф2 (B+C) — confidence из дат + атомарность** | `mergeIntoExisting` пересчитывает confidence трейта из числа **разных дат** блоков-источников (по `createdAt`: ≥4 разных дат → high, ≥2 → medium), берёт **MAX** с текущим (не понижает при merge). `statement` + `embedding` обновляются **вместе в одной транзакции** (либо оба, либо ни одного — нет рассинхрона текста и вектора). | `specialist-3-7-skill` merge-сервис |
| **Ф3 (D) — verify-гейт (grounding)** | Новая черта создаётся в статусе `pending_verification` (`createNewTraitRaw`), **в persona НЕ попадает** до проверки. Ночной `Specialist37Service.verifyPendingTraits()` (LLM `skill-trait-verify`) grounding'ом сверяет формулировку с цитатами: grounded → `active`, иначе → `held`. **FAIL-OPEN:** ошибка LLM → `active` (не блокируем профиль из-за сбоя). Enum-член `SkillTraitStatus.pending_verification` (миграция `20260608120000_add_skill_trait_pending_verification`), cron `SkillTraitVerifyCron @Cron('30 3 * * *')`. | `verifyPendingTraits`, новый taskType+промпт `skill_trait_verify_v1` (primary `deepseek-v4-flash`) |
| **Ф4 (E) — split-floor (порог появления)** | Минимум наблюдений вынесен в два тумблера через `getDynamic`: `knowledge.skillProfileMinObservations` (fallback — текущий `minObservations`) и `knowledge.skillClusterMinObservations` (fallback 3). Клон формируется на разрежённых данных, профиль появляется раньше. | AdminSetting |
| **Ф5 (F) — арбитраж мёртвой зоны merge** | `ARBITRATION_FLOOR=0.78`: кандидаты на слияние в полосе `[0.78, 0.85)` («band») **судятся LLM-арбитром** (`skill-trait-merge`), а не форсятся как новая черта. Бакет (band/clear) передаётся в USER-шаблон арбитра. | merge-сервис |
| **Ф6 (G) — clone-respond без понижения анти-дипфейка** | Режим `judgmental` **больше не понижает** анти-дипфейк-порог: оба режима (`factual`/`judgmental`) держат `cloneTopicMinBlocks=2` и cosine ≥ 0.70. `parseCitations` парсит `[DECISION:id]` наравне с `[BLOCK:id]`. **SYSTEM-промпт не тронут** (prompt-cache сохранён). | `ClonesService` |
| **Ф7 (H) — дедуп черт при сборке role-persona** | `executable-persona-build.service.ts buildForRole`: `dedupeTraitsByConcept` схлопывает черты одного `conceptId` от N сотрудников в одного представителя (max `observationCount`, при равенстве — выше `confidence`). Раньше одна и та же черта от трёх человек попадала в role-persona трижды. | `buildForRole` |
| **Ф1 (A)** | chatbox-атрибуция по говорящему — см. [[knowledge-clone]] §«Атрибуция по говорящему». | — |

**Класс-фикс decay (Ф2).** Шаг затухания `runDecay` приведён к **одной ступени за проход** (medium→low выполняется ДО high→medium, иначе свежий high за один прогон проваливался сразу в low). Тот же двойной-шаг исправлен и в `skill-profile-recalibrate.cron.ts` — это был один баг-класс в двух местах (см. [[../02_architecture/code-pitfalls]] §«Decay двойной шаг»).

**Тесты:** knowledge-core + clones + chatbox — 530 тестов зелёные.

## Доработки 2026-06-12 — слой метода клона (clone-persona-method-layer)

**Источник:** ТЗ [`plans/archive/2026-06-11-clone-persona-method-layer.md`](../../plans/archive/2026-06-11-clone-persona-method-layer.md) (8 фаз, ветка `feature/clone-persona-method-layer`, коммиты `6e8b470f..41289726`). Цель — достроить клону роли **наблюдаемый МЕТОД работы** (а не психотип): ценности из проявленного поведения, принципы решений (Reflection-слой), методология «ситуация→ход» (RPD — Recognition-Primed Decision, распознавание ситуации по образцу) и разовое CDM-интервью носителя (Critical Decision Method — ретроспективный разбор решений). Схема — [[../02_architecture/data-model]] §«Слой метода клона»; taskType — [[ai-jobs]]; cron'ы — [[workers-queues]]; флаги — [`docs/operations/feature-flags.md`](../../docs/operations/feature-flags.md).

### Таблица слоёв

| Слой / что добавлено | Файл / механизм | Флаг (все kill-switch ON) |
|---|---|---|
| **Э0.1 — grounding-гейт clone-respond v2**: пост-LLM проверка — factual-ответ без единой валидной цитаты `[BLOCK:id]`/`[DECISION:id]` из subgraph заменяется программным отказом `'ungrounded'` (judgmental не гейтится — его SYSTEM запрещает цитаты в тексте); SYSTEM-промпты обоих режимов получили правило честного частичного пробела | `clones.service.ts` (все 4 пути ask) + `clone-respond.prompt.ts` | `CLONE_RESPOND_GROUNDING_ENABLED` |
| **Э0.1 — журнал CloneQueryLog**: каждый ask (вкл. отказы) пишет запись (cloneScope, cloneTargetId, userId, questionPreview 200, questionHash sha256, answeredGrounded, refusalReason); новый endpoint **`GET /api/v1/clones/query-log`** (OrgAdminGuard, пагинация limit/offset, фильтр cloneTargetId) — см. [[api-layer]] §Clones | `clones.controller.ts:114`, модель `CloneQueryLog` | — (часть Э0.1) |
| **Э1.1 — миграция** `20260612000000_clone_method_layer`: модель `RolePrinciple` + enum `SkillTraitLayer` + колонка `SkillTrait.layer` (default `skill`) + `CloneQueryLog` + HNSW-индекс `role_principles.embedding` | `prisma/migrations/`, `postgres-init.sql` | — |
| **Э1.2 — Reflection-синтез принципов роли**: ночной cron собирает subject-reasoning блоки должности (union PersonRole+Appointment) → группировка cosine 0.78 → LLM `role-principle-synthesize` → валидация (sourceBlockIds⊆входных, ≥2; код-гард диагностической лексики) → дедуп по embedding 0.85 (merge/create). Пороги — AdminSetting `knowledge.rolePrincipleMinObservations` (5) / `knowledge.rolePrincipleDedupThreshold` (0.85). Метрики `role_principles_synthesized_total{outcome}`, `role_principles_active_total` | `RolePrincipleSynthesisService` + `RolePrincipleSynthesisCron` (`@Cron('30 5 * * *')`, Redis-lock, MAX 100 ролей/проход) | `ROLE_PRINCIPLE_SYNTHESIS_ENABLED` |
| **Э1.3 — детектор ценностей/мотивации**: второй проход в `Specialist37Service.rebuildProfile` — ценность извлекается ТОЛЬКО из выбора-в-ущерб (revealed preference — проявленное предпочтение); KNN-merge с фильтром по layer; пишет `SkillTrait layer=value\|motivation` | taskType `value-motivation-detect` (flash) | `VALUE_MOTIVATION_DETECT_ENABLED` |
| **Э2.1 — активация PracticeSkill**: retrieval подмешивает активные процедуры («ситуация→ход») в clone-respond — смена дефолта false→true | существующий `PracticeSkill`-конвейер (extraction/evaluator не гейтятся) | `PRACTICE_SKILLS_ENABLED` (дефолт сменён) |
| **Э2.1 — детектор маркеров процесса**: третий проход в rebuild — только конструктивные оси («перечисляет критерии», «перепроверяет данными»); код-гард стоп-маркеров («избегает / не решает сам / нерешителен…») → `SkillTrait layer=process_marker` | taskType `process-marker-detect` (flash) | `PROCESS_MARKER_DETECT_ENABLED` |
| **Э3.1 — CDM-интервью через probe**: новый reason `skill.cdm_interview` — Кора по свежим reasoning-кейсам сама задаёт носителю до 5 не наводящих вопросов (лимит `knowledge.cdmInterviewMaxQuestions`=5 + cooldown `knowledge.cdmInterviewCooldownDays`=7); probe-dispatcher НЕ переформулирует CDM-вопрос; ответ → `RawEvent` с top-level `signalTypeHint='reasoning'` + questionText. **Фикс класса:** `SegmentBuilder` получил ветку `kind='notification_response'` — все probe-ответы перестали уходить в LLM как JSON-шум | `Specialist37ProbeService.checkCdmInterview`, taskType `cdm-case-interview` (capable) | `CDM_INTERVIEW_ENABLED` |
| **ИНТ.1 — persona-compile v2 (KEYSTONE)**: секционная сборка persona — 5 секций (подход=skill / ценности+мотивация / принципы роли / типовые ситуации→ход=PracticeSkill / маркеры процесса), правила процесса с якорями-цитатами (Personality Illusion), пустые секции опускаются (деградация к v1), 300–1200 слов; `build.service` подтягивает все слои (skill топ-20, value/motivation/markers топ-5, RolePrinciple топ-5, PracticeSkill активные топ-5 union role+person); v1-промпт deprecated (для rollback) | `executable-persona-compile.prompt.ts` v2 + `executable-persona-build.service.ts` | — (едет с кодом) |
| **ВАЛ.1 — валидация по поведению**: воскресный cron на реальных кейсах роли (кейс исключается из subgraph) сравнивает ответы клона с persona v1 (in-memory baseline) vs v2 через LLM-судью `persona-behavior-judge` (только поведенческий ход, запрет character-суждений, отказ=0.3); метрики `clone_persona_layer_score{variant}`, `persona_layer_validation_cases_total{outcome}`; ничего не блокирует (без human-approval) | `PersonaLayerValidationService` + `PersonaLayerValidationCron` (`@Cron('0 7 * * SUN')`, MAX 10 ролей) | `PERSONA_LAYER_VALIDATION_ENABLED` |

### Ключевые инварианты

1. **Правила процесса, не ярлыки** (Personality Illusion): каждый слой компилируется в persona как поведенческое правило с якорем-наблюдением («обычно перед рекомендацией я перечисляю варианты и критерий»), никогда как ярлык («ты рациональный»). Психотип/MBTI/DISC/OCEAN — анти-scope.
2. **Ценности — только из trade-off**: value/motivation-черта извлекается исключительно из решающих моментов, где роль явно выбрала одно в ущерб другому (revealed preference), не из деклараций.
3. **Только конструктивные маркеры процесса**: оценочно-диагностические оси («избегает решений», «не решает сам», «нерешителен») запрещены промптом И код-гардом стоп-маркеров.
4. **CDM-вопросы — не наводящие**: свободный ответ текстом/голосом, без inline-кнопок ([[../../plans/archive/2026-06-11-clone-persona-method-layer.md|ТЗ]] Б5, feedback_probe_no_buttons); probe-dispatcher отдаёт вопрос как есть.
5. **Валидация — по поведению, не по самоотчёту**: LLM-судья сравнивает поведенческий ход ответа с реальным кейсом; без human-approval-гейта (только kill-switch), R10.
6. **Grounding обязателен**: принципы роли несут `sourceBlockIds` (≥2, подмножество входных); клон без опоры честно отказывается (`refusalReason='ungrounded'` в `CloneQueryLog`) вместо выдумки.

### Новые taskType (5)

`role-principle-synthesize` (capable) · `value-motivation-detect` (flash) · `process-marker-detect` (flash) · `cdm-case-interview` (capable) · `persona-behavior-judge` (flash) — все в union+`ALL_LLM_TASK_TYPES`, сид `backend/scripts/seed-llm-task-routes-clone-method.ts` (в `apply-prod-deploy.ts` STEPS, alias `'clone-method'`). Цепочки — [[ai-jobs]] §«Слой метода клона».

## Доработки 2026-06-16 — «один человек = один клон должности» + ревизия промптов M5 + 21 баг конвейера

**Источник:** ТЗ [`plans/tz/2026-06-16-clone-agents-prompt-revision.md`](../../plans/tz/2026-06-16-clone-agents-prompt-revision.md) (Раздел 7 + Раздел 8 + Приложения A–D). Ветка `devsv`, 9 коммитов (`80ce250a..8168d915`). Схема (новый enum + индекс) — [[../02_architecture/data-model]] §«PersonaStatus += frozen»; эндпоинты — [[api-layer]] §Clones; карта модуля — [[../02_architecture/module-map]] §«Один человек = один клон должности».

### Раздел 7 — модель носителей клона (решение владельца)

Клон роли (`ExecutablePersona.scope='role'`) теперь — **снимок ОДНОГО текущего носителя должности**, а не усреднённый агрегат нескольких людей. Инварианты:

| # | Инвариант |
|---|---|
| И1 | Один активный носитель на должность (нужны главный + рядовой → это ДВЕ `Role`). |
| И2 | Клон = снимок одного носителя, без смешивания (агрегация `dedupeTraitsByConcept` по нескольким людям УБРАНА). |
| И3 | Имя `«Клон <Должность> v<N>»`, без ФИО (`publicName`). |
| И4 | Смена носителя = `freeze` прошлой версии + новая `active` v(N+1). |
| И5 | Ровно один `active` на должность; бывшие — `frozen` (read-only, доступны навсегда). |
| И6 | Замороженный клон не дообучается (нет decay/recalibrate/rebuild/нормализации). |
| И7 | На экране должности — список всех носителей + «спросить версию» + «совет бывших». |
| **И8** | **Это НЕ персональные данные** — ФИО не хранится в выводе/истории; 152-ФЗ к модели НЕ применяем (решение владельца). НЕ даём владельцу Org управление сроком хранения/удалением клонов бывших. |

**Реализация:**
- `buildForRole` строит клон из единственного текущего носителя (активный `PersonRole`/`Appointment`, `validTo=null`); ВСЕГДА проставляет `roleVersion`/`currentBearerPersonId`/`publicName`/`succeedsPersonaId`; прошлую `active` → `frozen` атомарно ТОЛЬКО с подтверждённой новой `active`; Redis-лок `persona:rebuild:role:<id>`. Слои метода — из профиля носителя; принципы — role-level; процедуры — role+person носителя.
- `role-clone-persona-versioning.handler.ts` — новый носитель → делегирует `buildForRole`; роль освободилась → `freeze`; промежуточный `pending_rebuild`-стаб больше НЕ создаётся.
- Анонимизация: `clone-respond` получает ярлык `publicName` (НЕ ФИО) на обоих ролевых путях (Р8); `getCloneHistory` без ФИО (`bearer=null`, Р7).
- Чтение версий: `askRole`/`askRoleV2` принимают `roleVersion` (active или frozen, Р4); новый `askAllFormers` («совет бывших», §7.5). Анти-дипфейк-гейты применяются per-версия.
- Эндпоинты: `POST /clones/roles/:roleId/ask` += body `roleVersion`; новый `POST /clones/roles/:roleId/ask-all-formers` (см. [[api-layer]]).
- Backfill `backend/scripts/backfill-role-clone-single-bearer.ts` (§7.6) — дедуп active-дублей → frozen, superseded → frozen, пересборка single-bearer'ом (в `apply-prod-deploy.ts` STEPS, `phase:'backfill'`, `--skip-rebuild` для прогона без LLM).
- Этим **переопределён** кластер версионирования из Раздела 8 (Б12/Б16 — поля проставляются по построению; Б17 — `freeze` вместо гашения `superseded` до build; Б13 — partial-unique на `status='active'`).

### Раздел 8 — 21 баг конвейера M5 (фиксы Б1–Б21 + код-гарды Г1–Г4)

Состязательный аудит (8 ревьюеров + скептик): 27 находок → 21 подтверждён. Сведено по группам (`file:line` сверены по коду):

- **Конвейер черт** (`specialist-3-7-skill.service.ts`, recalibrate cron): Б1 (`pending_verification` старше `archiveCutoff` → `archived` в `runDecay`/recalibrate, без вечного re-verify), Б2 (verify `findMany` FIFO `orderBy createdAt asc` + исключение безнадёжных), Б3 (`lastConfirmedAt = MAX(existing, draft)` — не откатывать дату назад), Б4 (KNN-merge включает `pending_verification`, не плодит дубли pending), Б5 (recalibrate `orderBy` по устареванию + курсор).
- **Нормализация концептов** (`skill-trait-concept.service.ts`, normalizer cron): Б6 (`traitCount = COUNT(active)`: старт с 0, `recomputeTraitCount` на promote/discard/supersede, в cron живой COUNT), Б7 (архив концепта по `NOT EXISTS active-черта`, а не по счётчику-зомби), Б8 (pre-write проверка коллизии `canonicalName` + P2002-retry без смены имени; cron инкрементит `clustersMerged` только при реальном merge).
- **Принципы роли** (`role-principle-synthesis.service.ts`, cron): Б9 (`confidence` из `distinctDays`, не сырой вердикт LLM), Б10 (raw `UPDATE embedding` обёрнут try/catch — нет NULL-вектора, невидимого дедупу), Б11 (бюджет декрементится ТОЛЬКО при фактическом LLM-вызове, skip-ветки не жгут бюджет).
- **Сборка персоны** (build cron): Б14 (`orderBy` lastBuildAt asc nulls-first + курсор по всему хвосту, тот же в trigger-watcher), Б15 (предфильтр `layer='skill'` — как гейт `buildForProfile`).
- **Прочее:** Б19 (`take:30` ПОСЛЕ `orderBy createdAt desc` в persona-validation), Б20 (`if(!d)continue` в DECISION-ветке `parseCitations` — ghost `[DECISION:x]` не обходит grounding-гейт), Б21 (CDM-бюджет считает только доставленные probe — `status IN delivered`, не `queued_digest`/`dropped`).
- **Код-гарды:** Г1 (`targetId` → `required` в схеме `skill_trait_merge_v1`), Г2 (cosine≥0.85+категория → не `new`), Г3 (`<2` цитат → `held` без LLM-вызова), Г4 (skill-путь пропускает draft с пустым `sourceBlockIds`).
- 6 находок опровергнуто состязательной проверкой (не баги — §8.9 ТЗ).

### Приложения A–D — ревизия 12 LLM-промптов клона M5

Во все 12 🟣 clone-only промптов (`skill-trait-detect` / `-merge` / `-verify`, `value-motivation-detect`, `process-marker-detect`, `role-principle-synthesize`, `cdm-case-interview`, `skill-trait-concept-name`, `executable-persona-compile` v2, `clone-respond`, `dialog-multi-query-clone`, `persona-behavior-judge`) добавлены: **якорь смысла «клон отвечает от лица должности»** (блок «ЗАЧЕМ ЭТО»), **few-shot** (главный пробел дешёвых гейтов), **self-check** перед ответом. Всё — в стабильный SYSTEM (prompt-caching-friendly; разовый cache-miss на выкате). Промпты — code-fallback (едут с билдом, не DB-редактируемые). Реестр статусов — [`docs/methodology/prompts/upgrade-progress.md`](../../docs/methodology/prompts/upgrade-progress.md).
