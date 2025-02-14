import Anthropic from '@anthropic-ai/sdk';
import type { Delivery } from '@/db/repositories/DeliveryRepository';

export interface DiagnosisResult {
  summary: string;
  likely_cause: string;
  pattern: 'transient' | 'systematic' | 'auth' | 'endpoint_down' | 'rate_limited' | 'unknown';
  recommended_action: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Sends recent delivery failures to Claude and returns a structured root-cause diagnosis.
 * Uses claude-haiku for low latency — this is an on-demand diagnostic, not a bulk operation.
 */
export async function diagnoseEndpointFailures(
  endpointUrl: string,
  failures: Delivery[],
  apiKey: string,
): Promise<DiagnosisResult> {
  const client = new Anthropic({ apiKey });

  const failureLines = failures
    .slice(0, 20)
    .map((f) => {
      const when = (f.lastAttemptAt ?? f.createdAt).toISOString();
      return `  [${when}] attempt #${f.attemptCount}: HTTP ${f.responseStatus ?? 'timeout'} — ${f.error ?? 'no error message'}`;
    })
    .join('\n');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [
      {
        role: 'user',
        content: `You are a webhook delivery diagnostics assistant. Analyse these recent delivery failures and return a concise JSON diagnosis.

Endpoint: ${endpointUrl}
Failures (${failures.length} total, showing up to 20 most recent):
${failureLines}

Return ONLY valid JSON with this exact shape — no markdown fences, no preamble:
{
  "summary": "one sentence describing the failure pattern",
  "likely_cause": "technical explanation of the root cause",
  "pattern": "transient|systematic|auth|endpoint_down|rate_limited|unknown",
  "recommended_action": "what the developer should do next",
  "confidence": "high|medium|low"
}`,
      },
    ],
  });

  const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  return JSON.parse(cleaned) as DiagnosisResult;
}
