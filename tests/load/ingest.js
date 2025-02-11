import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    errors: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_TOKEN = __ENV.API_TOKEN || 'your-api-token-here';

export default function () {
  const payload = JSON.stringify({
    event_type: `order.${['created', 'updated', 'cancelled'][Math.floor(Math.random() * 3)]}`,
    payload: {
      order_id: `ord_${Math.random().toString(36).slice(2, 10)}`,
      amount: Math.floor(Math.random() * 100000),
      currency: 'ZAR',
    },
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_TOKEN}`,
    },
  };

  const res = http.post(`${BASE_URL}/api/v1/events`, payload, params);

  const ok = check(res, {
    'status is 202': (r) => r.status === 202,
    'has event_id': (r) => JSON.parse(r.body).data?.event_id !== undefined,
  });

  errorRate.add(!ok);
  sleep(0.1);
}
