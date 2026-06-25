---
type: tz
status: ready-to-implement
feature: knowledge-graph-hygiene
date: 2026-06-25
owner: Сергей (svmazur@mail.ru)
relates_to:
  - plans/analysis/2026-06-25-tasks-vs-decisions-noise-audit.md
  - plans/tz/2026-06-25-task-decision-disambiguation.md
  - plans/tz/2026-06-25-idea-quality.md
---
> Анализ-основание: `plans/analysis/2026-06-25-tasks-vs-decisions-noise-audit.md` (раздел про граф/идеи дополняется этим заходом).
> Парное ТЗ: `plans/tz/2026-06-25-idea-quality.md` (качество идей). Координируется с `plans/tz/2026-06-25-task-decision-disambiguation.md` (разведение задача/решение) — НЕ дублирует его.

# ТЗ: гигиена графа знаний — фейс-контроль сущностей + чистка мусора + drill-down к источнику

## 1. Цель

Граф сущностей/тем (`Память → Сущности`, эндпоинт `GET /api/v1/knowledge/entities`) забит мусором: ID задач трекера, телефоны, email и обрывки слов становятся постоянными узлами графа. Цель: **(а)** поставить гейт качества на входе, чтобы новый мусор не появлялся; **(б)** не извлекать сущности из служебных эхо-событий трекера; **(в)** удалить уже накопившийся мусор; **(г)** дать «провалиться к источнику» (встреча + цитата) с карточки сущности.

## 2. Зачем (доказательная база, измерено на проде 2026-06-25)

Org «Ооо луа» (`cmpndk2tw000101mwmixvacuj`, `korateam.ru`), `GET /api/v1/knowledge/entities`:
- **516 сущностей, 368 (71%) с `mentionsCount` ≤ 1** — большинство узлов встречаются один раз (шум-вес графа).
- **107 тем:** 33 — одно слово, 55 — фрагменты со строчной буквы («синхронизации», «брокеры», «база клиентов»).
- **PII как темы:** `+79782516469`, `alekseyorlov998@gmail.com`.
- **15 сущностей — ID задач трекера:** `MTG-5`, `DEVE-4`, `VKHOD-5`, `MANA-7 (Изучить сервис)` и т.д.

**Механизм (доказан на `MANA-7`):** у сущности «MANA-7 (Изучить сервис)» блоки-источники — это эхо-события трекера `task_overdue` («Задача MANA-7 просрочена по дедлайну») и `task_status_changed` («Задача MANA-7 переведена в статус "В работе"»). `block-ingest` прогоняет извлечение сущностей по **любому** блоку, включая эхо трекера; LLM вытаскивает из текста «MANA-7» как `topic`; гейта качества имени нет → узел остаётся навсегда.

## 3. REALITY-CHECK (факт по коду на 2026-06-25)

| Что | Факт | Файл (line — якорь, перед правкой перечитать) |
|---|---|---|
| Привязка сущности к блоку | `linkEntity` фильтрует ТОЛЬКО `ENTITY_TYPE_VALUES.includes(type)` — **гейта имени нет** | `backend/src/modules/knowledge-core/workers/block-ingest.worker.ts:1387` (`if (!ENTITY_TYPE_VALUES.includes(args.mention.type))`) |
| Цикл извлечения сущностей из блока | `for (const mention of block.mentionedEntities)` — гоняется для **любого** `signalType`, включая `task_*` | `block-ingest.worker.ts:1123` |
| Создание сущности | `findOrCreateEntity` → `normalizeName` только триммит пробелы/кавычки, **никакой валидации имени** | `backend/src/modules/knowledge-core/services/entity-resolution.service.ts:294` (create), `:1728` (`normalizeName`) |
| Модель Entity | **нет `deletedAt`** — только hard-delete; есть `mergedIntoId`, `mentionsCount`, strong-IDs (`inn/ogrn/email/phone/domain`) | `backend/prisma/schema.prisma` model `Entity` |
| Каскады при удалении Entity | `IdeaBlockEntity.entity` — `onDelete: Cascade` (удалится); `ThemeEntity`, `Card` — каскад; **`EntityLink` — полиморфная, БЕЗ FK на Entity → её строки надо удалять вручную** | `schema.prisma` models `Entity`, `IdeaBlockEntity`, `EntityLink` |
| Типизированные обратные связи Entity | `vendor/customer/event/goal/document/market/orgUnit/role/department/persons` — у бизнес-сущностей; у `topic`/`custom`/`project` обычно пусты | `schema.prisma` model `Entity` |
| Provenance — поддерживаемые типы | `decision, issue, task, regulation, instruction, block, notification`. **`entity` НЕТ** | `backend/src/modules/knowledge-core/api/dto/provenance.dto.ts` (`PROVENANCE_ENTITY_TYPES`), `services/provenance.service.ts:16` (тип), `:551` (VALID в `resolveQuotesForJudge`), `:680` (`collectSourceBlockIds`) |
| UI сущности | детальная панель показывает «Блоки знаний (N)», но блоки **не кликабельны** до встречи | `frontend/app/(authenticated)/entities/EntitiesListClient.tsx` |
| Компонент provenance | `ProvenanceChip` / `ProvenanceDrawer` универсальны по `entityType` | `frontend/src/ui/components/provenance/` |

**Вывод REALITY-CHECK:** все четыре подзадачи — новые, в существующих ТЗ не покрыты. `EntityLink` без FK — критичная деталь для фазы чистки (Ф5). Удаление `goal`-типизированных мусорных сущностей (`MANA-6: Написать код…`) — **вне scope** (это проблема goals/tasks, не графа).

## 4. Принятые решения владельца (2026-06-25, не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| В1 | Разбить работу на 2 ТЗ; это — про **граф** (гигиена сущностей) | Самодостаточность, отдельное ревью, меньше риск; идеи — в парном ТЗ |
| В2 | **Чистить уже накопившийся мусор** (не только останавливать новый) | Кабинет должен стать чистым сразу; гейт без чистки оставит 368 старых узлов |
| В3 | Гейт **отсекает** мусорное имя (сущность не создаётся), а не создаёт-и-прячет | Минимум мусора в БД; нет «скрытых» узлов, которые всё равно весят |

## 5. Scope

**Входит:**
- A. Гейт качества имени сущности (отсев ID задач, телефонов, email, одиночных обрывков) + пропуск извлечения сущностей из эхо-блоков трекера (`signalType` ∈ `task_*`).
- E(entity). Provenance для `entity` (бэк) + кликабельный drill-down к встрече с карточки сущности (фронт).
- Чистка существующего мусора (idempotent backfill, dry-run → `--apply`).

**Не входит (явные границы):**
- Качество/дедуп/provenance **идей** → `plans/tz/2026-06-25-idea-quality.md`.
- Разведение задача/решение в промптах извлечения → `plans/tz/2026-06-25-task-decision-disambiguation.md`.
- Удаление `goal`-типизированных мусорных сущностей (`MANA-6: …` как goal) → отдельная задача по goals/tasks (vNext, не в этом ТЗ).
- Дедуп/merge осмысленных, но похожих сущностей (это делает `entity-merge.service.ts`) — не трогаем.

## 6. Граничные контракты с другими ТЗ

- С `task-decision-disambiguation.md`: оно правит **промпты** (`decision/task/block-ingest`); это ТЗ правит **код извлечения сущностей** в том же `block-ingest.worker.ts`, но в другом методе (`linkEntity`/mention-loop, не в промпте). Конфликта нет; порядок мержа любой.
- С `idea-quality.md`: общий backfill-раннер `apply-prod-deploy.ts` — каждое ТЗ добавляет свои `STEPS` независимо.

---

## 7. Фаза 1 — чистый модуль качества имени `[ ]`

**Цель:** pure-TS предикат «мусорное ли это имя сущности», переиспользуемый в гейте и в backfill-чистке (один источник правды критериев).

**Файл (создать):** `backend/src/modules/knowledge-core/services/entity-name-quality.ts`. Без NestJS/Prisma (как `prompts/signal-type-label.ts`).

**Контракт (референс-реализация):**
```ts
export type EntityNameRejectReason =
  | 'task_id'
  | 'phone'
  | 'email'
  | 'too_short'
  | 'numeric_only';

const TASK_ID_RE = /\b[A-ZА-ЯЁ]{2,6}-\d+\b/;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_RE = /(?:\+?\d[\s\-()]?){7,}/;
const CYR_LAT_RE = /[A-Za-zА-Яа-яЁё]/;

export function classifyEntityName(rawName: string): {
  ok: boolean;
  reason: EntityNameRejectReason | null;
} {
  const name = (rawName ?? '').trim();
  if (TASK_ID_RE.test(name)) return { ok: false, reason: 'task_id' };
  if (EMAIL_RE.test(name)) return { ok: false, reason: 'email' };
  if (PHONE_RE.test(name)) return { ok: false, reason: 'phone' };
  const letters = (name.match(CYR_LAT_RE) ? name.replace(/[^A-Za-zА-Яа-яЁё]/g, '') : '');
  if (letters.length < 2) return { ok: false, reason: 'numeric_only' };
  if (name.length < 2) return { ok: false, reason: 'too_short' };
  return { ok: true, reason: null };
}

export function isJunkEntityName(rawName: string): boolean {
  return !classifyEntityName(rawName).ok;
}
```
> `[ASSUMPTION]` Минимум 2 буквенных символа — отсекает «+7…», номера, одиночные символы, но НЕ нормальные короткие имена («ОКК», «SEO», «VK»). Аббревиатуры из ≥2 букв проходят намеренно — они валидные понятия.

**Тесты (создать `entity-name-quality.spec.ts`):** позитив (проходят) `['ОКК','SEO','Telegram','Битрикс','база клиентов','Молочные реки']`; негатив (отсекаются) `['MANA-7','DEVE-4','MANA-7 (Изучить сервис)','+79782516469','alekseyorlov998@gmail.com','7','—','12345']`.

**Acceptance Ф1:** `bunx vitest run backend/src/modules/knowledge-core/services/entity-name-quality.spec.ts` зелёный; файл не импортирует `@nestjs/*` и `@prisma/client` (grep по файлу — 0 совпадений). `bun run typecheck` зелёный.
**Закрывает:** R1.

---

## 8. Фаза 2 — гейт на входе графа `[ ]`

**Цель:** мусорное имя не создаёт сущность; эхо трекера не порождает сущности.

**Файл:** `backend/src/modules/knowledge-core/workers/block-ingest.worker.ts`.

### 8.1 Пропуск эхо-блоков трекера (mention-loop, ~`:1123`)
Перед циклом `for (const mention of block.mentionedEntities)` (якорь — строка `for (const mention of block.mentionedEntities) {`) добавить guard:
```ts
const TRACKER_ECHO_SIGNALS = new Set([
  'task_created', 'task_status_changed', 'task_blocked', 'task_completed',
  'task_overdue', 'task_reassigned', 'task_comment', 'task_mention',
]);
if (!TRACKER_ECHO_SIGNALS.has(block.signalType)) {
  for (const mention of block.mentionedEntities) {
    // ...существующее тело цикла без изменений...
  }
}
```
> Почему: эхо трекера — служебные события, их `mentionedEntities` несут ID/служебные имена, а не понятия графа. `signalType` доступен в этой области (это извлечённый блок). Значения сигналов — из `SIGNAL_TYPE_VALUES` (`prompts/block-ingest.prompt.ts:8`).

### 8.2 Гейт имени (в `linkEntity`, ~`:1387`)
В методе `linkEntity`, сразу после проверки типа (`if (!ENTITY_TYPE_VALUES.includes(args.mention.type)) return;`) добавить:
```ts
if (isJunkEntityName(args.mention.name)) {
  this.metrics.incExtractionEntity?.({ type: 'rejected_junk_name' });
  return;
}
```
Импорт сверху файла: `import { isJunkEntityName } from '../services/entity-name-quality';`
> Почему именно здесь, а не в `findOrCreateEntity`: `linkEntity` — единственная точка входа извлечённых сущностей из block-ingest; `findOrCreateEntity` зовётся и из доверенных мест (person-резолюция), где гейт не нужен. Не оптимизировать переносом гейта глубже.

**Acceptance Ф2:**
- grep: в `block-ingest.worker.ts` есть `TRACKER_ECHO_SIGNALS` и `isJunkEntityName`.
- Юнит-тест воркера (или integration): блок с `signalType='task_overdue'` и `mentionedEntities=[{type:'topic',name:'MANA-7'}]` → `prisma.ideaBlockEntity.create` НЕ вызван (0 сущностей). Блок с `signalType='fact'` и `mentionedEntities=[{type:'topic',name:'MANA-7'}]` → сущность тоже НЕ создана (гейт имени). Блок с `name:'Битрикс'` → создана.
- `bun run typecheck && bun run lint && bun run build` зелёные.
**Закрывает:** R2, R3.

---

## 9. Фаза 3 — provenance `entity` на бэке `[ ]`

**Цель:** `GET /api/v1/provenance/entity/{id}` возвращает узлы-источники (блоки → встречи + цитаты), как у решений.

### 9.1 DTO enum — `backend/src/modules/knowledge-core/api/dto/provenance.dto.ts`
В `PROVENANCE_ENTITY_TYPES` добавить `'entity'`:
```ts
export const PROVENANCE_ENTITY_TYPES = [
  'decision', 'issue', 'task', 'regulation', 'instruction', 'block', 'notification',
  'entity',
] as const;
```

### 9.2 Тип сервиса — `services/provenance.service.ts:16`
В `export type ProvenanceEntityType = | 'decision' | ... | 'block'` добавить `| 'entity'`.

### 9.3 `collectSourceBlockIds` (`:680`) — новый case
В `switch (entityType)` добавить перед `case 'notification':`:
```ts
case 'entity': {
  const links = await this.prisma.ideaBlockEntity.findMany({
    where: { entityId, block: { tenantId } },
    select: { blockId: true },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  return links.map((l) => l.blockId);
}
```
> Почему через `ideaBlockEntity`: это таблица связи сущность↔блок (`@@index([entityId])` есть). `block: { tenantId }` — tenant-изоляция через relation-фильтр (обязательна, инвариант multi-tenancy).

### 9.4 VALID в `resolveQuotesForJudge` (`:551`)
Добавить `'entity'` в массив `VALID`, чтобы judge-цитаты по сущности тоже работали.

**Acceptance Ф3:**
- `GET /api/v1/provenance/entity/{реальный id сущности}` → 200, тело `{ nodes:[…], coverage:{ blocks, meetings } }`, `nodes.length > 0` для сущности с упоминаниями.
- `GET /api/v1/provenance/entity/{несуществующий}` → 200 с `nodes:[]` (не 400).
- `bun run typecheck && bun run build` зелёные; Swagger содержит `entity` в enum типа provenance.
**Закрывает:** R4.

---

## 10. Фаза 4 — drill-down к источнику в UI сущностей `[ ]`

**Цель:** в карточке сущности блок «Блоки знаний» / счётчик источников кликается и открывает `ProvenanceDrawer` (встреча + цитата + дип-линк).

**Файл:** `frontend/app/(authenticated)/entities/EntitiesListClient.tsx` (+ при необходимости `frontend/src/ui/components/provenance/`).

- В секцию детали сущности добавить `<ProvenanceChip entityType="entity" entityId={entity.id} />` (импорт из `@/ui/components/provenance/ProvenanceChip`), открывающий `ProvenanceDrawer`. Существующий список «Блоки знаний (N)» оставить; добавить кнопку/чип «Откуда это» рядом с заголовком сущности.
- Слой данных: вызов `GET /api/v1/provenance/entity/{id}` через единый `api-client.ts` → `ApiDto → DomainModel` (как уже сделано для decision provenance — переиспользовать существующий хук/маппер provenance, расширив тип `entityType`).
> Почему переиспользуем: `ProvenanceChip`/`ProvenanceDrawer` уже универсальны по `entityType` (REALITY-CHECK). Не плодить новый компонент.

**Acceptance Ф4:**
- На карточке сущности (напр. «Telegram») виден кликабельный «Откуда это»; клик открывает drawer со списком встреч и цитатами; клик по узлу ведёт на встречу (дип-линк).
- UI только на русском; парные токены `bg-*`/`text-*-fg` (frontend-rules).
- `cd frontend && bun run typecheck && bun run lint && bun run build` зелёные.
**Закрывает:** R5.

---

## 11. Фаза 5 — чистка существующего мусора `[ ]`

**Цель:** удалить уже накопившиеся мусорные сущности и их висящие связи. Idempotent, безопасно (dry-run по умолчанию).

**Файл (создать):** `backend/scripts/backfill-purge-junk-entities.ts`. Использует `createPrismaClient()` из `scripts/_lib/prisma.ts` (НИКОГДА `new PrismaClient()`), импорты из `../src`.

**Контракт поведения:**
1. Кандидаты на удаление — Entity, где `isJunkEntityName(canonicalName) === true` (переиспользовать `entity-name-quality.ts` из `../src`), **И** нет типизированной бизнес-связи: проверить, что НЕ существует связанных `vendor/customer/event/goal/document/market/orgUnit/role/department/persons` (через `select` соответствующих relation-id или отдельные `count`). Сущности с такими связями — **пропустить** (вне scope, см. §5).
2. По умолчанию — **dry-run**: вывести количество и сэмпл (до 50) `[type] canonicalName · mentionsCount`. Ничего не удалять.
3. С флагом `--apply`: в транзакции на каждую сущность удалить:
   - `EntityLink` где `(fromEntityId = id AND (fromType IS NULL OR fromType = 'entity'))` OR `(toEntityId = id AND (toType IS NULL OR toType = 'entity'))` — **полиморфная модель без FK, каскада нет** (REALITY-CHECK);
   - саму `Entity` (каскад уберёт `IdeaBlockEntity`, `ThemeEntity`, `Card`-связи).
4. **Идемпотентность:** повторный прогон с `--apply` = no-op (мусор уже удалён → 0 кандидатов).
5. Логировать итог: удалено сущностей, удалено EntityLink.

**Регистрация:** добавить в `backend/scripts/apply-prod-deploy.ts` массив `STEPS` с `phase: 'backfill'`, `skipBootstrap: true` (нужно только при апгрейде). Запись в `docs/operations/prod-deploy-log.md` **Шаг 8** (backfill) со строкой `bun run scripts/backfill-purge-junk-entities.ts --apply` + комментарий.

**Acceptance Ф5:**
- Dry-run (`docker compose exec backend bun run scripts/backfill-purge-junk-entities.ts`) печатает кандидатов, в БД ничего не меняет (повторный `GET /knowledge/entities` — тот же `total`).
- `--apply`: на проде «Ооо луа» исчезают `MANA-7…`, `+7…`, `alekseyorlov998@…`, обрывки; сущности с типизированными связями (`customer`, `goal`) НЕ тронуты.
- Повторный `--apply` → «0 кандидатов» (идемпотентность).
- `EntityLink` на удалённые сущности отсутствуют (нет висящих рёбер).
**Закрывает:** R6, R7.

---

## 12. Требования (трассировка)

- **R1.** Когда системе дано имя сущности, она классифицирует его как мусорное, если: совпадает с паттерном ID задачи `[A-ZА-ЯЁ]{2,6}-\d+`, содержит email/телефон, или содержит < 2 буквенных символов.
- **R2.** Если `signalType` блока ∈ `task_*` (эхо трекера), then система НЕ извлекает из него сущности.
- **R3.** Если имя упомянутой сущности мусорное (R1), then сущность НЕ создаётся и НЕ привязывается к блоку.
- **R4.** Когда запрошен `GET /api/v1/provenance/entity/{id}`, система возвращает узлы-источники (блоки→встречи+цитаты) с tenant-изоляцией.
- **R5.** Когда пользователь открывает карточку сущности, он может кликнуть «Откуда это» и провалиться к встрече-источнику с цитатой.
- **R6.** Когда запущен backfill без `--apply`, система не изменяет данные (dry-run).
- **R7.** Когда запущен backfill с `--apply`, система удаляет мусорные сущности (R1) без типизированных бизнес-связей вместе с их `EntityLink`; повторный прогон — no-op.

## 13. Риски и ревью-аспекты (для strict-production-review-gate)

- **Ложноположительный гейт:** валидное короткое понятие отсекается. Митигация — тест Ф1 на «ОКК/SEO/VK». Ревью: проверить, что аббревиатуры из 2+ букв проходят.
- **Каскад удаления:** забыть `EntityLink` (нет FK) → висящие рёбра. Покрыто Acceptance Ф5.
- **Tenant-изоляция** provenance `entity` — фильтр `block: { tenantId }` обязателен; ревью: нет утечки чужих блоков.
- **PII:** телефоны/email удаляются из графа (Ф5) — это улучшение по приватности, не регресс.

## 14. Идемпотентность / флаги / прод

- Фаза 5 — idempotent backfill (acceptance-критерий), регистрация в `apply-prod-deploy.ts` `STEPS`.
- Гейт (Ф2) — **Ship-On**, без флага (это исправление логики, не фича). Новый `signalType`/ENV не вводится.
- Прод-инструкция: после выката — однократно `bun run scripts/backfill-purge-junk-entities.ts` (dry-run, посмотреть), затем `--apply`.

## 15. Definition of Done

- [ ] `entity-name-quality.ts` + тест; не тянет NestJS/Prisma.
- [ ] Гейт в `linkEntity` + пропуск `task_*` echo; юнит-тест воркера.
- [ ] `provenance/entity` на бэке (DTO enum + сервис + collectSourceBlockIds + VALID); Swagger.
- [ ] Drill-down к источнику в UI сущностей; русский, парные токены.
- [ ] `backfill-purge-junk-entities.ts` (dry-run + `--apply`, idempotent) + регистрация в `apply-prod-deploy.ts` + `prod-deploy-log.md` Шаг 8.
- [ ] `bun run typecheck/lint/build` (backend и frontend) зелёные; `bunx vitest run` для новых тестов зелёный.
- [ ] second-brain обновлён: `02_architecture/knowledge-core.md` (гейт качества сущностей + provenance entity), `02_architecture/code-pitfalls.md` (EntityLink без FK — чистить вручную).
- [ ] `docs/operations/prod-deploy-log.md` Шаг 8 обновлён.

## 16. Команды верификации

```bash
cd backend && bun run typecheck && bun run lint && bun run build
bunx vitest run src/modules/knowledge-core/services/entity-name-quality.spec.ts
cd ../frontend && bun run typecheck && bun run lint && bun run build
```

## Итог

ТЗ самодостаточно. Ядро — Ф1+Ф2 (остановить мусор) и Ф5 (убрать накопленный); Ф3+Ф4 закрывают «провалиться к источнику» для сущностей. Заполнит реализатор (`tz-orchestrator`).
