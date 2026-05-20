#!/usr/bin/env bash
#
# Локальный LiveKit для dev (Linux/macOS, через Docker).
#
# При ПЕРВОМ запуске сам скачивает образ LiveKit (сборка/подготовка) и создаёт
# контейнер. Дальше — просто старт/стоп существующего контейнера.
#
# Использование:
#   infra/livekit/livekit-dev.sh up       # поднять (первый раз — скачает образ)
#   infra/livekit/livekit-dev.sh down     # остановить
#   infra/livekit/livekit-dev.sh rm       # удалить контейнер
#   infra/livekit/livekit-dev.sh logs     # логи
#   infra/livekit/livekit-dev.sh status   # статус
#
# Ключи/порт совпадают с backend/.env (devkey / ws://localhost:7880).
set -euo pipefail

IMAGE="livekit/livekit-server:v1.8.0"
NAME="z-livekit-dev"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$DIR/livekit-dev.yaml"

# Docker может требовать sudo (если пользователь не в группе docker).
DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  DOCKER="sudo docker"
fi

cmd="${1:-up}"
case "$cmd" in
  up|start)
    # Первый запуск: скачать образ, если его ещё нет ("сборка").
    if ! $DOCKER image inspect "$IMAGE" >/dev/null 2>&1; then
      echo "==> Первый запуск: скачиваю образ LiveKit ($IMAGE)…"
      $DOCKER pull "$IMAGE"
    fi
    if $DOCKER ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
      $DOCKER start "$NAME" >/dev/null
      echo "==> LiveKit запущен (контейнер $NAME)."
    else
      $DOCKER run -d --name "$NAME" --network host \
        -v "$CONFIG:/etc/livekit.yaml:ro" \
        --restart unless-stopped \
        "$IMAGE" --config /etc/livekit.yaml >/dev/null
      echo "==> LiveKit создан и запущен."
    fi
    echo "    Signaling: ws://localhost:7880   Health: curl http://localhost:7880/"
    ;;
  down|stop)
    $DOCKER stop "$NAME" >/dev/null 2>&1 && echo "==> LiveKit остановлен." || echo "==> LiveKit не запущен."
    ;;
  rm|remove)
    $DOCKER rm -f "$NAME" >/dev/null 2>&1 && echo "==> Контейнер $NAME удалён." || echo "==> Контейнера нет."
    ;;
  logs)
    $DOCKER logs -f "$NAME"
    ;;
  status)
    $DOCKER ps -a --filter "name=$NAME" --format 'table {{.Names}}\t{{.Status}}'
    ;;
  *)
    echo "usage: $0 {up|down|rm|logs|status}"
    exit 1
    ;;
esac
