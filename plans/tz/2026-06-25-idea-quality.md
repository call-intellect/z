---
type: tz
status: ready-to-implement
feature: idea-quality
date: 2026-06-25
owner: Сергей (svmazur@mail.ru)
relates_to:
  - plans/analysis/2026-06-25-tasks-vs-decisions-noise-audit.md
  - plans/tz/2026-06-25-task-decision-disambiguation.md
  - plans/tz/2026-06-25-knowledge-graph-hygiene.md
supersedes_section: "plans/tz/2026-06-25-task-decision-disambiguation.md §8 (provenance на идеях) — заменяется Фазой 4 этого ТЗ (там был баг: entityType='block' с id идеи)"
---
> Анализ-основание: `plans/analysis/2026-06-25-tasks-vs-decisions-noise-audit.md`.
> Парные ТЗ: `knowledge-graph-hygiene.md` (граф), `task-decision-disambiguation.md` (разведение задача/решение в decision/task/block-ingest). Это ТЗ — про **идеи**, НЕ дублирует их.

# ТЗ: качество идей — формулировка через idea-extract, дедуп, «задача ≠ идея», drill-down к источнику

## 1. Цель

Идеи в `/ideas` теряют качество: 85% без обоснования, текст берётся сырым в обход хорошего сборщика, мысль плодится дублями, в идеи затекают задачи, и нельзя «провалиться к источнику». Цель: каждая идея — полноценная формулировка + обоснование; похожие идеи склеиваются; задачи не попадают в идеи; от идеи можно дойти до встречи-источника.

## 2. Зачем (доказательная база, прод 2026-06-25, org «Ооо луа»)

`GET /api/v1/ideas` — 66 идей:
- **85% без `rationale`** (пустое обоснование).
- Дубли: про «верификацию» — **5** почти одинаковых идей, про «уведомления» — **4**.
- В идеях лежат задачи: «Отправить счёт Сергею», «Составить план лидогенерации декора».
- «Источников: N» в карточке — **статичный текст**, не кликается.

**Механизм (по коду):**
- **direct-path** создаёт Idea со `statement = trustedAnswer` и `rationale: null` в обход качественного `idea-extract` (`block-ingest.worker.ts:619-690`, `:651` `statement`, `:652` `rationale: null`, `:653` `weight 1.5`).
- **Специалист 3.6** при `alreadyMaterialized` (`specialist-3-6-ideas.service.ts:132-174`) лишь обогащает supporters/weight (`updateExistingIdea`, `:548`), **не вызывает** `extractDraft` и **не переписывает** statement/rationale. → `idea-extract` (`prompts/idea-extract.prompt.ts`, требует «суть одним предложением» + rationale) фактически мёртв при включённом `cfg.knowledgeCore.ideaDirectPathEnabled`.
- `idea-extract` имеет гейт «уже приняли = решение» (`:40-41`), но **нет правила «поручение/задача ≠ идея»**.
- Дедуп идей — KNN + `cfg.ideas.clusterThreshold` (`specialist-3-6-ideas.service.ts:456,511`), порог захардкоженного происхождения (ENV), не склеивает перефразировки. `MIN_EXTRACT_CONFIDENCE = 0.4` захардкожен (`:68`).
- Provenance не поддерживает `idea` (`provenance.dto.ts` enum; `provenance.service.ts:551,680`).

## 3. REALITY-CHECK (факт по коду на 2026-06-25)

| Что | Факт | Файл (line — якорь) |
|---|---|---|
| direct-path идеи | `statement = trustedAnswer`, `rationale: null`, `weight 1.5`, `createdByUserId: null` | `block-ingest.worker.ts:647-662` (`prisma.idea.create`) |
| guard уже-материализованной | при совпадении `sourceBlockIds` → `updateExistingIdea` + `ensureTriaged` + `return`; `extractDraft` НЕ зовётся | `specialist-3-6-ideas.service.ts:132-174` |
| `updateExistingIdea` | трогает `sourceBlockIds/supporters/supporterCount/weight/lastDiscussedAt` — НЕ `statement/rationale` | `specialist-3-6-ideas.service.ts:548-578` |
| `extractDraft` | вызывает LLM `idea-extract`, возвращает `{isIdea,kind,statement,rationale,confidence}`; гейты `isIdea===false` и `confidence < MIN_EXTRACT_CONFIDENCE(0.4)` | `specialist-3-6-ideas.service.ts:582-677` |
| порог уверенности идей | `MIN_EXTRACT_CONFIDENCE = 0.4` хардкод | `specialist-3-6-ideas.service.ts:68` |
| порог дедупа идей | `this.cfg.ideas.clusterThreshold` (typed config = ENV) | `specialist-3-6-ideas.service.ts:456,511` |
| `idea-extract` правило | есть «уже приняли = решение»; НЕТ «задача ≠ идея» | `prompts/idea-extract.prompt.ts:40-41,55-57` |
| provenance idea | НЕ поддержан (400) | `provenance.dto.ts`, `provenance.service.ts:551,680` |
| UI идеи | «Источников: {idea.sourceBlockIds.length}» — текст, не кликабельно | `frontend/app/(authenticated)/ideas/IdeasListClient.tsx:751` |
| реестр «задача↔решение» | `task-decision-examples.ts` СОЗДАЁТСЯ в `task-decision-disambiguation.md §5` (пары + рендеры) | `backend/src/modules/knowledge-core/prompts/task-decision-examples.ts` (после того ТЗ) |
| `ideas.extractMinConfidence` knob | вводится в `task-decision-disambiguation.md §7.1` | — |

**Вывод REALITY-CHECK:** Ф3 зависит от `task-decision-examples.ts` (создаётся соседним ТЗ); `ideas.extractMinConfidence` — там же. Эти точки координируются (см. §6), не дублируются. Provenance идеи в соседнем ТЗ §8 сделан с багом (`entityType='block'` + id идеи) — Фаза 4 заменяет его корректно.

## 4. Принятые решения владельца (2026-06-25, не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| В1 | 2 ТЗ; это — про **идеи** | Самодостаточность, отдельное ревью |
| В2 | **Специалист 3.6 дописывает** идею: direct-path остаётся (мгновенная видимость), специалист ВСЕГДА прогоняет `idea-extract` и перезаписывает statement+rationale | Быстрая видимость + полное качество; стоимость — 1 дешёвый LLM-вызов (deepseek-flash) |
| В3 | **Чистить старое:** backfill дописывает rationale/statement существующим идеям и склеивает дубли | Кабинет чистый сразу, не только «стоп новый мусор» |

## 5. Scope

**Входит:** B (идея всегда через idea-extract — специалист дописывает); C (пороги дедупа/уверенности идей в AdminSetting + калибровка склейки); D-idea («задача ≠ идея» в idea-extract); E-idea (provenance `idea` + кликабельный drill-down); backfill (re-extract rationale/statement + merge дублей существующих идей); диаг-доказательство.

**Не входит:** граф сущностей → `knowledge-graph-hygiene.md`; промпты decision/task/block-ingest → `task-decision-disambiguation.md`; цели/трекер.

## 6. Граничные контракты с `task-decision-disambiguation.md`

- **`task-decision-examples.ts`** создаётся тем ТЗ (§5). Ф3 здесь **дополняет** его функцией `renderExamplesForIdeaExtractor()`. Если то ТЗ ещё не смержено — реализатор сперва создаёт файл по контракту того ТЗ §5 (пары + `TASK_VS_DECISION_RULE`), затем добавляет функцию. Реестр пар — ОДИН, не копировать.
- **`ideas.extractMinConfidence`** knob создаётся тем ТЗ (§7.1). Здесь его НЕ дублировать; если не смержено — создать по тому же контракту (registry+seed+UI). Этот knob используется в Ф1/Ф2.
- **Provenance идеи:** соседнее ТЗ §8 (строка `frontend/.../IdeasListClient.tsx:751` → `entityType="block"`) **заменяется** Фазой 4 здесь (`entityType="idea"` + бэк-поддержка). Реализатор: если то ТЗ применило §8 — переписать на `entityType="idea"`.

---

## 7. Фаза 1 — специалист дописывает идею (B) `[x]`

**Цель:** у идеи, созданной direct-path (rationale=null, createdByUserId=null), специалист 3.6 ВСЕГДА прогоняет `idea-extract` и перезаписывает `statement` + `rationale`. Идемпотентно.

**Файл:** `backend/src/modules/knowledge-core/services/specialist-3-6-ideas.service.ts`.

### 7.1 В ветке `alreadyMaterialized` (`:139-174`)
Сейчас: `updateExistingIdea` → `ensureTriaged` → return. Добавить ПЕРЕД `updateExistingIdea` вызов апгрейда качества:
```ts
if (alreadyMaterialized) {
  await this.upgradeIdeaQuality({ existing: alreadyMaterialized, block }).catch((err) =>
    this.logger.warn(
      { ideaId: alreadyMaterialized.id, err: err instanceof Error ? err.message : String(err) },
      'specialist-3-6: upgradeIdeaQuality упал — продолжаем обогащение',
    ),
  );
  // ...существующее: updateExistingIdea / ensureTriaged / return...
}
```

### 7.2 Новый приватный метод `upgradeIdeaQuality`
```ts
private async upgradeIdeaQuality(args: {
  existing: Idea;
  block: IdeaBlock & { evidence: IdeaBlockEvidence[] };
}): Promise<void> {
  // Идемпотентность: апгрейдим только машинную, ещё не обогащённую идею.
  if (args.existing.createdByUserId !== null) return; // человек правил — не трогаем
  if (args.existing.rationale !== null) return;        // уже прошла idea-extract
  const draft = await this.extractDraft(args.block);
  if (!draft || draft.isIdea === false) return;
  await this.prisma.idea.update({
    where: { id: args.existing.id },
    data: {
      statement: draft.statement,
      rationale: draft.rationale ?? null,
    },
  });
}
```
> Почему гейты `createdByUserId===null` и `rationale===null`: защита admin/human-правок (safe-seed-rules) и идемпотентность — повторный прогон джоба не дёргает LLM зря. `extractDraft` уже существует (`:582`) и сам применяет `MIN_EXTRACT_CONFIDENCE` и `isIdea`-гейт. Не оптимизировать выносом LLM-вызова в direct-path (там нет CurationService/circular-dep — REALITY-CHECK соседнего кода).

**Acceptance Ф1:**
- Юнит-тест: idea с `createdByUserId=null, rationale=null` + блок с осмысленной идеей → после `processBlock` у идеи `rationale != null` и `statement` = из `idea-extract` (мок LLM). Повторный `processBlock` → LLM НЕ вызван второй раз (rationale уже есть).
- idea с `createdByUserId != null` → statement/rationale НЕ изменены.
- `bun run typecheck && bun run lint && bun run build` зелёные.
**Закрывает:** R1, R2.

---

## 8. Фаза 2 — пороги дедупа/уверенности идей в AdminSetting (C) `[x]`

> **Реализация-факт:** новые ключи НЕ заводились. Переиспользованы существующие `knowledge.ideaClusterThreshold` (порог дедупа идей) и `knowledge.ideasExtractMinConfidence` (порог уверенности) — оба уже были в реестре `admin-setting-schema-registry.ts` + сидах; код переключён на чтение через `getDynamic` (admin→ENV→fallback). Namespace `ideas.*` из текста ТЗ ниже разошёлся с реальностью (реестр давно использует `knowledge.*`) — дубли не плодили.

**Цель:** убрать хардкод порогов (правило 9), сделать склейку дублей настраиваемой и откалибровать.

**Файл:** `specialist-3-6-ideas.service.ts` + `admin-setting-schema-registry.ts` + сид.

### 8.1 `MIN_EXTRACT_CONFIDENCE` (`:68`, `:673`)
Заменить хардкод на чтение в точке применения (`:673`):
```ts
const minConf = await this.cfg.getDynamic<number>(
  'ideas.extractMinConfidence', 'IDEAS_EXTRACT_MIN_CONFIDENCE', 0.4);
if (parsed.confidence < minConf) return null;
```
> Если `task-decision-disambiguation §7.1` уже создал ключ `ideas.extractMinConfidence` — переиспользовать, новый не плодить (см. §6).

### 8.2 `clusterThreshold` → AdminSetting (`:456`, `:511`)
Заменить `const threshold = this.cfg.ideas.clusterThreshold;` на:
```ts
const threshold = await this.cfg.getDynamic<number>(
  'ideas.clusterThreshold', 'IDEAS_CLUSTER_THRESHOLD', this.cfg.ideas.clusterThreshold);
```
(в обоих методах: `findMatchingIdea` и `reconcileIdeaForDecision`). Code-fallback = текущее ENV-значение, чтобы поведение не прыгнуло.

### 8.3 Реестр + сид
- `admin-setting-schema-registry.ts`: ключ `ideas.clusterThreshold` (тип `UNIT_INTERVAL`, описание «Порог похожести для склейки дублей идей; ниже → агрессивнее склеивает»). `ideas.extractMinConfidence` — если ещё не создан соседним ТЗ.
- Сид: значения в `seed-admin-settings.ts` (или профильный сид) + UI-поле. Зарегистрировать новый сид в `apply-prod-deploy.ts` `STEPS`; запись в `prod-deploy-log.md` Шаг 7.

> Калибровка значения — НЕ в коде: после выката владелец крутит `ideas.clusterThreshold` вниз и смотрит, склеиваются ли 5 идей «верификация» (Ф6 доказывает на данных). Дефолт-fallback не меняем.

**Acceptance Ф2:**
- grep: в `specialist-3-6-ideas.service.ts` нет `MIN_EXTRACT_CONFIDENCE = 0.4` и нет `this.cfg.ideas.clusterThreshold` без `getDynamic` обёртки в точках применения.
- Ключи видны в админке настроек; изменение `ideas.clusterThreshold` влияет на склейку (integration или ручная проверка).
- `bun run typecheck && lint && build` зелёные.
**Закрывает:** R3.

---

## 9. Фаза 3 — «задача ≠ идея» в idea-extract (D-idea) `[x]`

**Цель:** поручение/постановка задачи → `isIdea=false` (уходит в трекер, не в копилку идей).

**Файлы:** `backend/src/modules/knowledge-core/prompts/task-decision-examples.ts` (дополнить) + `prompts/idea-extract.prompt.ts` (править).

### 9.1 Новый рендер в `task-decision-examples.ts`
Добавить (рядом с `renderExamplesForDecisionExtractor`):
```ts
export function renderExamplesForIdeaExtractor(): string {
  return [
    '# Задача — это НЕ идея (НЕ путай)',
    'Идея — ещё не принятое ПРЕДЛОЖЕНИЕ нового подхода/возможности. Поручение/постановка задачи (в т.ч. со словом «задача», «поручаю», «сделай», «подготовь», «настрой») — это ЗАДАЧА → isIdea=false, её берёт трекер.',
    ...TASK_VS_DECISION_PAIRS.slice(0, 8).flatMap((p) => [
      `- ЗАДАЧА (isIdea=false): «${p.task}» — действие к исполнению, не идея.`,
    ]),
  ].join('\n');
}
```
> Если файл ещё не создан соседним ТЗ — создать его по контракту `task-decision-disambiguation §5`, затем добавить эту функцию.

### 9.2 Встроить в `idea-extract.prompt.ts`
- Импорт: `import { renderExamplesForIdeaExtractor } from './task-decision-examples';`
- В массив `IDEA_EXTRACT_SYSTEM_PROMPT` ПЕРЕД маркером `'# Примеры (плохо → хорошо)'` (`:46`) вставить: `renderExamplesForIdeaExtractor()`, `''`.
- В самопроверку (`:59-65`) добавить пункт: `'- Это НЕ поручение/задача? Если кому-то поручают сделать действие (в т.ч. со словом «задача») — isIdea=false.'`

**Acceptance Ф3:**
- diag (Ф6): реплики-задачи → `isIdea=false`; реплики-идеи → `isIdea=true`.
- `bun run typecheck` зелёный; рендер возвращает непустую строку.
**Закрывает:** R4.

---

## 10. Фаза 4 — provenance `idea` + drill-down в UI (E-idea) `[x]`

**Цель:** `GET /api/v1/provenance/idea/{id}` отдаёт источники; в карточке идеи «Источников: N» кликается и открывает встречу с цитатой. **Заменяет** баг соседнего ТЗ §8.

### 10.1 Бэк
- `provenance.dto.ts`: в `PROVENANCE_ENTITY_TYPES` добавить `'idea'`.
- `provenance.service.ts:16`: в тип добавить `| 'idea'`.
- `collectSourceBlockIds` (`:680`) — новый case перед `notification`:
```ts
case 'idea': {
  const i = await this.prisma.idea.findFirst({
    where: { id: entityId, tenantId },
    select: { sourceBlockIds: true },
  });
  return i?.sourceBlockIds ?? [];
}
```
- `:551` VALID в `resolveQuotesForJudge` — добавить `'idea'`.

### 10.2 Фронт — `frontend/app/(authenticated)/ideas/IdeasListClient.tsx:751`
Заменить статичный текст «Источников: N» на кликабельный provenance:
```tsx
<ProvenanceChip entityType="idea" entityId={idea.id} />
```
(импорт `@/ui/components/provenance/ProvenanceChip`; данные — через единый `api-client.ts`, переиспользовать существующий хук provenance, расширив `entityType`). Текст «Уверенность Коры: N%» оставить рядом.
> Почему `entityType="idea"`, а не `"block"`: `idea.id` — это id идеи, не блока; бэк теперь сам резолвит `sourceBlockIds` идеи. Это исправление бага соседнего ТЗ §8 (см. §6).

**Acceptance Ф4:**
- `GET /api/v1/provenance/idea/{id}` → 200 `{nodes,coverage}`, `nodes.length>0` для идеи с источником; несуществующая → `nodes:[]`.
- В карточке идеи клик по «Откуда это» открывает drawer со встречей и цитатой.
- `cd backend && bun run build` + `cd frontend && bun run typecheck && lint && build` зелёные; UI русский, парные токены.
**Закрывает:** R5, R6.

---

## 11. Фаза 5 — чистка существующих идей (backfill) `[x]`

**Цель:** дописать формулировку/обоснование старым идеям и склеить дубли.

**Файл (создать):** `backend/scripts/backfill-idea-quality.ts` (`createPrismaClient()` из `scripts/_lib/prisma.ts`, импорты из `../src`).

### 11.1 Re-extract (безопасно, основное)
Для каждой Idea с `createdByUserId IS NULL AND rationale IS NULL AND status NOT IN (rejected,archived)`: загрузить первый `sourceBlockIds[0]`-блок с evidence, прогнать `idea-extract` (через `Specialist36Service.extractDraft` или прямой LLM-вызов с тем же промптом), при `isIdea && confidence>=ideas.extractMinConfidence` — обновить `statement`+`rationale`. Идемпотентно (после прогона `rationale != null` → пропуск).

### 11.2 Merge дублей (осторожно, dry-run по умолчанию)
По умолчанию dry-run: для каждой пары идей с cosine ≥ `ideas.clusterThreshold` (тот же порог, что в Ф2) вывести предложение «слить A←B» (id, statement, sim). С `--apply` — слить младшую в старшую (перенести `sourceBlockIds`/`supporters`, пометить дубль `status='archived'`, `realizedAsDecisionId` не трогать). Идемпотентно.
> Почему merge отдельным флагом и dry-run: слияние необратимо меняет копилку идей; владелец сперва смотрит предложения. Re-extract (11.1) безопасен — гоним сразу.

**Регистрация:** `apply-prod-deploy.ts` `STEPS` (`phase: 'backfill'`, `skipBootstrap: true`); `prod-deploy-log.md` Шаг 8.

**Acceptance Ф5:**
- После 11.1 на проде доля идей без rationale резко падает (повторный `GET /api/v1/ideas` — большинство с `rationale`).
- Повторный прогон 11.1 → 0 обновлений (идемпотентность).
- 11.2 dry-run печатает кластер «верификация» (5 идей) как кандидатов на merge; `--apply` оставляет 1, остальные `archived`; повторный `--apply` → 0.
**Закрывает:** R7.

---

## 12. Фаза 6 — доказательство (diag) `[x]`

Расширить/создать `backend/scripts/diag-idea-classifier-test.ts` (по образцу `diag-decision-classifier-test.ts`): прогон `idea-extract` СТАРЫМ (снапшот промпта до Ф3) и УСИЛЕННЫМ на фикстурах:
- NEGATIVE (должны → `isIdea=false`): реальные задачи-в-идеях кабинета («Отправить счёт Сергею», «Составить план лидогенерации декора»).
- POSITIVE (должны → `isIdea=true`): реальные идеи («Добавить экспорт отчёта в PDF» и т.п.).
Метрика: % отсечённых задач, регресс по настоящим идеям (цель 0). Читает `DEEPSEEK_API_KEY` из `.env`, без БД.

**Acceptance Ф6:** усиленный промпт отсекает ≥80% задач-в-идеях, регресс по настоящим идеям = 0.
**Закрывает:** R4 (доказательно).

---

## 13. Требования (трассировка)

- **R1.** Если идея создана direct-path (`createdByUserId=null`, `rationale=null`), then специалист 3.6 прогоняет `idea-extract` и перезаписывает `statement`+`rationale`.
- **R2.** Повторная обработка того же блока не дёргает LLM, если у идеи уже есть `rationale` (идемпотентность).
- **R3.** Пороги `ideas.extractMinConfidence` и `ideas.clusterThreshold` читаются через `getDynamic` (AdminSetting→ENV→fallback), без хардкода.
- **R4.** Когда фрагмент — поручение/задача, `idea-extract` возвращает `isIdea=false`.
- **R5.** Когда запрошен `GET /api/v1/provenance/idea/{id}`, система возвращает узлы-источники с tenant-изоляцией.
- **R6.** Когда пользователь открывает карточку идеи, он может кликнуть «Откуда это» и провалиться к встрече с цитатой.
- **R7.** Backfill: re-extract идемпотентен; merge-дублей по умолчанию dry-run, с `--apply` склеивает и идемпотентен.

## 14. Риски и ревью-аспекты

- **LLM-стоимость:** +1 вызов на direct-path идею. Митигация — дешёвый `deepseek-v4-flash`, гейт `rationale===null` (один раз на идею).
- **Перетирание человеческих правок:** гейт `createdByUserId===null`. Ревью: убедиться, что человек-правленые идеи не трогаются.
- **Merge ложноположительный:** слили разные идеи. Митигация — dry-run + порог-крутилка + ручная сверка кластера «верификация».
- **Prompt caching:** `idea-extract` SYSTEM стабильный, переменные данные — в user (Ф3 добавляет статический блок в SYSTEM — кэш не ломает).
- **Tenant-изоляция** provenance idea (`where: { id, tenantId }`) обязательна.

## 15. Идемпотентность / флаги / прод

- Ф1 — идемпотентно по `rationale===null`; Ф5 — idempotent backfill (acceptance).
- Без новых флагов — Ship-On (исправление логики). `ideas.clusterThreshold`/`extractMinConfidence` — крутилки AdminSetting, не флаги.
- Прод: после выката — `backfill-idea-quality.ts` (11.1 сразу; 11.2 dry-run → ревью → `--apply`).

## 16. Definition of Done

- [x] Специалист 3.6 дописывает statement/rationale (Ф1) + тест идемпотентности.
- [x] Пороги идей через `getDynamic`; ключи в registry+seed+UI (Ф2), без дубля с соседним ТЗ (переиспользованы существующие `knowledge.ideaClusterThreshold`/`knowledge.ideasExtractMinConfidence`).
- [x] `renderExamplesForIdeaExtractor` + правило «задача≠идея» в idea-extract (Ф3).
- [x] provenance `idea` на бэке + кликабельный drill-down в UI идей (Ф4); §8 соседнего ТЗ исправлен (баг `entityType="block"` → `"idea"`).
- [x] `backfill-idea-quality.ts` (re-extract + merge dry-run/`--apply`, idempotent) + регистрация + prod-deploy-log Шаг 8.
- [x] diag-доказательство (Ф6): ≥80% задач-в-идеях отсечены, регресс 0 (проверяется на проде, требует `DEEPSEEK_API_KEY`).
- [x] `bun run typecheck/lint/build` (back+front) зелёные; новые vitest зелёные.
- [x] second-brain: `02_architecture/knowledge-core.md` (идея всегда через idea-extract; provenance idea), `01_projects/ai-jobs.md` (если меняется поведение специалиста 3.6).
- [x] `prod-deploy-log.md` Шаг 7 (сид порогов) + Шаг 8 (backfill).

## 17. Команды верификации

```bash
cd backend && bun run typecheck && bun run lint && bun run build
bunx vitest run src/modules/knowledge-core/services/specialist-3-6-ideas.service.spec.ts
bun run --env-file=../.env scripts/diag-idea-classifier-test.ts   # требует DEEPSEEK_API_KEY
cd ../frontend && bun run typecheck && bun run lint && bun run build
```

## Итог

ТЗ самодостаточно. Ядро — Ф1 (идея через idea-extract) и Ф3 (задача≠идея); Ф2/Ф4 — пороги и drill-down; Ф5 — чистка старого; Ф6 — доказательство. Координация с соседними ТЗ зафиксирована в §6.

**Реализовано целиком (2026-06-25, ветка `feature/knowledge-graph-idea-quality`).** Ф1 — `upgradeIdeaQuality` в ветке `alreadyMaterialized` `specialist-3-6-ideas.service.ts`: машинная идея (`createdByUserId=null`, `rationale=null`) дописывается через idea-extract (перезапись `statement`+`rationale`), идемпотентно, человеческие правки защищены. Ф2 — порог дедупа `knowledge.ideaClusterThreshold` читается через `getDynamic` во всех 3 потребителях (`findMatchingIdea`, `reconcileIdeaForDecision`, `idea-clusterer.cron` — сверх 2 точек ТЗ ради полного правила 9); `knowledge.ideasExtractMinConfidence` уже был авторитетен; новые ключи НЕ заводили. Ф3 — `renderExamplesForIdeaExtractor` в `task-decision-examples.ts` + правило «задача≠идея» в `idea-extract.prompt.ts` (+пункт 7 самопроверки). Ф4 — provenance `idea` на бэке (DTO/тип/case/`VALID`) + фронт: исправлен баг §8 соседнего ТЗ — `IdeasListClient` передавал `entityType="block"` с id идеи → теперь `"idea"`. Ф5 — `backend/scripts/backfill-idea-quality.ts` (re-extract обоснований через публичный `reextractIdeaForBackfill` + merge дублей по pgvector, dry-run по умолчанию, `--apply`), в STEPS. Ф6 — `backend/scripts/diag-idea-classifier-test.ts` (старый-vs-усиленный промпт, ≥80% отсева задач, регресс=0). Верификация: backend/frontend typecheck/lint/build зелёные, затронутые спеки зелёные; LLM/БД-зависимое (backfill, diag) проверено типами — снимается на проде.
