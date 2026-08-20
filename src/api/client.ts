import { log } from '../log';
import type { AccountStatus, TeamClaudeStatus } from './types';

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
  }
}

/**
 * Shape of GET /teamclaude/status as actually returned by the gateway
 * (confirmed against a live `teamclaude status --json`). Only the fields
 * this extension consumes are declared — everything else in the real
 * response is ignored.
 */
interface RawQuota {
  unified5h: number;
  unified7d: number;
  unified5hReset: number | null;
  unified7dReset: number | null;
  unifiedStatus?: string;
}

interface RawUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
  lastUsed: string | null;
}

interface RawAccount {
  name: string;
  orgName?: string;
  disabled: boolean;
  status: string;
  quota: RawQuota;
  usage: RawUsage;
}

interface RawStatus {
  accounts: RawAccount[];
  currentAccount?: string;
  switchThreshold?: number;
  sessions?: { known?: number; active?: number };
  server?: { uptimeSeconds?: number };
}

function toIso(epochMs: number | null): string | null {
  return epochMs ? new Date(epochMs).toISOString() : null;
}

function normalizeAccount(raw: RawAccount, currentAccount: string | undefined): AccountStatus {
  const status: AccountStatus['status'] =
    raw.status === 'throttled' || raw.status === 'error' ? raw.status : 'active';

  return {
    id: raw.name,
    name: raw.name,
    org: raw.orgName,
    status,
    disabled: raw.disabled,
    current: raw.name === currentAccount,
    quota: {
      unified5h: { percent: raw.quota.unified5h, resetsAt: toIso(raw.quota.unified5hReset) },
      unified7d: { percent: raw.quota.unified7d, resetsAt: toIso(raw.quota.unified7dReset) },
      unifiedStatus: raw.quota.unifiedStatus ?? '',
    },
    usage: {
      requests: raw.usage.totalRequests,
      inputTokens: raw.usage.totalInputTokens,
      outputTokens: raw.usage.totalOutputTokens,
      lastUsed: raw.usage.lastUsed,
    },
  };
}

function normalize(raw: RawStatus): TeamClaudeStatus {
  return {
    accounts: (raw.accounts ?? []).map((a) => normalizeAccount(a, raw.currentAccount)),
    currentAccount: raw.currentAccount,
    switchThreshold: raw.switchThreshold,
    server: {
      uptimeSeconds: raw.server?.uptimeSeconds,
      sessionsKnown: raw.sessions?.known,
      sessionsActive: raw.sessions?.active,
    },
  };
}

async function rawFetch(baseUrl: string, apiKey: string | undefined): Promise<RawStatus> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const res = await fetch(new URL('/teamclaude/status', baseUrl), { headers });

  if (res.status === 401 || res.status === 403) {
    throw new UnauthorizedError();
  }
  if (!res.ok) {
    throw new Error(`TeamClaude gateway returned ${res.status}`);
  }

  return (await res.json()) as RawStatus;
}

export async function fetchStatus(
  baseUrl: string,
  apiKey: string | undefined,
): Promise<TeamClaudeStatus> {
  const raw = await rawFetch(baseUrl, apiKey);
  return normalize(raw);
}

/** Diagnostics-only: fetches and returns both the untouched raw response and the normalized form. */
export async function fetchStatusForDiagnostics(
  baseUrl: string,
  apiKey: string | undefined,
): Promise<{ raw: RawStatus; normalized: TeamClaudeStatus }> {
  const raw = await rawFetch(baseUrl, apiKey);
  const normalized = normalize(raw);
  log(`diagnostics: fetched ${raw.accounts?.length ?? 0} account(s) from ${baseUrl}`);
  return { raw, normalized };
}
