---
date: 2026-06-19
task: Фикс зависания экрана цели после редактирования + система уведомления об обновлении фронта
commits: 0a676e56
distilled: false
---

## Что было поставлено

Пользователи жаловались: после создания/редактирования цели экран с деталью цели «висит» — переходы и обновление страницы не помогают, только разлогин. Параллельно — запрос добавить уведомление об обновлении фронта при новой сборке контейнера.

## Как решал

### 1. Диагностика через Playwright

Подключился к prod через Playwright, воспроизвёл баг. В консоли: React error #185 («Maximum update depth exceeded»). Это classically — цикл `setState → render → effect → setState`.

### 2. Разбор цепочки

`GoalDetailClient` → SWR по умолчанию `revalidateOnFocus: true` → при открытии Radix-диалога фокус меняется → SWR делает рефетч → создаёт новый объект `data`/`goal` → в `EditGoalDialog.useEffect([open, goal])` `goal` — нестабильная ссылка → effect срабатывает → 6 `setState` за раз → SWR снова рефетчит → цикл → React error #185 → error boundary → broken state.

Следствие: Next.js App Router router-cache кешировал сломанный state страницы, поэтому обычный переход не помогал — нужен был полный ремаунт React-дерева (разлогин даёт его).

### 3. Два патча

**Патч 1** (`GoalDetailClient.tsx`): добавить `{ revalidateOnFocus: false }` в useSWR.

**Патч 2** (`GoalsClient.tsx`, `EditGoalDialog`): убрать `goal` из deps через `goalRef`-паттерн:
```ts
const goalRef = useRef(goal);
goalRef.current = goal;
useEffect(() => {
  if (!open) return;
  const g = goalRef.current;
  if (lastGoalIdRef.current === g.id) return;
  lastGoalIdRef.current = g.id;
  // setName, setDescription, ...
}, [open]); // только stable primitive
```

### 4. Версионная система

- `frontend/app/api/version/route.ts` — API route с `BOOT_VERSION = process.env.BUILD_HASH ?? Date.now().toString(36)`. Модульная константа вычисляется один раз при старте Next.js → уникальный токен каждого контейнера. `force-dynamic` — нет статик-кэша.
- `frontend/src/hooks/useVersionCheck.ts` — polling каждые 5 мин, baseline при монтировании, Sonner toast с кнопкой «Обновить» (очищает SW-кэши + `location.reload()`).
- Подключён в `AuthenticatedShell.tsx` через `useVersionCheck()`.

### 5. Aria-предупреждения

Добавлен `aria-describedby={undefined}` в 4 DialogContent без `DialogDescription` (Radix accessibility warning).

## Что вышло

- `bun run typecheck` — чистый (одна ошибка только в `.next/dev/types/validator.ts` — pre-existing, не наш код).
- `bun run build` — exit code 0.
- Коммит `0a676e56`, 5 файлов, 90 insertions.
- prod-deploy-log обновлён (только frontend rebuild, миграций нет).

## Чему научился

1. **SWR `revalidateOnFocus` — ловушка с Radix.** По умолчанию SWR рефетчит при каждой смене фокуса. Radix Dialog меняет фокус при открытии/закрытии. Если данные используются как deps в useEffect — бесконечный цикл гарантирован. Правило: любой SWR на странице с диалогом должен иметь `revalidateOnFocus: false` (или стабилизировать deps).

2. **Object в deps useEffect — красный флаг.** Если видишь `useEffect([open, someObject])` и `someObject` может прийти из SWR — это потенциальный infinite loop. Паттерн `useRef` снимает проблему без потери актуальности данных.

3. **Next.js router-cache кэширует broken error-boundary state.** После React crash страница остаётся broken при обычной навигации — router cache отдаёт закэшированный вид. Разлогин даёт полный ремаунт React-дерева, поэтому помогал. `router.refresh()` в error boundary мог бы тоже помочь.

4. **`BOOT_VERSION = Date.now()` в модуле API route** — элегантный способ fingerprint-ить запуск контейнера без дополнительных ENV/build-args. Вычисляется один раз при startup Next.js, затем frozen.
