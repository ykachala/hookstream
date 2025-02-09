import { Registry, Counter, Histogram, Gauge } from 'prom-client';

export const registry = new Registry();

export const deliveriesTotal = new Counter({
  name: 'hookstream_deliveries_total',
  help: 'Total delivery attempts by status',
  labelNames: ['status', 'tenant_id'] as const,
  registers: [registry],
});

export const deliveryDuration = new Histogram({
  name: 'hookstream_delivery_duration_seconds',
  help: 'HTTP delivery request duration in seconds',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  labelNames: ['status'] as const,
  registers: [registry],
});

export const queueDepth = new Gauge({
  name: 'hookstream_queue_depth',
  help: 'Current number of jobs waiting in the delivery queue',
  registers: [registry],
});

export const circuitBreakerState = new Gauge({
  name: 'hookstream_circuit_breaker_state',
  help: 'Circuit breaker state per subscriber (0=CLOSED, 1=OPEN, 2=HALF_OPEN)',
  labelNames: ['subscriber_id'] as const,
  registers: [registry],
});
