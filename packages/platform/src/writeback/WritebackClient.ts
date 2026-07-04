import type { CanonicalEvent, CanonicalProductionCount } from '../canonical/entities';

export interface ProductionCountInput {
  assetId: string;
  quantity: number;
  uom: string;
  countedAt: string;
  lineageRef: string;
  shiftLogId?: string;
  isScrap?: boolean;
}

export interface DowntimeEventInput {
  assetId?: string;
  category: string;
  startedAt: string;
  endedAt?: string;
  durationMin?: number;
  lineageRef: string;
  payload: Readonly<Record<string, unknown>>;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function parseJsonObject(response: Response): Promise<JsonObject> {
  const parsed = (await response.json()) as unknown;
  if (!isObject(parsed)) {
    throw new Error('Canonical write-back returned a non-object response');
  }
  return parsed;
}

export class WritebackClient {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string | undefined = process.env.SERVICE_TOKEN,
  ) {}

  async createProductionCount(
    tenantId: string,
    input: ProductionCountInput,
  ): Promise<CanonicalProductionCount> {
    const response = await this.post(tenantId, '/production-counts', input);
    return response as unknown as CanonicalProductionCount;
  }

  async createDowntimeEvent(
    tenantId: string,
    input: DowntimeEventInput,
  ): Promise<CanonicalEvent> {
    const response = await this.post(tenantId, '/events/downtime', input);
    return response as unknown as CanonicalEvent;
  }

  private async post(
    tenantId: string,
    path: string,
    body: object,
  ): Promise<JsonObject> {
    if (!this.serviceToken?.trim()) {
      throw new Error('SERVICE_TOKEN is required for canonical write-back');
    }

    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.serviceToken}`,
        'Content-Type': 'application/json',
        'X-Tenant-Id': tenantId,
      },
      body: JSON.stringify(body),
    });

    const payload = await parseJsonObject(response);
    if (!response.ok) {
      const message = typeof payload.error === 'string'
        ? payload.error
        : `Canonical write-back failed with status ${response.status}`;
      throw new Error(message);
    }

    return payload;
  }
}

export const canonicalWriteback = new WritebackClient(
  process.env.CANONICAL_WRITEBACK_URL ?? 'http://127.0.0.1:3005/v1/canon',
);
