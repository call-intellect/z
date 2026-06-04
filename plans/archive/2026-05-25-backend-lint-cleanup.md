---
type: tz
status: draft
feature: backend-lint-cleanup
date: 2026-05-25
---

> 📦 **АРХИВ (аудит 2026-06-04): 🟢 почти реализовано — 90%.**
> Главная цель достигнута и верифицирована прогоном: `bun run lint` → 0 errors, exit 0 (было 112 errors), resolver и spec-override закоммичены в eslint.config.mjs. Это снимает блокировку CI/hooks — основная ценность достав
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


# ТЗ: Очистка backend lint и type-coverage

> Связанный контекст: [plans/tz/2026-05-24-ui-api-modernization.md](2026-05-24-ui-api-modernization.md) — `bun run lint` бэка падает 112 ошибками и 1573 предупреждениями. Это технический долг, накопленный за все предыдущие фазы. Frontend lint уже чистый (0 errors, 0 warnings).

## Цель

Привести `cd backend && bun run lint` к 0 ошибкам и осмысленным предупреждениям (≤50). Сейчас падает с `error: script "lint" exited with code 1`, что блокирует CI и любые pre-commit/pre-push хуки на линт. После цели: `bun run lint` должен возвращать exit 0 и быть пригоден для использования в CI/hooks.

## Scope

**Входит:**
- Backend: `bun run lint` → 0 errors, ≤50 warnings.
- Замена всех `any` на конкретные типы (или `unknown` где иначе невозможно).
- Очистка `no-unused-vars` (28 ошибок).
- Конвертация в `import type` где требуется (`consistent-type-imports`, 23).
- Авто-исправление `import order` (1539 warnings) и других через `bun run lint --fix`.
- Починка config'а `import-x/order` resolver (сейчас warning «typescript with invalid interface loaded as resolver»).
- Замена `{}` на `Record<string, never>` / именованные интерфейсы (5).
- Прочие точечные ошибки: `prefer-const` (2), `no-console` (1), `require-await` (1), `no-this-alias` (1).

**Не входит:**
- Изменения логики кода (только типизация и cosmetics).
- Frontend lint (уже чистый).
- Backend tests (ничего не меняем кроме типов в spec'ах).
- Прод-функциональность.
- Прод-конфигурация (env / docker / прокси).
- Frontend type-coverage (отдельная задача, если понадобится).

## Текущее состояние (snapshot 2026-05-25, после ui-api-modernization)

```
✖ 1685 problems (112 errors, 1573 warnings)
  2 errors and 383 warnings potentially fixable with the `--fix` option.
```

**Типы ошибок (errors, 112 всего):**

| Rule | Кол-во | Природа |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 59 | Ручная типизация. Концентрация в `ai/services/`, `knowledge-core/services/`, `operations/services/`. |
| `@typescript-eslint/no-unused-vars` | 28 | Простая очистка (мёртвые импорты / параметры с префиксом `_`). |
| `@typescript-eslint/consistent-type-imports` | 23 | `import { Foo }` → `import type { Foo }`. Авто-fix. |
| `@typescript-eslint/no-empty-object-type` | 5 | `{}` → `Record<string, never>` или конкретный интерфейс. |
| `prefer-const` | 2 | `let` → `const`. Авто-fix. |
| `no-console` | 1 | Заменить на `Logger`. |
| `@typescript-eslint/require-await` | 1 | Убрать `async` или добавить `await`. |
| `@typescript-eslint/no-this-alias` | 1 | Рефакторинг `const self = this`. |

**Типы предупреждений (warnings, 1573 всего, ключевые):**

| Rule | Кол-во | Природа |
|---|---|---|
| `import-x/order` | 1539 | Порядок импортов. Из них ~400 авто-fix через `--fix`. Остальное — `Resolve error: typescript with invalid interface loaded as resolver` (конфиг-проблема). |
| Прочие | ~34 | Распределены. |

## Архитектурные решения и обоснования

### 1. Cleanup-first, не feature-cleanup

НЕ делать «заодно прибраться в логике». Только смена типов / import-orderings / cosmetic. Логика осталась прежней — тесты должны пройти без изменений.

### 2. Стратегия по `any`

Для каждого `any`:
- Если это **локальный** any (внутри функции, не часть public API) — заменить на `unknown` + narrowing (`if (typeof x === 'string')`) или конкретный тип.
- Если это **возвращаемое значение функции/метода** — вывести тип через сигнатуру, не через `as any`.
- Если **API-граница** (внешний LLM-ответ, неструктурированный JSON) — типизировать через Zod schema + `z.infer<>` либо `unknown` + safeParse.
- Категорически избегать `as any` / `as unknown as Foo` — каждое использование указывает на отсутствующий тип, который надо описать.
- Допустимо `// eslint-disable-next-line @typescript-eslint/no-explicit-any` ТОЛЬКО с комментарием WHY (см. raw-LLM/Prisma-internal-types). Не более 5 таких на весь PR.

### 3. import-x/order resolver fix

Конфиг ESLint имеет проблему: `typescript with invalid interface loaded as resolver`. Это причина ~1100 warnings типа `Resolve error: ...`. Починить в `.eslintrc.js` или `eslint.config.mjs`:
- Версия `eslint-import-resolver-typescript` должна соответствовать `eslint-plugin-import-x` API.
- Проверить через context7: правильный config для текущих версий пакетов.
- Если конфликт версий — обновить resolver и/или плагин до совместимой пары.

После починки resolver'а большая часть «Resolve error» warnings уйдёт, и `--fix` сможет применить остальные `import/order`.

### 4. Никаких хуков для блокировки CI

Не добавлять husky / pre-commit hooks с `lint`. Это отдельная инфра-задача. Цель ТЗ — сделать lint **зелёным**, а не обязательным. Хуки настраиваются отдельно по запросу.

### 5. Тесты — критерий неломки

После каждой пачки правок: `bun run test:unit` должен показать тот же набор passing, что и до. Если падает новый тест — откатить пачку, разобраться.

## Технические изменения

### Конфиг

**`.eslintrc.js`** (или `eslint.config.mjs`) — починить `import-x/order` resolver. Возможно через:
```js
settings: {
  'import-x/resolver': {
    typescript: {
      project: './tsconfig.json',
    },
  },
}
```
Проверить через context7 актуальный API. Сейчас, вероятно, используется устаревший формат `'import-x/resolver': 'typescript'` или несовместимая версия `eslint-import-resolver-typescript`.

### Файлы — большинство концентрировано в:

- `backend/src/modules/ai/services/*` (LLM-адаптеры — много `any` для raw-ответов)
- `backend/src/modules/knowledge-core/services/*` (entity-resolution, theme-clustering, etc.)
- `backend/src/modules/operations/services/*` (commitment-response, weekly-digest — новый код)
- `backend/src/common/metrics/business-metrics.service.ts`
- `backend/src/modules/recordings/*`
- Spec'ы (`*.spec.ts`) — много `as unknown as never` после Phase F миграций; можно типизировать через `Partial<X>` или фактический mock-builder.

### База данных
Не меняется.

### Интеграции
Не меняются.

## Критерии готовности (DoD)

- [ ] `cd backend && bun run lint` → exit 0, 0 errors.
- [ ] `bun run lint` → ≤50 warnings (только осмысленные, с комментариями WHY если нужно).
- [ ] `bun run typecheck` → 0 errors.
- [ ] `bun run build` → success.
- [ ] `bun run test:unit` → тот же набор passing, что и до начала работы (ничего не сломано).
- [ ] `bun run test:integration` → тот же набор passing (если поднят docker-compose.dev.yml).
- [ ] Ни одного нового `// eslint-disable` без комментария WHY.
- [ ] Ни одного нового `as any` / `as unknown as ...` без комментария WHY.
- [ ] Файлы из spec-зоны (`*.spec.ts`) типизированы через `Partial<X>` / mock-builder, не через `as unknown as never`.
- [ ] `git status` чист — нет случайных правок логики.

## Риски и ограничения

1. **`any` в LLM-адаптерах** — там часто действительно «raw shape unknown». Если типизация через Zod невозможна (slow / impractical), допустим `unknown` + comment WHY. Не пытаться угадать типы — лучше `unknown` + safeParse.
2. **`as unknown as never` в spec'ах** — это паттерн Phase F агента (для mock'а NestJS services). Заменять только если есть простой `Partial<ServiceName>` тип, иначе оставить (с комментарием).
3. **`import-x/order` `--fix` может переупорядочить import group'ы неожиданно** — после каждой пачки `--fix` запускать `typecheck` + `test:unit`. Если что-то сломалось — откат + ручная правка.
4. **Зависимости eslint-plugin-import-x и eslint-import-resolver-typescript** могут оказаться несовместимыми. Проверить через context7 актуальный API. Если нужно обновить — обновить минорные версии, не major (минимизировать риск).
5. **Time-box** — если за день не уложиться в 0 errors, остановиться на «50 errors max» и докомпозировать. Не делать «через силу».
6. **Параллельные правки** — на ветке `dev` идёт активная разработка. После rebase могут появиться новые `any` / `unused`. Решение: работать на отдельной ветке, перед merge — финальный pass.

## Фазы реализации

### Фаза A — Конфиг + авто-fix (1 день)

- [ ] A.1 — Починить `import-x/order` resolver в ESLint config. Использовать context7 чтобы найти актуальный синтаксис для текущих версий пакетов.
- [ ] A.2 — Прогнать `bun run lint --fix` — закрыть 383 авто-fix предупреждений + 2 ошибки.
- [ ] A.3 — Прогнать `bun run typecheck && bun run test:unit` — убедиться что ничего не сломалось.
- [ ] A.4 — Commit: `chore(backend,lint): A.1-A.2 — fix resolver config + auto-fix import-order`.

### Фаза B — Errors (2-3 дня)

Идти по убыванию категорий.

- [ ] B.1 — `consistent-type-imports` (23) — `bun run lint --fix` если включается флаг; иначе вручную пачкой.
- [ ] B.2 — `no-unused-vars` (28) — удалить или префиксовать `_` для intentional unused.
- [ ] B.3 — `no-empty-object-type` (5) — `{}` → `Record<string, never>` / интерфейс с конкретными полями.
- [ ] B.4 — `prefer-const` (2) — `let` → `const`.
- [ ] B.5 — `no-console` (1) — заменить на `Logger`.
- [ ] B.6 — `require-await` (1) — убрать `async` или добавить `await`.
- [ ] B.7 — `no-this-alias` (1) — рефактор `const self = this`.
- [ ] B.8 — `no-explicit-any` (59) — самое большое. Категории:
  - **B.8.1** LLM-адаптеры (`ai/services/*`) — типизировать через `unknown` + Zod-narrowing, либо `LlmResponseShape` интерфейс.
  - **B.8.2** Mock-builders в spec'ах — типизировать через `Partial<Service>` или dedicated mock-helpers.
  - **B.8.3** Knowledge-core / operations services — конкретные типы из Prisma / domain.
  - **B.8.4** Прочее — типизация по месту.

- [ ] B.9 — Commit пачками: `fix(backend,lint): B.X — описание`.

### Фаза C — Warnings до приемлемого уровня (1 день)

- [ ] C.1 — Прогнать `bun run lint`, посмотреть оставшиеся warnings.
- [ ] C.2 — Если >50 — точечно подавить осмысленные false-positives через `// eslint-disable-next-line` с комментарием WHY.
- [ ] C.3 — Если можно safely auto-fix остаток — `bun run lint --fix` + verify.
- [ ] C.4 — Commit: `chore(backend,lint): C — warnings cleanup до ≤50`.

### Фаза D — Финал (0.5 дня)

- [ ] D.1 — `bun run typecheck && bun run lint && bun run build && bun run test:unit && bun run test:integration` — всё зелёное.
- [ ] D.2 — Обновить `second-brain/02_architecture/code-pitfalls.md` если выявлены повторяющиеся паттерны (например «LLM-ответы всегда через Zod safeParse»).
- [ ] D.3 — Рефлексия `second-brain/05_история/2026-MM-DD-backend-lint-cleanup.md`.
- [ ] D.4 — TZ → status: done.

## Команды проверки

```bash
cd backend

# Чек до начала и после каждой фазы
bun run typecheck
bun run lint
bun run build
bun run test:unit
bun run test:integration   # требует docker compose -f ../docker-compose.dev.yml up -d

# Снимок ошибок по категориям
bun run lint 2>&1 | grep -oE "@typescript-eslint/[a-z-]+|import-x/[a-z-]+" | sort | uniq -c | sort -rn

# Файлы с конкретной ошибкой
bun run lint 2>&1 | grep "no-explicit-any" -B 1 | grep -E "^[A-Z]:" | sort -u
```

## Что НЕ делать

- НЕ менять логику кода (только типы / import-order / cosmetics).
- НЕ добавлять husky / pre-commit hooks — отдельная задача.
- НЕ обновлять major-версии зависимостей — только минорные при необходимости для resolver fix.
- НЕ удалять «странные» `as unknown as never` без понимания — это часто mock-pattern для NestJS DI.
- НЕ коммитить пачкой 60 файлов с пометкой «cleanup» — делать по фазам с понятными commit-сообщениями.
- НЕ пытаться починить лидер за один проход — итеративно, по DoD.

## Замечание оркестратору / агенту

Если будешь делегировать sub-агенту:
- Применяй правило из `~/.claude/projects/c--work-z/memory/feedback_agents_can_lie_about_edits.md` — после каждой пачки правок re-Grep на проверку маркеров.
- Промпт sub-агента: «после каждой 10-20 file Edit'ов re-run `bun run lint 2>&1 | tail -5` и зафиксируй в отчёте число оставшихся errors».
- НЕ запускать `bun run lint --fix` глобально без promezhutochnogo commit'а — слишком большой одноразовый diff (~400 файлов) нечитаем при ревью.

## Итог

_Заполняется по факту реализации._
