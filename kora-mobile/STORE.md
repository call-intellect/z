# Store-compliance — kora-mobile (Ф6)

Чек-лист готовности к публикации в App Store, Google Play и RuStore. Один
фундамент (Expo + транспорт-агностичный пуш), без переделки под каждый магазин.
Это контракт-заготовка: пункты с пометкой owner-gated требуют реального
устройства / сертификатов / store-аккаунтов и не закрываются кодом.

## App Store

### 5.1.1(v) — удаление аккаунта из приложения (обязательно для соцфич)
- [x] Экран «Я» → «Удалить аккаунт» → подтверждение → `POST /api/v1/account/delete` → логаут.
      Реализовано: `src/screens/SettingsScreen.tsx`, `src/api/account.api.ts`.
- owner-gated: бэкенд-эндпоинт `/account/delete` должен реально удалять/анонимизировать данные.

### 1.2 — UGC (user-generated content), обязательно для приложений с перепиской
- [x] Жалоба на сообщение (`POST /messages/:messageId/report`) — long-press в `ChatScreen`.
- [x] Блокировка автора (`POST /conversations/:id/block-member`) — long-press в `ChatScreen`.
- [x] Список заблокированных — экран «Заблокированные» (`src/screens/BlockedScreen.tsx`).
- owner-gated: модерация на стороне бэка (реакция на жалобы ≤24ч — требование Apple).

### Privacy Nutrition Label (App Store Connect)
- Собираем: переписка (тексты сообщений) → память компании (граф знаний, Р5).
      Категория: User Content → Other User Content. Linked to user: да.
- Микрофон: голосовые сообщения (опционально). Usage-string `NSMicrophoneUsageDescription`
      = «Запись голосовых сообщений» (`app.config.ts` → `ios.infoPlist`).
- Идентификаторы: push-токен (APNs) для уведомлений.
- owner-gated: заполнить форму в App Store Connect + опубликовать privacy policy URL.

### Прочее
- [x] `ITSAppUsesNonExemptEncryption=false` (стандартный HTTPS).
- [x] Privacy manifest заготовка (`ios.privacyManifests`) — дополнить reason-кодами под итоговые API.
- owner-gated: возрастной рейтинг (соцпереписка → обычно 17+ из-за UGC).
- owner-gated: APNs-сертификат / ключ, bundleId `ru.korateam.mobile`.

## Google Play

### Account Deletion (обязательно для аккаунтных приложений)
- [x] Удаление из приложения (тот же экран «Я»).
- owner-gated: публичный web-URL удаления аккаунта (требование Play, помимо in-app).

### UGC-политика
- [x] Жалоба + блокировка (см. выше).

### Data safety form
- Те же данные, что и в Apple Nutrition (переписка, микрофон, push-токен FCM).
- owner-gated: заполнить Data safety в Play Console.

### Push — FCM = ОДИН из транспортов Play global, НЕ фундамент (Р8)
- [x] Транспорт выбирается по сборке: Android Play → `fcm`, Android RU → `rustore`, iOS → `apns`.
      `src/push/registerPush.ts` (`resolveTransport`), флаг `EXPO_PUBLIC_PUSH_TRANSPORT`.
- Ядро доставки не зависит от FCM: бэкенд `PushService` транспорт-агностичен (APNs/FCM/RuStore/VAPID).
- owner-gated: `google-services.json` (FCM), service-account для отправки.

## RuStore (Россия)

- [x] Сборка с `EXPO_PUBLIC_PUSH_TRANSPORT=rustore` → транспорт `rustore`,
      токен регистрируется как `transport='rustore'` на бэке.
- owner-gated: RuStore push SDK (native), ключи RuStore Console, модерация RuStore.
- owner-gated: для RU-сборки FCM можно не включать (RuStore push как основной Android-RU транспорт).

## Разрешения (permissions)

| Разрешение | Зачем | Где |
|---|---|---|
| Микрофон (`RECORD_AUDIO` / `NSMicrophoneUsageDescription`) | голосовые сообщения | `app.config.ts` |
| Уведомления (`POST_NOTIFICATIONS` / notifications) | пуш о новых сообщениях | `app.config.ts`, `registerPush.ts` |
| Интернет | API | `app.config.ts` (Android) |

## Что НЕ сделано в этой задаче (owner-gated / нужно окружение)

- Нативные сборки (eas build), сертификаты APNs, `google-services.json`, RuStore SDK — нет окружения.
- Запуск на устройстве / эмуляторе, reliability-gate пуша (фон будится ≤N сек) — ручной прод-тест.
- Реальные иконки/сплэш (`assets/*.png` — плейсхолдеры).
- WebSocket realtime (`conversation.*`) — сейчас polling (`useConversation`), WS опционален по ТЗ Ф6.
- Captcha на публичном входе внешнего клиента — отложено владельцем (см. `04_не-сделано`), вне scope мобилы.
- Утренняя пуш-сводка, умный бейдж серверной логикой — бэкенд-сторона.
