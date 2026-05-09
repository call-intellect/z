#!/usr/bin/env bash
#
# Финальная smoke-проверка: backend поднят, ключевые endpoint'ы отвечают,
# Crossmark API работает целиком (создание встречи через HMAC).
#
# Usage:
#   BACKEND=https://z.crossmark.ru ./smoke-test.sh
# или (локально):
#   ./smoke-test.sh
#
# Exit code:
#   0 — все проверки прошли;
#   1 — что-то упало.

set -euo pipefail

BACKEND="${BACKEND:-http://localhost:3000}"

echo "[smoke] BACKEND=${BACKEND}"

# 1. /health (200 + status=ok).
echo "[smoke] 1/5  GET /health"
curl -fsS "${BACKEND}/health" | jq -e '.status == "ok"' >/dev/null

# 2. /metrics (200 + содержит business-метрики).
echo "[smoke] 2/5  GET /metrics"
METRICS_BODY="$(curl -fsS "${BACKEND}/metrics")"
echo "${METRICS_BODY}" | grep -q 'meetings_created_total'
echo "${METRICS_BODY}" | grep -q 'ai_pipeline_duration_seconds'
echo "${METRICS_BODY}" | grep -q 'recordings_failed_total'
echo "${METRICS_BODY}" | grep -q 'llm_fallback_total'

# 3. Создаём integration_key через CLI (требует доступа к БД).
echo "[smoke] 3/5  create integration_key"
KEY="$(cd "$(dirname "$0")/../../backend" && bun run scripts/create-integration-key.ts smoke 2>/dev/null | tail -1)"
if [[ -z "${KEY}" || "${#KEY}" -lt 32 ]]; then
  echo "[smoke] FAIL: пустой integration_key"
  exit 1
fi

# 4. Создаём встречу через Crossmark API.
echo "[smoke] 4/5  POST /integrations/crossmark/v1/meetings"
TS="$(date +%s)"
BODY='{"host":{"external_id":"smoke","email":"smoke@x.x","name":"Smoke"},"type":"sales","title":"Smoke"}'
SIG="$(printf '%s.%s' "${TS}" "${BODY}" | openssl dgst -sha256 -hmac "${KEY}" -binary | xxd -p -c 256)"
IDEM="smoke-$(date +%s)-$$"

RESPONSE="$(curl -fsS -X POST "${BACKEND}/integrations/crossmark/v1/meetings" \
  -H "Authorization: Bearer ${KEY}" \
  -H "X-Crossmark-Signature: ${SIG}" \
  -H "X-Crossmark-Timestamp: ${TS}" \
  -H "X-Idempotency-Key: ${IDEM}" \
  -H "Content-Type: application/json" \
  -d "${BODY}")"

echo "${RESPONSE}" | jq -e '.meeting_id' >/dev/null

# 5. /api/docs доступен в dev.
if [[ "${BACKEND}" == *"localhost"* ]]; then
  echo "[smoke] 5/5  GET /api/docs"
  curl -fsSI "${BACKEND}/api/docs" | head -1 | grep -q '200'
else
  echo "[smoke] 5/5  skip /api/docs (prod = basic-auth)"
fi

echo "[smoke] PASSED ✓"
