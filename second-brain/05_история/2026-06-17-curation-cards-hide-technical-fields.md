---
date: 2026-06-17
title: Карточки проверки — убрать технические поля и английские ключи
type: рефлексия
distilled: false
---

# Карточки курации: чистка технической утечки в UI

## Что было поставлено

Владелец на скриншоте карточки `/curation/[id]` («Требует вашей проверки»)
показал, что в блоках «Почему сюда попала» и «Предлагается канонизировать»
торчат технические поля с английскими ключами: `criticalType`, `autoThreshold`,
`conflictSignal`, `autoThresholdGlobal`, `deepReviewThreshold`,
`deepThresholdGlobal`, `effectiveConfidence`, `kind`, `weight`. «Пользователю
точно не нужна, причём ещё и с английскими аббревиатурами».

## Как решал

Корень — общий компонент `frontend/src/ui/readable-payload.tsx`: он выводил
**все** простые (не-object) поля payload подряд, известные ключи переводил по
маленькому словарю `FIELD_LABEL_RU`, а неизвестные печатал как есть → сырые
английские ключи в лицо пользователю. Источник полей — `curation.service.ts:362`
(`triageReason` = объект порогов) и `proposedPayload` специалистов Слоя 3
(у идеи `{kind, weight, statement}`, человеку нужен только `statement`).

Компонент используется в 5 местах (обе курации, team-templates, уведомления,
граф сущностей) — чинил весь класс, а не один экран:

1. `ReadablePayload` переписан на принцип «translate-or-hide»: наружу идут
   только контентные поля с русской подписью (расширил словарь: statement,
   rationale, scope, severity, hypothesisText, causeCategory…), всё служебное
   (английские ключи, `*Ids`, `weight`, `confidence`-как-число, пороги, вложенные
   структуры) — в свёрнутые «Технические детали». Плюс перевод enum-значений
   (`high`→«высокая», `open`→«открыт`) и форматирование ISO-дат.
2. `triageReasonSummary()` в `frontend/src/domain/curation.ts` — сводит
   технический `triageReason` к одной фразе на русском (критический тип / жёсткий
   конфликт / низкая уверенность / правка пользователя / устаревшая / аудит /
   дефолт). Заменил `<ReadablePayload value={item.triageReason}/>` на эту фразу
   в `CurationDetailClient.tsx` и `CurationQueueClient.tsx`.
3. Unit-тест `frontend/src/domain/curation.spec.ts` (10 кейсов), включая гард
   «в выводе нет латиницы» (`expect(s).not.toMatch(/[A-Za-z]/)`).

Технический `triageReason` из UI убрал полностью (девам он в логах/diag) —
предложил владельцу опционально вернуть под тогглом, если понадобится отладка
прямо в кабинете.

## Что вышло

- `tsc --noEmit` — чисто; `eslint` — 0 ошибок; `next build` — успешно;
  vitest новый спек — 10/10.
- Коммит `13b0a4bd`, ветка `feature/knowledge-base-redesign-formatter`, запушен.
- Прод-операций нет — фронтенд-onLY, достаточно пересобрать frontend.

## Чему научился

- Класс «raw-json в UI» живёт в одном переиспользуемом компоненте — правильно
  чинить там, а не на каждом экране (фикс заодно почистил граф сущностей и
  уведомления). [[feedback_fix_the_whole_class_not_the_case]]
- Безопасный дефолт для «человекочитаемого» рендера произвольного payload —
  **whitelist подписей + всё прочее под спойлер**, а не «показать всё, перевести
  что знаем». Иначе любое новое поле бэка утекает английским ключом.
- `proposedPayload` у специалистов Слоя 3 неоднородный по типам карточек
  (regulation/process/policy/decision/idea/insight/experiment) — контентные поля
  разные (`name`/`statement`/`contentMd`/`hypothesisText`…), поэтому словарь
  подписей собирал по всем `proposedPayload: {` в `knowledge-core`.
