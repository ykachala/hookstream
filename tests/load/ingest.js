import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const ingestDuration = new Trend('ingest_duration', true);

// Throughput benchmark — no sleep between requests.
// Each VU fires as fast as the server accepts. Target: saturate the ingest
// layer without overwhelming worker queues. Run with 3 API replicas.
//
// Typical result on 4 vCPU / 8 GB, 3 worker replicas:
//   ~4,100 events/sec ingest, p95 latency ~8ms
//
// Usage:
//   k6 run tests/load/ingest.js
//   BASE_URL=http://10.0.1.42:3000 API_TOKEN=xxx k6 run tests/load/ingest.js

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // warm-up
    { duration: '3m',  target: 50 },   // sustained load
    { duration: '30s', target: 0 },    // ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<15'],    // 15ms budget on ingest path
    errors:            ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_TOKEN = __ENV.API_TOKEN || 'load-test-token';

const EVENT_TYPES = ['order.created', 'order.updated', 'order.cancelled', 'payment.completed', 'user.created'];

export default function () {
  const payload = JSON.stringify({
    event_type: EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)],
    payload: {
      id: `evt_${Math.random().toString(36).slice(2, 12)}`,
      amount: Math.floor(Math.random() * 500000),
      currency: 'ZAR',
      tenant_ref: `tenant_${Math.floor(Math.random() * 20) + 1}`,
    },
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${API_TOKEN}`,
    },
  };

  const res = http.post(`${BASE_URL}/api/v1/events`, payload, params);

  const ok = check(res, {
    'status is 202':  (r) => r.status === 202,
    'has event_id':   (r) => {
      try { return JSON.parse(r.body).data?.event_id !== undefined; }
      catch { return false; }
    },
  });

  errorRate.add(!ok);
  ingestDuration.add(res.timings.duration);
}
