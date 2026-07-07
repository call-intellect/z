---
type: analysis
status: open
feature: preexisting-test-failures-triage
date: 2026-07-06
owner: sergrv80@gmail.com
source: bun run test:unit (полный прогон бэка, ветка work/2026-07-02)
note: НЕ связано с заходом probe-questions-unify-and-simplify — вынесено отдельно по решению владельца («не смешиваем»)
---

# Красные тесты бэка на 2026-07-06 — вне probe-noise (для отдельного захода)

## Контекст
Полный прогон `bun run test:unit` на ветке `work/2026-07-02` (2026-07-06): **25 failed / 7335 passed / 21 skipped**.

Из 25:
- **1 было моё** (`admin-setting-fe-keys.guard` — фантом `curation.consistencyChecker*` после сноса инспектора) — **уже починено** (убрал ключи из `frontend/.../worker-knobs/WorkerKnobsSettingsClient.tsx`).
- **24 — НЕ из захода probe-noise.** Ни один падающий файл не входит в мои изменения (сверено пофайлово `git diff HEAD --name-only`). В рабочем дереве в этот момент **активна параллельная сессия** (не закоммичены `backend/prisma/schema.prisma`, `backend/src/modules/pending-actions/*`, `backend/src/modules/ai/services/llm-router.service.ts`, `backend/scripts/apply-prod-deploy.ts`). Часть падений похожа на «сервис уехал вперёд тест-моков» (undefined/null из моков) — вероятно, WIP параллельной сессии; часть — среда (DNS/timeout).

Мой заход (снятие шума уточняющих вопросов) в своей зоне полностью зелёный: typecheck BE+FE, lint 0 ошибок, build EXIT 0 (8 ГБ heap), 494 таргет-теста passed.

## 24 падения (сгруппировано)

### 1. `security/ssrf-guard.service.spec.ts` — 1 (среда, не код)
| Тест | Ошибка | Причина |
|---|---|---|
| `блокирует ::1 (IPv6 loopback)` | `DNS lookup упал: getaddrinfo ENOTFOUND` | тест резолвит реальный DNS; в тест-среде нет сети → ассерт `/приватный IPv6/` не срабатывает. **Фикс:** замокать резолвер или скипать без сети. |

### 2. `knowledge-core/services/chat-v2-rerank.spec.ts` — 7 (ChatV2 RRF/роутер, WIP)
| Тест | Ошибка |
|---|---|
| multi-query: RRF поднимает блок | `TypeError: Cannot read properties of undefined (reading 'map')` |
| single-query: порядок без RRF | `expected vi.fn() called 1×, got 2×` |
| class=list → both-ways один запрос | `called 1×, got 2×` |
| class=temporal → один запрос | `called 1×, got 2×` |
| class=topic → фан-аут N+RRF | `TypeError ...'map'` |
| router_v2_enabled=false → single-route | `TypeError ...'map'` |
| уверенный fact → both-ways off | `TypeError ...'slice'` |

Симптом: зависимость (fetchCandidates/список подзапросов) возвращает `undefined` → сервис/мок рассинхронены. **Фикс:** владелец ChatV2 (вероятно параллельная сессия).

### 3. `knowledge-core/services/chat-v2-retrieval-overview.spec.ts` — 1
| Тест | Ошибка |
|---|---|
| `selectTopThemes` branch=ANY фильтр | SQL не содержит `"branch" = ANY(` — билдер запроса разошёлся с тестом |

### 4. `knowledge-core/services/chat-v2.iterative.spec.ts` — 1
| Тест | Ошибка |
|---|---|
| одношаговый: fetchCandidates 1× для single-query | `called 1×, got 2×` |

### 5. `knowledge-core/services/entity-merge-tx-safety.spec.ts` — 3 (tx-моки undefined)
| Тест | Ошибка |
|---|---|
| findUnique целевой пары ДО update (порядок) | `TypeError: Cannot read properties of undefined (reading 'findUnique')` |
| конфликт на target → delete дубля | (тот же tx-мок undefined) |
| нет конфликта (findUnique → null) → update | (тот же) |

Симптом: tx-объект в моке не отдаёт `findUnique` → сервис ушёл вперёд мока.

### 6. `knowledge-core/services/executable-persona-build.service.spec.ts` — 10 (все `expected null not to be null`)
| Тест |
|---|
| buildForRole → ExecutablePersona(scope=role) dataClass=internal |
| Ф7 (H): схлопывает черты по conceptId (3→1) |
| слои заполнены → userMessage содержит «Ценности/Принципы/Процедуры/Когда:» |
| новые слои пусты → деградация к v1 |
| buildForRole practiceSkills union role+person |
| битый steps-Json → скилл пропущен, сборка не падает |
| K11 (Б23): roleVersion/currentBearerPersonId/publicName/succeedsPersonaId |
| K11 (Б23): без прошлой active → roleVersion=1 |
| K1 (Б24): P2002 retry (buildForRole) |
| K1 (Б24): P2002 retry (buildForProfile) |

Симптом: `buildFor*` возвращает `null` (мок не отдаёт нужную запись) → сервис/схема ушли вперёд моков. Вероятно связано с незакоммиченным `schema.prisma` параллельной сессии.

### 7. `admin/integrations/webhooks/admin-webhooks-mgmt.service.spec.ts` — 1 (timeout)
| Тест | Ошибка |
|---|---|
| `retryDelivery: переводит в pending; enqueue best-effort` | `Test timed out in 5000ms` — висящий промис/незамоканный enqueue |

## Как воспроизвести
```
cd backend && bun run test:unit                 # полный прогон
bunx vitest run src/modules/knowledge-core/services/chat-v2-rerank.spec.ts   # по файлу
```

## Рекомендация
Закрывать **отдельным заходом** (или силами параллельной сессии, которая правит `schema.prisma`/`pending-actions`/`llm-router`), НЕ в выкате probe-noise. Много симптомов «сервис/схема опередили тест-моки» — вероятно, дочинятся сами, когда параллельная работа закоммитится. `ssrf`/`webhooks` — среда (DNS/timeout), к коду не относятся.

---

# ChatV2 — точная атрибуция + план правок (заход 2026-07-06)

**Верифицировано по коду.** 9 падений ChatV2 (группы 2+3+4 выше) — **устаревшие тесты, не баги продукта**. Продовый код за 2 дня уехал вперёд двумя обоснованными коммитами от 4 июля (оба с A/B-доказательствами), тесты под них не обновили. Правки — **чисто в spec-файлах, продовый код не трогаем**.

## Корневые коммиты

### Коммит A — `743bb890 feat(chat-v2): base-recall-floor` → 8 падений (rerank 7 + iterative 1)
`runRetrieval` в [chat-v2.service.ts:1367](../../backend/src/modules/knowledge-core/services/chat-v2.service.ts#L1367) теперь **всегда** параллельно с семантическим маршрутом делает **второй** `fetchCandidates` (детерминированный «подъём сырого вопроса», крутилка `knowledge.chatV2BaseRecallFloor`, default `true`, Ship-On kill-switch). Результаты фьюзятся RRF.

Два симптома, один корень — лишний вызов `fetchCandidates`:
- **«called 1×, got 2×»** — спеки ждут ровно 1 вызов на single-query ([rerank.spec:164](../../backend/src/modules/knowledge-core/services/chat-v2-rerank.spec.ts#L164), [iterative.spec:172](../../backend/src/modules/knowledge-core/services/chat-v2.iterative.spec.ts#L172)). Мок `getDynamic` отдаёт `def` для незнакомого ключа → `chatV2BaseRecallFloor=true` → base-floor активен → +1 вызов.
- **«Cannot read properties of undefined (reading 'map'/'slice')»** — мультизапросные тесты мокают `fetchCandidates` через N× `mockResolvedValueOnce` ([rerank.spec:143](../../backend/src/modules/knowledge-core/services/chat-v2-rerank.spec.ts#L143)). Лишний вызов base-floor не имеет своего `Once` → `undefined` → `.then(ranked => ranked.map(...))` падает.

### Коммит B — `96e994e9 fix(retrieval): каст ThemeBranch::text` → 1 падение (overview 1)
SQL branch-фильтр в [chat-v2-retrieval.service.ts:726](../../backend/src/modules/knowledge-core/services/chat-v2-retrieval.service.ts#L726) сменился с `"branch" = ANY(...)` на `"branch"::text = ANY(...)` (нужный фикс SQL 42883 `operator does not exist: ThemeBranch = text`). Ассерт [overview.spec:90](../../backend/src/modules/knowledge-core/services/chat-v2-retrieval-overview.spec.ts#L90) буквально ждёт подстроку `"branch" = ANY(` — а в SQL теперь `"branch"::text = ANY(`.

## План правок (пофайлово)

### Ф1. `chat-v2-rerank.spec.ts` (7) и `chat-v2.iterative.spec.ts` (1)
**Развилка (решить перед правкой):** тесты этих файлов проверяют НЕ base-floor, а rerank/итеративный роутинг и счётчики вызовов. Само поведение base-floor уже покрыто отдельным `chat-v2-base-recall-floor.spec.ts` (создан тем же коммитом A). Поэтому:

- **Вариант 1 (рекомендую) — изолировать: выключить крутилку в общем cfg-моке.** В функции `makeService` каждого из двух файлов добавить в мок `getDynamic` строку:
  ```ts
  if (key === 'knowledge.chatV2BaseRecallFloor') return false;
  ```
  (рядом с существующими `if (key === 'rag.rrf_k') ...`, [rerank.spec:48-53](../../backend/src/modules/knowledge-core/services/chat-v2-rerank.spec.ts#L48)). Тогда поведение = «до коммита A», один вызов `fetchCandidates`, все 8 тестов зелёные без переписывания ассертов. **Покрытие не теряется** — base-floor тестируется своим спеком. Минимальная безопасная правка (1 строка × 2 файла).
  Плюсы: чинит все 8 одним касанием, не смешивает предметы теста. Минусы: юнит этих файлов не гоняет прод-путь с floor ON (но это и не их задача — их задача rerank/iterative).

- **Вариант 2 — закрепить новое поведение (floor ON как в проде).** Оставить крутилку ON, добить моки под +1 вызов: `toHaveBeenCalledTimes(1)`→`(2)`, добавить недостающие `mockResolvedValueOnce` под base-вызов, пересчитать ожидаемые пулы после RRF-фьюза base+semantic. Плюсы: тест ближе к прод-пути. Минусы: дороже и хрупче (нужно пересчитывать порядок после фьюза во многих кейсах — [rerank.spec:141-152](../../backend/src/modules/knowledge-core/services/chat-v2-rerank.spec.ts#L141) и др.), высокий риск закрепить неверный ожидаемый порядок; дублирует то, что уже покрыто base-recall-floor.spec.

**Итог:** Вариант 1 для всех 8. Если у конкретного теста есть смысл проверить floor ON — добавить точечный кейс с локальным override крутилки, а не переписывать все.

### Ф2. `chat-v2-retrieval-overview.spec.ts` (1)
Обновить обе подстроки под новый SQL с кастом:
- [overview.spec:90](../../backend/src/modules/knowledge-core/services/chat-v2-retrieval-overview.spec.ts#L90): `'"branch" = ANY('` → `'"branch"::text = ANY('`
- [overview.spec:93](../../backend/src/modules/knowledge-core/services/chat-v2-retrieval-overview.spec.ts#L93): та же подстрока в `sql.indexOf(...)` (проверка позиции WHERE относительно ORDER BY).
Строку 91 (`::text[]`) не трогать — она уже совпадает.

## Приёмка
```
bunx vitest run \
  src/modules/knowledge-core/services/chat-v2-rerank.spec.ts \
  src/modules/knowledge-core/services/chat-v2.iterative.spec.ts \
  src/modules/knowledge-core/services/chat-v2-retrieval-overview.spec.ts
```
Ожидаем: 9 ранее падавших → passed; `chat-v2-base-recall-floor.spec.ts` остаётся зелёным (регрессии покрытия нет). Прод-код не менялся → typecheck/build не затрагиваются.

## Границы захода
- Только 3 spec-файла. Продовый код (`chat-v2.service.ts`, `chat-v2-retrieval.service.ts`) — **не трогать**: оба изменения корректны и уже в проде.
- Остальные 15 не-ChatV2 падений (ssrf/entity-merge/executable-persona/webhooks) — вне этого захода, см. группы 1/5/6/7 выше.
