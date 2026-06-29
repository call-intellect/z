---
date: 2026-06-29
type: reflection
feature: morning-tasks-digest
distilled: false
---

# Рефлексия — ТЗ «Утренняя сводка задач»

## Что было поставлено
Владелец попросил исследовать систему уведомлений / уточняющих вопросов и спроектировать первую фичу: чтобы с утра сотруднику приходил список его задач. По ходу диалога замысел уточнился и **перевернулся**: не «закрытые» задачи (как звучало вначале), а **открытые/висящие** — утренний планировщик дня. Итог сессии — готовое ТЗ `plans/tz/2026-06-29-morning-tasks-digest.md`.

## Как решал
1. **Картография кода.** vexp free-tier недокрывает backend (≈2000-node cap) → ключевые контракты добирал прямым чтением: `conversational.service.ts`, адаптеры каналов, `event-payload.registry.ts`, `feed-digest.cron.ts`/`probe-digest.cron.ts`, `tracker.module.ts`, `admin-setting-schema-registry.ts`, сид+UI трекерных настроек, модели `Issue/IssueAssignee/IssueState/Membership/Notification`.
2. **Развилки — владельцу** (3+2 вопроса через AskUserQuestion на русском с рекомендациями). Вскрылось: содержание = ВСЕ открытые; получатель = каждый про свои; пустой день = слать «всё чисто»; каналы (почта+колокольчик+telegram) и час — крутилки в админке; дефолт ВКЛ.
3. **Скилл `tz-author`** → ТЗ-контракт с 6 фазами, доказательством выбора (2 прохода: синхронный cron без таблиц против таблицы-подписки+BullMQ), машинными acceptance.
4. Коммит `3f6a3921`, push в `dev`.

## Что вышло (верификация)
- ТЗ создано, закоммичено и запушено (только plan-документ; typecheck/build не запускались — кода нет).
- Все `[ASSUMPTION]` сняты по факту кода (роуты `/tasks` + `/issues/:id` существуют; `phase:'seed-base'` для сида подтверждён).

## Чему научился (технические факты о системе уведомлений)
- **Единый «почтальон»** — `ConversationalService.sendNotification({tenantId, recipientUserId, eventType, payload, dataClass, preferredChannelKinds?})`. `preferredChannelKinds` **перекрывает** захардкоженную `EVENT_TYPE_CHANNEL_POLICY` — это штатная точка, чтобы сделать каналы настраиваемыми из AdminSetting (не надо трогать политику в коде).
- **Текст уведомления рендерится пер-канально** — у каждого адаптера свой `renderText(notification)` со `switch(eventType)` (telegram/max), email — `subjectFor`+`renderPlainText`. `in_app` текст НЕ строит — рендерит фронт из `payload`. Новый eventType = case в 3 адаптерах + фронт (label в `EVENT_TYPE_LABELS` + рендер в `NotificationDetail`).
- **`ConversationalModule` — `@Global()`** и экспортирует `ConversationalService`, при этом сам импортирует `TrackerModule`. → cron в `tracker/workers/` может инжектить `ConversationalService` напрямую (он глобальный) без импорта ConversationalModule — **циклической зависимости нет**.
- **`validateEventPayload`** на незнакомый eventType уходит в мягкий `LiberalPayloadSchema` — т.е. регистрация в реестре не «чтобы заработало», а чтобы **ужесточить** контракт.
- **Утренний дайджест уже есть как паттерн** — `feed-digest.cron` (но это заглушка, «доставка TODO») и `probe-digest.cron` (рабочий: группировка по получателю → sendNotification). Час кронов сейчас фикс `timeZone:'Europe/Moscow'`; крутилка-часа отложена (D4) — в этом ТЗ закрыл её паттерном hourly-tick + MSK-gate через `Intl`, не `getUTCHours`.
- **AdminSetting декларативен**: валидатор в `admin-setting-schema-registry.ts` (`Map<key,Zod>`) + UI-метаданные в сиде `seed-admin-setting-*.ts` + UI-группа в `DomainSettingsClient`/`SettingsGroup[]`. Чтение — `cfg.getDynamic<T>(key, undefined, codeFallback)` (работает до сида → Ship-On).
- **Дедуп без новой таблицы** — по существующей `Notification` (eventType+recipient+createdAt за сутки). Сэкономило миграцию и Шаг 4 prod-deploy.
- **Грабля масштаба**: «всё чисто» при нуле задач ⇒ перечислять надо ВСЕХ активных сотрудников (`Membership × User.deletedAt IS NULL`), а не только тех, у кого есть открытые задачи.
