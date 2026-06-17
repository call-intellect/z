---
title: Служба поддержки — деск + закрытый контур памяти + самообучающийся клон
status: living
covers: вендорская служба поддержки на трекере, закрытый контур памяти (R-INV-1), петля обучения черновик→правка, клон техподдержки, ночной куратор контура
date: 2026-06-09
relates_to:
  - plans/archive/2026-06-09-support-desk-clone-and-closed-contour-tz.md
  - plans/analysis/2026-06-09-support-desk-clone-and-closed-contour.md
  - second-brain/02_architecture/knowledge-core.md
---

# Служба поддержки с AI-клоном и закрытым контуром памяти

> **Источник правды по контракту:** [`plans/archive/2026-06-09-support-desk-clone-and-closed-contour-tz.md`](../../plans/archive/2026-06-09-support-desk-clone-and-closed-contour-tz.md) (Ф1–Ф6; реализованы Ф1–Ф4) + анализ [`plans/analysis/2026-06-09-support-desk-clone-and-closed-contour.md`](../../plans/analysis/2026-06-09-support-desk-clone-and-closed-contour.md). Здесь — что работает по факту и почему так.
> Затронутые архитектурные заметки: [[../02_architecture/module-map]] §«support», [[../02_architecture/data-model]] §«Служба поддержки», [[ai-jobs]], [[workers-queues]], [[api-layer]], [[frontend-pages]].

## Что это

Встроенная **вендорская** служба поддержки (dogfood): клиент Коры из своего кабинета задаёт вопрос → обращение приходит в наш единый деск → наш сотрудник отвечает → ответы копятся в **закрытый контур памяти** → из него собирается **клон техподдержки**, который сначала готовит черновики (человек правит — учимся на правках), а позже (Ф5, отложена) сможет отвечать сам за гейтом уверенности.

Построено на существующих кирпичах (≈80% готового): трекер `Issue` (тикет), граф `KnowledgeGroup`+`IdeaBlockAccess` (контур), клон `clone-respond`, каналы `Notification` (дублирование сотруднику в Telegram+почту), `LlmPreferenceSample`+`ConfidenceCalibrationService` (обучение). Новое — ровно: закрытый контур, обучающая петля «черновик→правка», support-слой над трекером (SLA/видимость/CSAT/провенанс), клиентский виджет в отдельном контуре доверия.

**Охват v1 (Р-1):** только наша вендорская поддержка — клиенты пишут нам, единый наш деск. Модель данных расширяемая, но чужие дески (клиент ведёт СВОЙ деск для СВОИХ клиентов) не строятся.

## Изоляция контура — инвариант R-INV-1 (главный)

Закрытый контур = синглтон `KnowledgeGroup(kind='support', isClosed)` per вендор-Org; «галочка сотрудника поддержки» = членство `KnowledgeGroupMember(source='manual')` (один источник правды, ноль новых моделей доступа, Р-7).

Изоляция достигается **позитивным pre-retrieval фильтром**: в `ChatV2RetrievalService.collectPool` добавлен параметр `contourGroupId`, который фильтрует пул `blockAccess.some.groupId = supportGroupId` **ДО ранжирования** (KNN ранжирует уже отфильтрованный пул) — во всех ветках пула и в `expandViaGraph`. Фильтр **безусловный** — не зависит от флага `KNOWLEDGE_ACCESS_ENFORCEMENT` (в отличие от общего access-гейта). Секционирование pgvector не нужно. CI-негатив-тест `contour-isolation.spec.ts` доказывает: ретрив контура не возвращает НИ ОДНОГО блока вне группы (падает, если фильтр пост-, а не pre-).

Клиентский виджет — отдельный bounded context (R-INV-4): свой системный промпт, БЕЗ tool'ов Concierge и БЕЗ графа компании, только контур поддержки; выход только текст.

## Петля обучения «черновик→правка» (R-INV-2) — дифференциатор

Зазор, который лидеры (Intercom/Zendesk/Yandex) осознанно не закрывают: обучение на DIFF черновик→финал.

1. Сотрудник жмёт «черновик» → `support-clone-draft` (RAG из контура + few-shot принятых) генерит ответ; `support-answer-critic` считает groundedness (claims vs контур-блоки). Ниже порога `support_critic_min_groundedness` (0.6) → исход `clarify`/`escalate`, не «ответить» (R-INV-5). Черновик = `IssueComment(authorType='clone', access='internal', draftState='pending')` с `cloneConfidence`/`groundednessScore` и цитатами `[BLOCK:id]`.
2. Сотрудник принимает / правит+шлёт / отклоняет.
3. `support-edit-classify` классифицирует ТИП правки (`factual|tone|policy|empty`) — ДО записи сигнала (голый diff хакаем). Пишутся `SupportDraftOutcome` + `LlmPreferenceSample`.
4. **Гейт качества промоута в контур:** только `accepted/edited` + нет реоткрытия тикета + CSAT ≥ `support_promote_min_csat` (4) → финал кормит контур (`RawEvent→IdeaBlock(expertise)` + `IdeaBlockAccess(support)`, провенанс `clone-accepted`, вес ниже человеко-написанного). Reject и реоткрытые — НЕ промоутятся (защита от само-отравления).

Без файнтюна (CIPHER-стиль). Обучение и обновление — **автоматически**, без «админ нажми одобрить» ([[feedback_no_human_in_loop_for_clone_learning]]).

## Ночной куратор контура (Ф4, R-INV-6)

`SupportCuratorCron` (`@Cron('0 3 * * *')`) смотрит дневные сигналы (`SupportDraftOutcome`, реоткрытия, CSAT) и через `support-contour-curate` САМ наводит порядок в контуре: `keep`/`promote`/`fix(supersede)`/`merge`/`archive`. Без ручного «одобри». Защита от необратимости: destructive-операции — только **soft-archive** (`IdeaBlock.status='archived'`/`supersededAt`, без физического delete, R24) и **только за verdict'ом** `MultiAgentDebateService` (R23). Каждое действие пишет аудит `SupportCuratorAction`. Идемпотентен в пределах прогона.

## Тикеты = трекер (R-INV-3, Р-8)

Тикет = `Issue` в Support-проекте вендор-Org (`systemGenerated`, скрыт из обычного списка проектов). Переиспользованы: `IssueComment.access` (`internal|external` — видимость клиенту), `IssueAssignee` M:M (несколько ответственных). Достроено: поля клиента (`supportCustomerOrgId/UserId/Contact`), SLA (`firstResponse/resolutionDueAt`, `slaBreachedAt` — `SupportSlaCron` `*/5`), CSAT (`IssueRating`), провенанс/черновик на комменте (`authorType/draftState/cloneConfidence/groundednessScore`). Cross-tenant intake: `POST /support/tickets` пишет ТОЛЬКО в вендор-Support-проект (нельзя подсунуть чужой `tenantId`/`projectId`).

Приём v1 — только виджет (Р-6); дублирование сотруднику — Telegram+почта (eventType `support.ticket_created`); ответ — в деске. Email/Telegram как канал приёма от клиента и входящий внешний reply — fast-follow, не v1.

## Флаги

| Флаг | Тип | Состояние |
|---|---|---|
| `SUPPORT_DESK_ENABLED` | ENV kill-switch | ON (выкл → приём 503 `SUPPORT_DESK_DISABLED`) |
| `SUPPORT_CURATOR_ENABLED` | ENV kill-switch | ON (выкл → curator-cron no-op) |
| `feature.support_desk` | entitlement (решение владельца) | вкл ТОЛЬКО вендор-Org через `OrgEntitlement.featureOverrides` (вендор-эксклюзив, не продаётся, Р-3) |
| `support.vendor_org_id` | AdminSetting (параметр владельца) | задаёт владелец; без него все support-seed'ы no-op |
| `support_critic_min_groundedness` | AdminSetting (крутилка) | 0.6 |
| `support_promote_min_csat` | AdminSetting (крутилка) | 4 |
| `SUPPORT_CLONE_AUTOSEND_ENABLED` | ENV kill-switch | **PLANNED (Ф5, отложена)** — авто-отправка клиенту |

Реестр — [`docs/operations/feature-flags.md`](../../docs/operations/feature-flags.md).

## Отложено (Ф5/Ф6)

- **Ф5 — авто-отправка клиенту без человека** (за `SUPPORT_CLONE_AUTOSEND_ENABLED` + пороги): на покрытых темах с высокой откалиброванной уверенностью И groundedness клон отвечает сам. Авто-graduation по доказанному качеству (composite judge + A/B, НЕ ручное «одобри»), калибровка на ИСХОДАХ (реоткрытие/CSAT). Перед стартом — **отдельный owner-go** (раскрытие AI клиенту, Р-5; юр-риск EU AI Act / Air Canada только у авто-отправки). В Ф1–Ф4 человек шлёт ВСЕГДА.
- **Ф6 — тон-адаптер** (DPO/LoRA поверх RAG на накопленных парах `editType='tone'`): отдельное ТЗ, когда наберётся датасет. Обучающий фреймворк — НЕ в прод-пути Z.

Подробности — реестр [[../04_не-сделано/README]].

[[../index|← index]]
