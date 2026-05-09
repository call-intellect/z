# Z — Frontend

Next.js 14 (App Router) — фронтенд AI-видеовстреч на LiveKit.

## Запуск (локально)

Backend должен быть поднят на `http://localhost:3000` (см. `../backend/README.md`).

```bash
bun install
bun run dev
```

Откройте http://localhost:3001.

## Скрипты

- `bun run dev` — dev-сервер на порту 3001.
- `bun run build` — production-сборка.
- `bun run start` — запуск собранной версии.
- `bun run typecheck` — проверка TypeScript без emit.
- `bun run lint` — ESLint.
- `bun run test:unit` — юнит-тесты (vitest).

## Переменные окружения

Скопируйте `.env.example` в `.env.local` (для локальной разработки уже создан).

- `NEXT_PUBLIC_API_BASE_URL` — backend API.
- `NEXT_PUBLIC_LIVEKIT_URL` — LiveKit WebSocket URL.
- `NEXT_PUBLIC_FRONTEND_URL` — собственный URL фронта (для генерации ссылок).

## Структура

См. `c:/work/z/plans/architecture/2026-05-08-z-architecture.md` § 7.

- `app/` — Next.js App Router (страницы и layout).
- `src/api/` — единый apiClient + per-feature API.
- `src/domain/` — доменные модели и enum'ы.
- `src/ui/components/` — React-компоненты.
- `src/contexts/` — React-контексты (auth, toast).
- `src/lib/` — утилиты, i18n.

## Текущее состояние

Bootstrap (Фаза 6 ТЗ MVP). Реальные страницы встречи / списка / результата — Фаза 7.
