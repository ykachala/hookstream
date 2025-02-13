# hookstream

**Production-grade webhook delivery engine. Guaranteed delivery, exponential backoff, real-time observability, and multi-tenant isolation — deployable to Kubernetes in minutes.**

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat&logo=redis&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-336791?style=flat&logo=postgresql&logoColor=white)
![Kubernetes](https://img.shields.io/badge/Kubernetes-326CE5?style=flat&logo=kubernetes&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)
![Prometheus](https://img.shields.io/badge/Prometheus-E6522C?style=flat&logo=prometheus&logoColor=white)
![Grafana](https://img.shields.io/badge/Grafana-F46800?style=flat&logo=grafana&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/CI%2FCD-2088FF?style=flat&logo=github-actions&logoColor=white)
[![CI](https://github.com/ykachala/hookstream/actions/workflows/ci.yml/badge.svg)](https://github.com/ykachala/hookstream/actions/workflows/ci.yml)

---

## What this is

Hookstream is a standalone webhook delivery service. When your application fires an event, Hookstream handles getting that payload to subscriber endpoints — reliably, with retries, with full delivery history, and with observability built in.

Think of it as a self-hosted Svix or Hookdeck. Every SaaS company needs this internally; most build it badly as an afterthought. This is the correct version.

**Built for systems where delivery failure is not acceptable.**

---

## Architecture

```
Your Application
      │
      │  POST /events  (fire and forget)
      ▼
┌──────────────────┐
│   Ingest API      │  Express + TypeScript
│   - Auth check    │  Validates, enqueues, returns 202
│   - Payload sign  │  HMAC-SHA256 signature header
│   - Enqueue       │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   Redis / BullMQ  │  Durable job queue
│   - Per-tenant    │  Separate queues per tenant
│   - Priority      │  Configurable concurrency
│   - Persistence   │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│         Delivery Workers                  │
│                                           │
│  ┌─────────────────────────────────────┐ │
│  │  For each subscriber endpoint:      │ │
│  │  1. POST payload with HMAC header   │ │
│  │  2. Expect 2xx within timeout       │ │
│  │  3. On failure → exponential retry  │ │
│  │     Attempt 1: immediate            │ │
│  │     Attempt 2: +30s                 │ │
│  │     Attempt 3: +5min                │ │
│  │     Attempt 4: +30min               │ │
│  │     Attempt 5: +2hr → dead letter   │ │
│  └─────────────────────────────────────┘ │
│                                           │
│  Circuit breaker per endpoint:            │
│  5 consecutive failures → open circuit   │
│  Auto-retry after 10min cooling period   │
└────────┬─────────────────────────────────┘
         │
    ┌────┴──────────────┐
    ▼                   ▼
PostgreSQL          Prometheus
(delivery log,      (metrics: delivery
 dead letter,        rate, latency,
 subscriber cfg)     failure rate,
                     queue depth)
```

---

## Tech stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | Node.js 20 + TypeScript | Type-safe message contracts across producers and workers |
| Queue | BullMQ on Redis | Persistent, ordered, retry-aware job queue with dashboard |
| Database | PostgreSQL 15 | Delivery log, subscriber registry, dead letter store |
| Metrics | Prometheus + Grafana | Real-time delivery visibility; Grafana dashboard included |
| Containerisation | Docker + Docker Compose | Dev stack up in one command |
| Orchestration | Kubernetes + Helm | Production deployment with horizontal scaling of workers |
| CI/CD | GitHub Actions | Lint → test → build → push to registry |
| Logging | Pino | Structured JSON logs, low overhead |

---

## Features

### Delivery
- Guaranteed at-least-once delivery
- Exponential backoff with configurable retry schedule
- Per-endpoint circuit breaker — failed endpoints are paused, not hammered
- Dead letter queue for undeliverable events with manual replay
- HMAC-SHA256 signature on every delivery (`X-Hookstream-Signature` header)
- Configurable delivery timeout per endpoint

### Subscriber management
- Register endpoints via API with per-endpoint event type filters
- Endpoint verification challenge (similar to Stripe's webhook registration)
- Per-tenant endpoint isolation — tenants cannot see each other's delivery logs
- Pause / resume individual endpoints
- Rotate signing secrets without downtime

### Observability
- Prometheus metrics exported at `/metrics`:
  - `hookstream_deliveries_total` (labels: tenant, event_type, status)
  - `hookstream_delivery_duration_seconds`
  - `hookstream_queue_depth` (per tenant)
  - `hookstream_circuit_breaker_state` (per endpoint)
- Grafana dashboard definition included (`dashboards/hookstream.json`)
- Structured JSON logging on every delivery attempt
- Health endpoint: `GET /health` — liveness + queue connectivity

### API
```
POST   /api/v1/events                        # Ingest event
GET    /api/v1/events/:id                    # Event detail + delivery attempts
POST   /api/v1/subscribers                   # Register endpoint
GET    /api/v1/subscribers                   # List endpoints
DELETE /api/v1/subscribers/:id               # Remove endpoint
PATCH  /api/v1/subscribers/:id/pause         # Pause delivery
POST   /api/v1/subscribers/:id/rotate-secret # Rotate HMAC secret
GET    /api/v1/deliveries                    # Delivery log (filterable)
POST   /api/v1/deliveries/:id/replay         # Replay a failed delivery
GET    /api/v1/dead-letter                   # Dead letter queue
GET    /metrics                              # Prometheus metrics
GET    /health                               # Health check
```

---

## Getting started

```bash
git clone https://github.com/ykachala/hookstream.git
cd hookstream
cp .env.example .env
docker compose up
```

Services:
- API: `http://localhost:3000`
- BullMQ Board: `http://localhost:3001`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3002` (admin / admin)

```bash
# Run tests
npm test

# Run load test (k6)
k6 run tests/load/ingest.js
```

### Register a subscriber and fire an event

```bash
# Register your endpoint
curl -X POST http://localhost:3000/api/v1/subscribers \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-endpoint.com/hooks", "events": ["payment.completed", "user.created"]}'

# Fire an event
curl -X POST http://localhost:3000/api/v1/events \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type": "payment.completed", "payload": {"amount": 5000, "currency": "ZAR"}}'
```

---

## Verifying webhook signatures

On your endpoint, verify the `X-Hookstream-Signature` header:

```typescript
import crypto from 'crypto';

function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(`sha256=${expected}`));
}
```

---

## Performance

Benchmarked on a 4-vCPU / 8GB instance with 3 worker replicas:

| Metric | Value |
|--------|-------|
| Ingest throughput | 4,100 events/sec |
| Delivery throughput (200 OK endpoints) | 1,800 deliveries/sec |
| p95 ingest latency | 8ms |
| p95 delivery latency (fast endpoint) | 145ms |
| Queue drain time (10k backlog) | ~6 seconds |

Load test: `k6 run tests/load/ingest.js` — no sleep, targets ingest saturation. Captured output from the baseline run: [`benchmarks/results/baseline-2025-02-13.txt`](benchmarks/results/baseline-2025-02-13.txt).

---

## Kubernetes deployment

```bash
helm install hookstream ./helm/hookstream \
  --set workers.replicas=3 \
  --set redis.url=$REDIS_URL \
  --set database.url=$DATABASE_URL
```

Workers scale independently of the API — scale them horizontally to increase delivery throughput without touching the ingest layer.

---

## Project structure

```
hookstream/
├── src/
│   ├── api/              # Ingest and management routes
│   ├── workers/          # BullMQ delivery workers
│   │   ├── DeliveryWorker.ts
│   │   └── CircuitBreaker.ts
│   ├── queue/            # Queue definitions and producers
│   ├── db/               # PostgreSQL queries (no ORM — raw queries for perf)
│   ├── metrics/          # Prometheus client setup and counters
│   └── config/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── load/             # k6 scripts
├── helm/                 # Kubernetes Helm chart
├── dashboards/           # Grafana dashboard JSON
├── docker-compose.yml
└── .github/workflows/
```

---

## Related

- [nexus-scheduler](https://github.com/ykachala/nexus-scheduler) — uses Hookstream to deliver booking events to subscribers  
- [saas-multitenant-kit](https://github.com/ykachala/saas-multitenant-kit) — Hookstream integrates as the outbound event layer

---

**Author:** Yoweli Kachala &nbsp;|&nbsp; [LinkedIn](https://linkedin.com/in/yoweli-kachala) &nbsp;|&nbsp; Cape Town, South Africa
