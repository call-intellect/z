---
type: tz
status: ready-to-implement
feature: skill-based-task-routing
date: 2026-06-21
owner: Сергей (владелец продукта Кора)
relates_to:
  - plans/analysis/2026-06-21-subject-memory-and-self-learning/99-synthesis.md
  - plans/analysis/2026-06-20-assistant-task-assignment-and-notify-and-confirm-text.md
  - plans/analysis/2026-06-20-kora-doved-zadach-foundation.md
---
> Анализ: `plans/analysis/2026-06-21-subject-memory-and-self-learning/99-synthesis.md` (Слой 2) · Статус согласования: 2026-06-21
> Уведомление исполнителя — переиспользовать из `plans/analysis/2026-06-20-assistant-task-assignment-and-notify-and-confirm-text.md` (не дублировать).

# Слой 2 — Маршрутизация задачи нужному человеку по скиллам (без явного исполнителя)

## Цель + Зачем
**Болезненное состояние (запрос клиента):** руководитель ставит задачу без явного исполнителя — «заказать канцелярию», «отделу дизайна сделать макет». Система не понимает, кому это, и задача «висит». Эталон-документ Д15: «этикетки» → снабжение → Наташа; «образцы» → Катя.

**Что строим:** при постановке задачи без исполнителя система **предлагает** исполнителя по профилю компетенций — двухступенчато: явные теги навыка/отдела = hard-gate → семантический матч (pgvector) → LLM-арбитр ранжирует кандидатов → **предложение человеку в один тап**. **Авто-назначение НЕ делаем никогда.**

**Метрика «решено»:** доля задач-без-исполнителя, по которым предложен кандидат, принятый человеком (`routing_suggestion_accepted_total / routing_suggestion_total`); time-to-assign ↓.

## REALITY-CHECK (по коду на 2026-06-21)
- **Профиль ролей и людей есть.** `Role`(departmentId) [schema:4791]; **`PersonRoleAssignment`** (personId/roleId/departmentId/status/validFrom) [schema:5063] — текущие носители роли; `RoleProfile`(roleId @unique, `summaryCache` = responsibilities/skills) [schema:5306] — ролевой приор; `SkillTrait`(profileId) [schema:8174] + `SkillTraitConcept.embedding vector(1536)` [schema:8246] — персональный слой с готовым embedding. **Субстрат для матчинга полностью есть.**
- **Роль НЕ подаётся в промпт.** `OrgContextService.load` отдаёт people с **`role: null`** ([org-context.service.ts:42](../../backend/src/modules/ai/services/org-context.service.ts#L42)) → агент извлечения задач не знает, кто чем занимается. Это первый фикс.
- **Резолва «задача→исполнитель» нет.** Ассистент ставит задачу только на себя (`me/tasks` self), уведомления исполнителю нет — реестр «не сделано» №48 + анализ `2026-06-20-assistant-task-assignment-and-notify-and-confirm-text.md` (там разобрана доставка/уведомление — **переиспользуем, не дублируем**).
- **Embedding-путь готов** — `text-embedding-3-small`, pgvector, HNSW (образец `SkillTraitConcept`).
- [ASSUMPTION: точный путь `SkillTrait.profileId → Person` подтвердить при реализации — вероятно через профиль навыков на Person; если связь иная, кандидатов брать из `PersonRoleAssignment(status=active)` + `RoleProfile.summaryCache`, а `SkillTrait` подключить вторым слоем.]

**Вывод:** профили есть, доставка уведомления разобрана в смежном анализе; новый — сервис резолва-предложения + подача роли в промпт. Достройка.

## Принятые решения владельца (из синтеза §6/§6-bis, не пересматривать)
| # | Решение | Обоснование |
|---|---|---|
| Р1 | **Авто-назначение СНЯТО полностью** — всегда предложение в один тап | red-team `98`: 152-ФЗ ст.16 запрет «исключительно автоматизированной обработки» (verified) |
| Р2 | Матчинг **двухступенчатый**: явные теги навыка/отдела = hard-gate → pgvector+LLM = подсказка | red-team: semantic на близких компетенциях деградирует (SkillRouter −18..−30%, «канцелярия≠закупки≠АХО») |
| Р3 | Профиль **двухуровневый**: RoleProfile (роль-приор) + SkillTrait (человек при ≥2 носителях роли) | синтез §6; совпадает с принципом «клоны ролевые» + ПДн-безопаснее |
| Р4 | Уведомление исполнителя — из ТЗ/анализа `2026-06-20-assistant-task-assignment` | не дублировать готовое |

## Доказательство выбора
Синтез §6 (Слой 2) + `03-skill-routing` + `98-red-team`. Сжато:

| Критерий | A: только rule-tags | B: только semantic-embedding | C (выбран): hard-gate теги → semantic → LLM-арбитр, предложение |
|---|---|---|---|
| Фраза без тега («заказать канцелярию») | ✗ требует тег | ✓ | ✓ |
| Близкие компетенции (канцелярия/закупки/АХО) | ✓ точно | ✗ −18..−30% | ✓ (теги уточняют + человек подтверждает) |
| 152-ФЗ | ✓ | ✗ если авто | ✓ (всегда человек) |
| Выбор при ≥2 носителях роли | ✗ | ~ | ✓ (SkillTrait-слой) |
| Реюз кода | частично | embedding есть | ✓ (профили+embedding+доставка готовы) |

**Отвергнуто:** чистый semantic-авто — деградация + юр-запрет (red-team); чистые теги — не покрывают свободную фразу руководителя.

## Scope
**Входит:** `SkillRoutingService.suggestAssignee` (hard-gate теги → pgvector top-K → LLM-арбитр → предложение+confidence+объяснение); подача роли человека в `OrgContextService` (убрать `role:null`); интеграция «предложить исполнителя» в постановку задачи без исполнителя (ассистент/из встречи) как **предложение в один тап**; крутилки AdminSetting; метрики; переиспользование уведомления из `2026-06-20-assistant-task-assignment`.
**Не входит (vNext/смежное):** (а) сама доставка уведомления/текст подтверждения — в ТЗ `2026-06-20-assistant-assign-task-to-others-and-notify` (зависимость, не дубль); (б) авто-назначение в любом виде — **запрещено** (Р1); (в) обучение порога на accept/reject предложений → стыкуется со Слоем 3 (`SubjectMemory` preference), vNext; (г) явная разметка тегов навыка на задачах, если её нет в модели → vNext `task-skill-tags` (на v1 hard-gate работает по отделу/роли из текста, если тегов нет — сразу semantic).

## Граничные контракты
- **С OrgContextService:** меняем только маппинг people (добавляем `role`); сигнатура `load` без изменений; `meeting-extract-actions` и `analyze.worker` (консьюмеры [analyze.worker.ts:679]) не должны регрессировать (их спеки зелёные).
- **С трекером/ассистентом:** `suggestAssignee` возвращает предложение; присвоение делает существующий путь постановки задачи ПОСЛЕ подтверждения человеком (не внутри сервиса).
- **С `2026-06-20-assistant-task-assignment`:** доставку/уведомление НЕ реализуем здесь — вызываем готовый примитив (`sendNotification`/issue.assignee_changed).

## Контракт-first

### Сервис (new) `backend/src/modules/tracker/services/skill-routing.service.ts`
```ts
interface AssigneeSuggestion {
  personId: string;
  personName: string;
  roleName: string | null;
  departmentName: string | null;
  confidence: number;          // 0..1
  rationale: string;           // объяснение для человека (рус.)
  matchPath: 'tag_hard_gate' | 'semantic' | 'role_prior';
}
async suggestAssignee(args: {
  tenantId: string;
  taskText: string;
  explicitTags?: { departmentId?: string; skill?: string };
}): Promise<AssigneeSuggestion[]>;  // top-N кандидатов, отсортированы; пусто — нет уверенного кандидата
```
**Алгоритм:** (1) кандидаты = `PersonRoleAssignment(status=active)` join `Role`/`Department`; если `explicitTags` есть → hard-gate фильтр по departmentId/skill (Р2). (2) embed `taskText` (`text-embedding-3-small`) → pgvector cosine top-K по `SkillTraitConcept.embedding` (персональный) и `RoleProfile` (приор Р3). (3) LLM-арбитр (taskType `task-assignee-arbiter`, DeepSeek V4 Pro) ранжирует top-K с контекстом роль/отдел/обязанности → `confidence`+`rationale`. **Никогда не присваивает** — только возвращает (Р1).

### AdminSetting
| Ключ | Тип | Дефолт | Смысл |
|---|---|---|---|
| `taskRouting.enabled` | boolean | `true` | kill-switch предложений |
| `taskRouting.suggestMinConfidence` | number | `0.6` | ниже — кандидата не показываем |
| `taskRouting.topK` | number | `3` | сколько кандидатов в семантике |

### Метрики
`routing_suggestion_total{matchPath}`, `routing_suggestion_accepted_total`, `routing_no_candidate_total`.

## Фазы

### Фаза 1 — Роль человека в OrgContextService `[x]`
**Цель:** агент извлечения задач видит, кто чем занимается.
**Файлы:** `org-context.service.ts` — people с реальной ролью (join `PersonRoleAssignment(status=active)`→`Role.name`; при отсутствии — `null`), убрать хардкод `role:null` ([:42](../../backend/src/modules/ai/services/org-context.service.ts#L42)); обновить тип `MeetingExtractActionsContext.people[].role`; форматтер в `prompts/common.ts` (если есть `withOrgContextNote`).
**Что НЕ входит:** резолв-сервис.
**Acceptance:** unit `org-context.service.spec`: people содержат `role` для сотрудника с активной ролью; консьюмеры (`meeting-extract-actions`, `analyze.worker`) не регрессируют (спеки зелёные); typecheck/lint/build.
**Закрывает:** вход для маршрутизации; косвенно качество извлечения задач.

### Фаза 2 — SkillRoutingService (hard-gate → semantic → арбитр) `[ ]`
**Файлы (new):** `skill-routing.service.ts`; промпт `task-assignee-arbiter.prompt.ts` (cache-friendly); регистрация taskType; pgvector-запрос по `SkillTraitConcept.embedding` (+ `RoleProfile` приор). [ASSUMPTION: путь `SkillTrait.profileId→Person` верифицировать; fallback — кандидаты из `PersonRoleAssignment`+`RoleProfile`.]
**Что НЕ входит:** UI/присвоение/уведомление.
**Acceptance:** unit: «заказать канцелярию» при наличии офис-менеджера → топ-кандидат он, `confidence≥порог`, `rationale` на русском; при `explicitTags.departmentId` → кандидаты только из отдела (hard-gate); при отсутствии уверенного → пустой массив + `routing_no_candidate_total`; LLM-арбитр зовётся, **присвоения нет** (мок трекера не вызван). typecheck/lint/build.
**Закрывает:** Р1, Р2, Р3.

### Фаза 3 — Предложение в один тап при постановке задачи без исполнителя `[ ]`
**Файлы:** точка постановки задачи без исполнителя (ассистент/из встречи) — вызвать `suggestAssignee`; если кандидат есть → вернуть как **предложение** (не присваивать); присвоение — по подтверждению человеком, далее уведомление через готовый путь `2026-06-20-assistant-task-assignment` (Р4). Фронт/ассистент: показать «Предлагаю назначить: {имя} ({роль}) — {rationale}. Назначить?» (один тап), русский, без авто.
**Что НЕ входит:** доставка уведомления (готова в смежном ТЗ).
**Acceptance:** e2e/ручная: задача без исполнителя → показано предложение с кандидатом+объяснением; тап «Назначить» → задача присвоена + исполнитель уведомлён (через смежный путь); отказ → задача без исполнителя, предложение скрыто; нигде нет авто-присвоения (grep: `suggestAssignee` не пишет `assigneeId`). `routing_suggestion_accepted_total` растёт.
**Закрывает:** R-метрику принятия, Р1, Р4.

## Совместимость с prompt caching
`task-assignee-arbiter` — стабильный SYSTEM, кандидаты/задача в конце user. `OrgContextService` подаёт роль в существующий user-контекст промпта извлечения (SYSTEM не трогаем).

## Pre-mortem / Риски (ревью-аспекты)
- **152-ФЗ:** любое присвоение — только после явного действия человека; ревью: ни одной ветки авто-`assigneeId` из сервиса.
- **False-assignment на близких компетенциях:** hard-gate теги + порог `suggestMinConfidence` + объяснение + выбор человека; при отсутствии уверенного кандидата — НЕ показывать «лишь бы кого».
- **Single-incumbent роль = де-факто ПДн:** профиль роли с одним носителем = персональный; не выводить чувствительные оценки в `rationale` (только обязанности/навыки роли).
- **Регрессия OrgContext:** консьюмеры извлечения задач/отчётов не должны сломаться — спеки в Фазе 1.

## Idempotency / flag / prod-deploy
- Новых моделей нет (переиспользуем профили) → миграции нет (если не вводим `task-skill-tags`, что vNext). Новый @Cron отсутствует (синхронный сервис). prod-deploy: Шаг 12 (новый taskType + метрики grep), Шаг 1 (ENV нет — AdminSetting).
- `taskRouting.enabled` = kill-switch → `feature-flags.md`.

## DoD
typecheck/lint/build; vitest; `01_projects/{tracker,ai-jobs}` + `02_architecture/module-map` обновить; `04_не-сделано` №48 синхронизировать (часть «предложение исполнителя» закрывается); vNext-строки (task-skill-tags, обучение порога через Слой 3); prod-deploy-log + feature-flags; рефлексия.

## Итог
_(заполнит tz-orchestrator)_
