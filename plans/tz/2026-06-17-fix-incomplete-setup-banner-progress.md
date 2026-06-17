---
type: tz
status: ready-to-implement
feature: fix-incomplete-setup-banner-progress
date: 2026-06-17
owner: Сергей (svmazur)
relates_to:
  - plans/tz/2026-06-15-cabinet-qa-bugfixes.md
  - second-brain/05_история/2026-06-15-qa-cabinet-bugfixes.md
---
> Маленькое ТЗ: 1 фронтовый компонент. Бэк-контракт уже существует и проверен (QA B6, 2026-06-15). Новых эндпоинтов/миграций/ENV нет.

## Цель
Баннер «Настройка компании: N из 6» должен показывать **реальный** прогресс, считая отделы/должности/сотрудников/активность, заведённые в обход мастера онбординга.

## Зачем (болезненное состояние)
Владелец Org «Ооо луа» (svmazur@mail.ru) видит «Настройка компании: 0 из 6» с текстом «Осталось: заполнить данные компании, добавить отделы, завести должности и ещё 3», хотя отделы и сотрудники у него реально заведены. Счётчик демотивирует и врёт о состоянии кабинета.

## REALITY-CHECK (факт по коду на 2026-06-17)
- **Корень бага во фронте, не в данных.** Баннер [IncompleteSetupBanner.tsx:44](frontend/src/ui/components/IncompleteSetupBanner.tsx#L44) считает прогресс по timestamp-полям `Org.*CompletedAt` через хук [useOrgSetup.ts](frontend/src/hooks/useOrgSetup.ts) → `orgsApi.byId`. Эти поля проставляются только при прохождении мастера; сущности, заведённые напрямую (раздел структуры/команды), их не выставляют → `completed = 0`.
- **Бэк уже починен (QA B6, 2026-06-15).** Эндпоинт `GET /api/v1/orgs/:orgId/setup-progress` → [onboarding.service.ts:53 `getSetupProgress`](backend/src/modules/onboarding/onboarding.service.ts#L53) считает каждую веху по принципу «timestamp **ИЛИ** факт существования сущности» и возвращает `{ completed, total: 6, steps }`. Контроллер: [onboarding.controller.ts:83](backend/src/modules/onboarding/onboarding.controller.ts#L83) (требует owner/admin).
- **Фронт-клиент эндпоинта уже есть:** `onboardingApi.getSetupProgress` ([onboarding.api.ts:30](frontend/src/api/onboarding.api.ts#L30)) + тип `SetupProgressApi` ([onboarding.api.ts:15](frontend/src/api/onboarding.api.ts#L15)).
- **Фикс довели только до половины.** Тот же эндпоинт уже подключён в пустом состоянии дашборда ([DirectorDashboardClient.tsx:219-231](frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx#L219-L231)), но видимый баннер `IncompleteSetupBanner` забыли переключить. Баннер рендерится один раз в [DashboardRouter.tsx:50](frontend/app/(authenticated)/dashboard/DashboardRouter.tsx#L50).
- Вывод: scope = **переключить источник данных в одном компоненте**. Бэк, api-слой, типы — трогать не нужно.

## Принятые решения владельца
| # | Решение | Обоснование |
|---|---|---|
| Р1 | Источник прогресса баннера — `onboardingApi.getSetupProgress`, как в `DirectorDashboardClient` | Единый источник правды «timestamp ИЛИ факт»; устраняет рассинхрон двух поверхностей, считающих один и тот же прогресс по-разному |
| Р2 | Pending-лейблы строить из `steps` (6 булевых вех), не из старого `STEP_LABELS` по полям Org | Старые поля больше не источник правды; маппинг лейблов должен совпадать с 6 вехами бэка |
| Р3 | `setupCompletedAt`-гейт (скрытие баннера после явного «всё настроено») сохранить как есть | Это отдельная веха «владелец закрыл мастер»; не относится к подсчёту 6 шагов |

## Контракт данных (дословно, уже существует — НЕ менять)
`onboardingApi.getSetupProgress(orgId)` → `SetupProgressApi`:
```ts
interface SetupProgressApi {
  completed: number;   // 0..6
  total: number;       // 6
  steps: {
    welcome: boolean;
    companyInfo: boolean;
    departments: boolean;
    roles: boolean;
    team: boolean;
    firstActivity: boolean;
  };
}
```
Эндпоинт требует роль owner/admin (`requireOwnerOrAdmin`, [onboarding.controller.ts:145](backend/src/modules/onboarding/onboarding.controller.ts#L145)). Баннер и так показывается владельцу/админу (не super-admin, см. [IncompleteSetupBanner.tsx:42](frontend/src/ui/components/IncompleteSetupBanner.tsx#L42)), поэтому 403 для целевой аудитории не возникает.

### Маппинг вех → русские лейблы pending (порядок сохранить)
| ключ `steps` | лейбл при невыполненной вехе |
|---|---|
| `welcome` | познакомить Кору с компанией |
| `companyInfo` | заполнить данные компании |
| `departments` | добавить отделы |
| `roles` | завести должности |
| `team` | пригласить команду |
| `firstActivity` | провести первую встречу или создать спринт |

## Scope
**Входит:** правка [frontend/src/ui/components/IncompleteSetupBanner.tsx](frontend/src/ui/components/IncompleteSetupBanner.tsx).
**Не входит:** бэк (`onboarding.service.ts`/контроллер), `onboarding.api.ts`, `useOrgSetup.ts` (остаётся для гейта `setupCompletedAt`), `DirectorDashboardClient` (уже использует эндпоинт), новые эндпоинты/миграции/ENV/флаги.

## Фаза 1 — переключить баннер на setup-progress `[ ]`
**Файл:** `frontend/src/ui/components/IncompleteSetupBanner.tsx` (единственный).

**Что сделать:**
1. Сохранить существующий гейт скрытия: `setupCompletedAt` (из `useOrgSetup`) ИЛИ `dismissed` (localStorage) ИЛИ `!org` ИЛИ `isSuperAdmin` → `return null`. `useOrgSetup` оставить ради `setupCompletedAt` и `org`/`isSuperAdmin`-гейтов.
2. Добавить загрузку прогресса через SWR по образцу [DirectorDashboardClient.tsx:219-231](frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx#L219-L231):
   ```ts
   import useSWR from 'swr';
   import { onboardingApi } from '@/api/onboarding.api';
   ...
   const progressSwr = useSWR(
     currentOrgId ? ['onboarding-setup-progress', currentOrgId] : null,
     () => onboardingApi.getSetupProgress(currentOrgId!),
     { revalidateOnFocus: false, shouldRetryOnError: false },
   );
   ```
3. Пока `progressSwr.data` не пришёл — `return null` (не мигать «0 из 6» до загрузки).
4. `completed` и `total` брать из `progressSwr.data` (не считать по `org[field]`).
5. `pending` строить из `progressSwr.data.steps`: для каждого ключа с `false` взять лейбл из таблицы «Маппинг вех → лейблы» в указанном порядке. Текст «Осталось: …» формировать как раньше: `pending.slice(0, 3).join(', ')` + `pending.length > 3 ? \` и ещё ${pending.length - 3}\` : ''`.
6. Удалить массив `STEP_LABELS` со `keyof OrgApi`-полями и подсчёт `STEP_LABELS.filter((s) => org[s.field] != null)` — он больше не источник правды (Р2). Заменить на массив пар `{ key: keyof SetupProgressApi['steps']; label: string }` в порядке таблицы.
7. Заголовок оставить дословно: `Настройка компании: {completed} из 6` (total из ответа = 6; хардкод «6» в строке допустим, т.к. совпадает с контрактом).
8. Кнопка «Продолжить →» (`forceStart('welcome')`) и крестик dismiss — без изменений.

**Что НЕ входит:** менять условия гейта скрытия; трогать `useOrgSetup`; менять тексты кнопок; добавлять loading-скелет (достаточно `return null` до данных).

**Acceptance:**
- `grep -n "STEP_LABELS" frontend/src/ui/components/IncompleteSetupBanner.tsx` → 0 совпадений (старый подсчёт удалён).
- `grep -n "getSetupProgress" frontend/src/ui/components/IncompleteSetupBanner.tsx` → ≥1 совпадение.
- `grep -n "org\[s.field\]\|org\[.*field\]" frontend/src/ui/components/IncompleteSetupBanner.tsx` → 0 (нет подсчёта по полям Org).
- В UI Org с заведёнными отделами+ролями+>1 сотрудника, но без пройденного мастера: баннер показывает `completed ≥ 3`, а не 0; в «Осталось» нет «добавить отделы»/«завести должности».
- Англоязычных слов в видимом тексте нет (UI только русский).
- `cd frontend && bun run typecheck` — зелёно. `bun run lint` — зелёно. `bun run build` — зелёно.

Закрывает: R1, R2, R3.

## Требования
- **R1.** Когда баннер виден владельцу/админу, система shall брать `completed`/`total`/`steps` из `GET /orgs/:orgId/setup-progress`, а не из `Org.*CompletedAt`.
- **R2.** Если веха `steps[k] === false`, то её русский лейбл shall попадать в список «Осталось» в порядке: welcome → companyInfo → departments → roles → team → firstActivity.
- **R3.** Пока ответ эндпоинта не получен, система shall не отображать баннер (без «0 из 6»-мигания).

## Риски / ревью-аспекты (для strict-production-review-gate)
- **Двойной запрос** `useOrgSetup` (orgs.byId) + новый SWR — допустимо: оба `revalidateOnFocus: false`, разные SWR-ключи, лёгкие GET. Не оптимизировать преждевременно.
- **403 для не-owner/admin** — нерелевантно: баннер и так только для owner/admin (`isSuperAdmin`-гейт + дашборд директора под TierGate). При гипотетическом 403 `shouldRetryOnError:false` → `data` пустой → баннер скрыт (graceful, не падает).
- **Рассинхрон лейблов** — единственный риск ручной ошибки; сверить маппинг 6 ключей с таблицей построчно.

## DoD
- typecheck (вкл. отсутствие новых ошибок), lint, build фронта зелёные.
- Ручная проверка в кабинете «Ооо луа» (svmazur@mail.ru) через qa-tester: баннер показывает реальное число.
- second-brain: правка косметическая (1 компонент, без новых контрактов) → достаточно строки в `second-brain/05_история/` (рефлексия). prod-deploy-log не затрагивается (нет schema/scripts/ENV/очередей/эндпоинтов).

## Итог
_(заполнит tz-orchestrator после реализации)_
