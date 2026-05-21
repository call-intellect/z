#!/usr/bin/env bash
#
# LiveKit Egress для локальной разработки.
# Требуется для записи встреч (composite MP4 + track OGG).
#
# Предварительно должны быть запущены:
#   docker compose -f docker-compose.dev.yml up -d   # Redis
#   infra/livekit/livekit-dev.sh up                  # LiveKit Server
#
# Использование:
#   infra/livekit/egress-dev.sh up       # поднять
#   infra/livekit/egress-dev.sh down     # остановить
#   infra/livekit/egress-dev.sh rm       # удалить контейнер
#   infra/livekit/egress-dev.sh logs     # логи
#   infra/livekit/egress-dev.sh status   # статус
#
# Конфигурация S3 — в egress.dev.yaml (совпадает с S3_* в backend/.env).
set -euo pipefail

IMAGE="livekit/egress:latest"
NAME="z-livekit-egress-dev"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$DIR/egress.dev.yaml"

DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  DOCKER="sudo docker"
fi

cmd="${1:-up}"
case "$cmd" in
  up|start)
    if ! $DOCKER image inspect "$IMAGE" >/dev/null 2>&1; then
      echo "==> Первый запуск: скачиваю образ LiveKit Egress ($IMAGE)…"
      $DOCKER pull "$IMAGE"
    fi
    if $DOCKER ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
      $DOCKER start "$NAME" >/dev/null
      echo "==> LiveKit Egress запущен (контейнер $NAME)."
    else
      $DOCKER run -d --name "$NAME" \
        --network host \
        --privileged \
        -v "$CONFIG:/etc/egress.yaml:ro" \
        -e EGRESS_CONFIG_FILE=/etc/egress.yaml \
        --restart unless-stopped \
        "$IMAGE" >/dev/null
      echo "==> LiveKit Egress создан и запущен."
    fi
    echo "    Composite и track egress готовы. Логи: $0 logs"
    ;;
  down|stop)
    $DOCKER stop "$NAME" >/dev/null 2>&1 && echo "==> LiveKit Egress остановлен." || echo "==> LiveKit Egress не запущен."
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
