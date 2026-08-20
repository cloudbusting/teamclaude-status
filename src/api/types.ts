export interface QuotaWindow {
  used?: number;
  limit?: number;
  percent: number;
  resetsAt: string | null;
}

export interface AccountStatus {
  id: string;
  name?: string;
  org?: string;
  status: 'active' | 'throttled' | 'error';
  disabled: boolean;
  current: boolean;
  quota: {
    unified5h: QuotaWindow;
    unified7d: QuotaWindow;
    unifiedStatus: string;
  };
  usage: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    lastUsed: string | null;
  };
}

export interface ServerInfo {
  uptimeSeconds?: number;
  sessionsKnown?: number;
  sessionsActive?: number;
  probe?: unknown;
  warm?: unknown;
}

export interface TeamClaudeStatus {
  accounts: AccountStatus[];
  currentAccount?: string;
  switchThreshold?: number;
  sessions?: unknown;
  server?: ServerInfo;
}

export type ConnectionState =
  | { kind: 'unconfigured' }
  | { kind: 'loading' }
  | { kind: 'ok'; status: TeamClaudeStatus }
  | { kind: 'unreachable'; message: string }
  | { kind: 'unauthorized' };
