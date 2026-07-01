# ТЗ — Пакет F: онбординг-активация (trial-окно, смягчение N16)

- **Архитектура:** [plans/architecture/2026-07-01-package-f-onboarding-activation.md](../architecture/2026-07-01-package-f-onboarding-activation.md) (status: approved)
- **Покрывает:** N16 (биллинг-гейт душит activation при 40–100 юзерах)
- **Тип:** решение владельца — выкат только с заданным `billing.trial_days` (правило №8).

## Контракт
`canCreate = ACTIVE || (DEMO && now - org.createdAt < trialDays)`. Enforcement на бэкенде; фронт отражает. Trial открывает наполнение (create), но не платные/необратимые действия; квоты DEMO соблюдаются.

## Фазы

### [ ] Ф1. Крутилка окна
- `billing.trial_days` в `env.schema.ts` + `admin-setting-schema-registry.ts` + сид + UI-поле; резолв через `getDynamic('billing.trial_days', 'BILLING_TRIAL_DAYS', <owner>)`. **Без заданного владельцем значения окно не активируется** (правило №8).

### [ ] Ф2. Backend enforcement
- В guard/резолвере создания (энтайтлменты/квоты) добавить `inTrialWindow(org)` = `status==='DEMO' && (now - org.createdAt) < trialDays`.
- Разрешение создания: `ACTIVE || inTrialWindow`. В trial применять **DEMO-квоты** (анти-абуз), не безлимит.
- Платные/необратимые действия (расширение лимитов, платные интеграции) остаются под замком в trial.

### [ ] Ф3. Frontend
- `frontend/src/hooks/useCanCreate.ts`: `canCreate = ACTIVE || trialActive` (trialActive приходит с бэкенда/энтайтлмента, не считать на клиенте как источник правды).
- Баннер «trial: осталось X дней»; после истечения — обычный paywall.

### [ ] Ф4. Реестр флагов
- `docs/operations/feature-flags.md`: строка «trial-окно онбординга — решение владельца, параметр `billing.trial_days`, состояние ON при заданном значении».

### [ ] Ф5. Тесты
- Backend: `DEMO` в окне → create 201; вне окна → 403/paywall; `ACTIVE` → всегда 201.
- Крутилка: изменение `billing.trial_days` двигает границу без деплоя.
- Анти-абуз: в trial DEMO-квоты соблюдаются.
- Frontend: баннер остатка; после истечения — paywall.

## Критерии приёмки (DoD)
- Новая `DEMO`-компания N дней наполняет данные и получает «письмо COO» без оплаты.
- Enforcement на бэкенде (не обходится фронтом).
- Окно управляется крутилкой; значение задал владелец.

## Открытый параметр владельца
`billing.trial_days` — **значение задаёт владелец** (рекомендация 14). Без него не выкатываем.

## Prod-deploy
- `billing.trial_days` → `prod-deploy-log.md` Шаг 1; строка в `feature-flags.md`.

## Итог
_Заполнить после реализации._
