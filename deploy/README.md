# Z — деплой

Полная инструкция по деплою — в корневом [`README.md`](../README.md) (раздел
«Деплой на сервер»). Здесь — только nginx-конфиги для хост-машины.

## Топология

```
            ┌──────────────── host (nginx + certbot) ────────────────┐
api.example.com   →  127.0.0.1:${BACKEND_HOST_PORT}   (z-backend)
meet.example.com  →  127.0.0.1:${FRONTEND_HOST_PORT}  (z-frontend)
media.example.com →  127.0.0.1:7880                   (z-livekit, signaling)
            └─────────────────────────────────────────────────────────┘
```

backend + frontend поднимаются единым `docker-compose.yml` из корня
(`docker compose up -d --build`), слушают только `127.0.0.1`. Медиа-стек
(LiveKit/Egress) — отдельный compose в [`infra/livekit/`](../infra/livekit/).

## nginx

```bash
sudo cp deploy/nginx/z-backend.conf  /etc/nginx/sites-available/
sudo cp deploy/nginx/z-frontend.conf /etc/nginx/sites-available/
sudo cp deploy/nginx/z-livekit.conf  /etc/nginx/sites-available/   # если LiveKit на этой ноде
sudo ln -s /etc/nginx/sites-available/z-backend.conf  /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/z-frontend.conf /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/z-livekit.conf  /etc/nginx/sites-enabled/

# Замени *.example.com на свои домены, затем выпусти TLS:
sudo certbot --nginx -d api.example.com -d meet.example.com -d media.example.com
sudo nginx -t && sudo systemctl reload nginx
```

| Файл | Домен | Проксирует на |
|---|---|---|
| `z-backend.conf`  | `api.example.com`  | `127.0.0.1:${BACKEND_HOST_PORT}` (дефолт 3000) |
| `z-frontend.conf` | `meet.example.com` | `127.0.0.1:${FRONTEND_HOST_PORT}` (дефолт 3001) |
| `z-livekit.conf`  | `media.example.com`| `127.0.0.1:7880` (только signaling/WS) |

> Если изменил `*_HOST_PORT` в корневом `.env` — поправь порт в `upstream` соответствующего конфига.
> `/metrics` и `/api/docs` наружу не публиковать (закрой по IP в `z-backend.conf`).
