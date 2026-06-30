# kora-mobile

Мобильное приложение Z / Кора — клиент единого чата (Expo + React Native +
TypeScript, expo-router). Реализует фазу Ф6 ТЗ
`plans/tz/2026-06-21-unified-chat-kora-tz.md`.

Это код-scaffold: проходит `tsc --noEmit`, переиспользует backend-API
(тот же контракт, что у `frontend/`), закладывает store-compliance.
Нативные сборки/публикация — не входят (см. `STORE.md`).

## Стек

- Expo SDK 56, React Native 0.84, React 19
- expo-router (нижние табы + стек)
- expo-secure-store (сессия), expo-notifications (пуш), expo-av (голос),
  AsyncStorage + NetInfo (offline-очередь)

## Слои

```
src/api/*      вызовы backend (client.ts, *.api.ts, outbox.ts, session.ts)
src/domain/*   ApiDto → DomainModel мапперы
src/hooks/*    data-fetching (useThreads, useConversation)
src/components/* переиспользуемый UI (MessageBubble, ThreadRow, Composer)
src/screens/*  экраны
src/push/*     регистрация пуш-токена
src/context/*  AuthContext
app/*          роуты expo-router (тонкие обёртки над screens)
```

## Навигация (нижние табы)

- Сообщения — лента тредов (`/message-threads`), badge непрочитанного
- Поддержка — тикеты (по RBAC: агент → `desk/tickets`, иначе `my-tickets`)
- Кора — «Спросить Кору» (RAG поверх графа)
- Я — профиль, удаление аккаунта, заблокированные, выход

## Запуск (требует окружения с нативным тулчейном)

```bash
cd kora-mobile
npm install            # или: bun install
EXPO_PUBLIC_API_URL=https://korateam.ru npm run start
# iOS:        npm run ios
# Android:    npm run android
# Android RU: EXPO_PUBLIC_PUSH_TRANSPORT=rustore npm run android
```

## Конфигурация (ENV)

- `EXPO_PUBLIC_API_URL` — базовый URL backend (по умолчанию `https://korateam.ru`)
- `EXPO_PUBLIC_PUSH_TRANSPORT` — `fcm` (Play, default) | `rustore` (RU). iOS всегда `apns`.

## Проверка

```bash
npm run typecheck   # tsc --noEmit — главная проверка scaffold
```

## Store-compliance

См. `STORE.md` — чек-лист App Store / Google Play / RuStore с отметкой,
что закрыто кодом, а что owner-gated (сертификаты, формы, native-SDK).
