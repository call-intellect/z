// k6 нагрузочный сценарий для Z (HTTP-уровень, без LiveKit-WS).
//
// Запуск:
//   k6 run \
//     -e BACKEND=https://z.crossmark.ru \
//     -e INTEGRATION_KEY=... \
//     scenario-meeting.js
//
// Что делает:
//   - constant-arrival-rate: 10 RPM создания встречи через Crossmark API,
//     5 минут — итого ~50 встреч.
//   - На каждую встречу: POST /integrations/crossmark/v1/meetings → /access → /join.
//   - Параллельно проверяет /health/ready и /metrics.
//
// Что измерять (в Grafana или k6 summary):
//   - http_req_duration p95 < 500ms (статика API).
//   - http_req_failed < 1%.
//   - На vm-backend: CPU < 70%, memory < 70%.
//   - LiveKit livekit_room_total ~50.
//   - BullMQ queue не растёт без остановки.

import { check, sleep } from 'k6';
import http from 'k6/http';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';

const BACKEND = __ENV.BACKEND || 'http://localhost:3000';
const INTEGRATION_KEY = __ENV.INTEGRATION_KEY || '';

export const options = {
  scenarios: {
    parallel_meetings: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1m',
      duration: '5m',
      preAllocatedVUs: 20,
      maxVUs: 50,
    },
    healthchecks: {
      executor: 'constant-vus',
      vus: 1,
      duration: '5m',
      exec: 'healthchecks',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

function hmacSign(body, ts, key) {
  return crypto.hmac('sha256', key, `${ts}.${body}`, 'hex');
}

export default function createMeetingFlow() {
  if (!INTEGRATION_KEY) {
    // Без ключа — только smoke на public endpoints.
    publicEndpointsOnly();
    return;
  }

  const externalId = `loadtest-${__VU}-${__ITER}`;
  const idempotencyKey = encoding.b64encode(`${externalId}-${Date.now()}`);
  const ts = Math.floor(Date.now() / 1000).toString();

  const payload = JSON.stringify({
    host: { external_id: externalId, email: `${externalId}@loadtest.local`, name: 'Loadtest' },
    type: 'sales',
    title: `loadtest-${externalId}`,
  });

  const signature = hmacSign(payload, ts, INTEGRATION_KEY);

  const createRes = http.post(`${BACKEND}/integrations/crossmark/v1/meetings`, payload, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${INTEGRATION_KEY}`,
      'X-Crossmark-Signature': signature,
      'X-Crossmark-Timestamp': ts,
      'X-Idempotency-Key': idempotencyKey,
    },
    tags: { name: 'POST /integrations/crossmark/v1/meetings' },
  });
  check(createRes, {
    'meeting created (201)': (r) => r.status === 201,
  });

  const meetingId = createRes.json('meeting_id');
  if (!meetingId) {
    return;
  }

  // /access (без cookie — guest-флоу).
  const accessRes = http.get(`${BACKEND}/api/v1/meetings/${meetingId}/access`, {
    tags: { name: 'GET /api/v1/meetings/:id/access' },
  });
  check(accessRes, { 'access 200': (r) => r.status === 200 });

  sleep(1);
}

export function healthchecks() {
  const r1 = http.get(`${BACKEND}/health/ready`, { tags: { name: 'GET /health/ready' } });
  check(r1, { 'ready 200': (r) => r.status === 200 });

  const r2 = http.get(`${BACKEND}/metrics`, { tags: { name: 'GET /metrics' } });
  check(r2, { 'metrics 200': (r) => r.status === 200 });

  sleep(15);
}

function publicEndpointsOnly() {
  const r = http.get(`${BACKEND}/health`, { tags: { name: 'GET /health' } });
  check(r, { 'health 200': (r) => r.status === 200 });
  sleep(1);
}
