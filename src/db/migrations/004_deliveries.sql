CREATE TYPE delivery_status AS ENUM ('pending', 'delivered', 'failed', 'dead_letter');

CREATE TABLE IF NOT EXISTS deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status delivery_status NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  response_status INTEGER,
  response_body TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deliveries_tenant_id ON deliveries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_event_id ON deliveries(event_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_subscriber_id ON deliveries(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(tenant_id, status);
