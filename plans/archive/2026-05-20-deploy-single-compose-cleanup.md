# 2026-05-20 — Единый docker-compose деплой + чистка мусора + README

**Тип:** инфраструктура / деплой
**Цель:** свести деплой к одной команде `docker compose up -d --build backend` из корня
(без профилей), сделать порты .env-настраиваемыми, почистить мусор/legacy, написать README.

Решения (согласованы с пользователем):
- Единый прод `docker-compose.yml` в корне; dev-compose → `docker-compose.dev.yml`.
- LiveKit/Egress — отдельным compose в `infra/livekit/` (принцип #6 «не на одной ноде»).
- Legacy: удалить очевидный мусор; мёртвый код в src — собрать статанализом и отдать отчёт.
- Корневые черновики .md: полезное → `docs/reference/`, setup-черновики удалить.

## Фазы

- [x] **Фаза 1 — Чистка мусора.** Удалены `infra/livekit/bin/*` (45 МБ exe+zip+LICENSE),
  `start-livekit-windows.ps1`, orphan `livekit-local.yaml`, `setup-claude-tools.md`,
  `2026-05-03-second-brain-setup...md`. Перенесены `llm-models-playbook.md` +
  `livekit_ai_meetings_final_solution.md` → `docs/reference/`. Фикс stale-путей `c:\work\z\...`
  в 3 backend ai-services. `.gitignore`: добавлен игнор бинарей.
- [x] **Фаза 2 — Единый прод-compose.** Корневой `docker-compose.yml` (postgres+redis+migrate+
  backend+frontend, без профилей, env_file `.env`). Dev-compose → `docker-compose.dev.yml`
  (pg+redis+minio). Корневой `.env.example`. Удалены `deploy/backend/`, `deploy/frontend/`.
- [x] **Фаза 3 — Порты через .env.** App-порты `PORT`/`FRONTEND_PORT`, host-порты
  `BACKEND_HOST_PORT`/`FRONTEND_HOST_PORT` — проверено подстановкой кастомных значений.
- [x] **Фаза 4 — Media отдельно.** `infra/livekit/docker-compose.yml` (livekit+egress+redis,
  host-net); `livekit.yaml`/`egress.yaml` → прод-шаблоны.
- [x] **Фаза 5 — nginx.** `deploy/nginx/{z-backend,z-frontend}.conf` — порты привязаны к .env;
  добавлен `z-livekit.conf` (signaling wss).
- [x] **Фаза 6 — README + docs.** Корневой `README.md`; обновлены `deploy/README.md`,
  `docs/architecture/deployment.md`, `CLAUDE.md`, `backend/README.md`, `tech-stack.md`.
- [x] **Фаза 7 — Статанализ мёртвого кода.** knip → отчёт (без удаления, см. ниже).
- [x] **Фаза 8 — Верификация.** `docker compose config -q` OK для root/dev/media; stale-ссылки
  вычищены. **Реальная сборка+запуск:** `docker compose build backend|frontend` — оба образа
  собраны (exit 0); `docker compose up -d backend` — postgres+redis+migrate+backend подняты,
  `/health`=ok, `/health/ready` postgres+redis=ok (livekit=fail, т.к. не запущен), очереди
  BullMQ (8 core + 9 ai) in-process, 200+ роутов замаплено; frontend контейнер — HTTP 200.
  Поймано 2 бага деплоя (см. итог).
- [ ] **Фаза 9 — second-brain + рефлексия.** tech-stack обновлён; рефлексия — после коммита/пуша.

## Итог

Реализовано целиком и **проверено реальной сборкой/запуском контейнеров**.
Деплой сведён к `docker compose up -d --build backend` из корня, порты через `.env`,
nginx-конфиги для хоста, медиа отдельно. Мусор (~45 МБ) удалён.

### Баги деплоя, пойманные при верификации (исправлены)

1. **Prisma 7: `prisma db push --skip-generate` падает** — опция `--skip-generate` удалена в v7.
   `migrate` падал с exit 1. Фикс: `bunx prisma db push` (без флага) в `docker-compose.yml`.
   Баг был латентным (прошлая сессия валидировала только `compose config`, не запускала migrate).
2. **`.env.example`: пустые `MAIL_USERNAME=`/`MAIL_PASSWORD=` ломают boot** — поля
   `z.string().min(1).optional()`: пустая строка проваливает `.min(1)`, отсутствие ключа — ок.
   Фикс: закомментированы в `.env.example` (остальные пустые поля имеют `.default('')` — безопасны).

### Отчёт по мёртвому коду (knip — НЕ удалялось, требует подтверждения)

Подтверждённый мёртвый код (безопасно удалить):
- `backend/src/common/middleware/raw-body.middleware.ts` — заменён inline-конфигом в `main.ts:27-30`.
- `backend/src/modules/ai/services/prompts/chat.ts` — нет импортов (CHAT_V2 выключен).

Кандидаты frontend (проверить перед удалением):
- `src/domain/user.ts`, `src/hooks/use-livekit-room.ts`, `src/hooks/use-result-polling.ts`,
  `src/ui/components/ai/Sparkle.tsx`, `src/ui/components/theme/ThemeToggle.tsx`,
  `src/ui/shadcn/progress.tsx` + связанные deps `@radix-ui/react-progress`, `@radix-ui/react-toast`.

Ложные срабатывания (НЕ трогать): `nestjs-zod`, `swagger-ui-express`, `@nestjs/cli` (backend),
`zod`, `date-fns`, `media-icons` (frontend) — используются через DI/рантайм/билд.

One-off скрипты `backend/scripts/*` (seed/patch/smoke/backfill) knip считает unused — это
норма (запускаются вручную), не удалять.
