import * as vscode from 'vscode';
import type { AccountStatus, ConnectionState, QuotaWindow } from './api/types';

const SPARKLINE_GLYPHS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const CLIP_GLYPH = '⋯';

function accountUrgency(account: AccountStatus): number {
  return Math.max(account.quota.unified5h.percent, account.quota.unified7d.percent);
}

function glyphFor(percent: number): string {
  const idx = Math.min(SPARKLINE_GLYPHS.length - 1, Math.max(0, Math.floor(percent * SPARKLINE_GLYPHS.length)));
  return SPARKLINE_GLYPHS[idx];
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function formatCooldown(resetsAt: string, includeDays: boolean): string {
  const diffMs = new Date(resetsAt).getTime() - Date.now();
  if (diffMs <= 0) return '0m';
  const totalMins = Math.ceil(diffMs / 60000);
  let mins = totalMins % 60;
  let hours = Math.floor(totalMins / 60);
  let days = 0;
  if (includeDays) {
    days = Math.floor(hours / 24);
    hours = hours % 24;
  }
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0 || parts.length === 0) parts.push(`${mins}m`);
  return parts.join(' ');
}

function windowValue(window: QuotaWindow, includeDays: boolean): string {
  if (window.percent >= 1 && window.resetsAt) {
    return formatCooldown(window.resetsAt, includeDays);
  }
  return pct(window.percent);
}

function sortByUrgency(accounts: AccountStatus[]): AccountStatus[] {
  return [...accounts].sort((a, b) => accountUrgency(b) - accountUrgency(a));
}

function currentAccount(accounts: AccountStatus[]): AccountStatus {
  return accounts.find((a) => a.current) ?? sortByUrgency(accounts)[0];
}

function average7dPercent(accounts: AccountStatus[]): number {
  return accounts.reduce((sum, a) => sum + a.quota.unified7d.percent, 0) / accounts.length;
}

/** Sort order shared by the tooltip and popup: current account first, then most urgent. */
export function sortForDisplay(accounts: AccountStatus[]): AccountStatus[] {
  return [...accounts].sort((a, b) => {
    if (a.current !== b.current) {
      return a.current ? -1 : 1;
    }
    return accountUrgency(b) - accountUrgency(a);
  });
}

function buildInlineText(accounts: AccountStatus[], maxGlyphs: number): string {
  if (accounts.length === 0) {
    return '$(circle-slash) No accounts';
  }

  const headlinePct = pct(currentAccount(accounts).quota.unified5h.percent);

  if (accounts.length === 1) {
    return `$(pulse) ${headlinePct}`;
  }

  const sorted = sortByUrgency(accounts);
  const accountGlyphs = (a: AccountStatus) => `${glyphFor(a.quota.unified5h.percent)}${glyphFor(a.quota.unified7d.percent)}`;
  let glyphs: string;
  if (accounts.length <= maxGlyphs) {
    glyphs = sorted.map(accountGlyphs).join(' ');
  } else {
    const shown = sorted.slice(0, Math.max(1, maxGlyphs - 1));
    glyphs = shown.map(accountGlyphs).join(' ') + ' ' + CLIP_GLYPH;
  }

  const avgPct = pct(average7dPercent(accounts));
  return `$(pulse) ${headlinePct} ${glyphs} ${avgPct}`;
}

function statusBadge(account: AccountStatus): string {
  if (account.disabled) return 'disabled';
  if (account.status === 'throttled') return 'throttled';
  if (account.status === 'error') return 'error';
  return account.current ? 'current' : 'active';
}

function buildTooltip(status: ConnectionState & { kind: 'ok' }): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = false;
  const accounts = status.status.accounts;

  if (accounts.length === 0) {
    md.appendMarkdown('No TeamClaude accounts configured.');
    return md;
  }

  md.appendMarkdown('**TeamClaude usage**\n\n');
  md.appendMarkdown('| Account | 5h | 7d | Status |\n');
  md.appendMarkdown('|---|---|---|---|\n');
  for (const account of sortForDisplay(accounts)) {
    const name = account.name || account.id;
    const fiveH = windowValue(account.quota.unified5h, false);
    const sevenD = windowValue(account.quota.unified7d, true);
    md.appendMarkdown(`| ${name} | ${fiveH} | ${sevenD} | ${statusBadge(account)} |\n`);
  }
  if (accounts.length > 1) {
    md.appendMarkdown(`| **Overall** | | **${pct(average7dPercent(accounts))}** | |\n`);
  }
  md.appendMarkdown('\n_Click to see full usage details._');
  return md;
}

function thresholdColor(accounts: AccountStatus[]): vscode.ThemeColor | undefined {
  if (accounts.length === 0) {
    return undefined;
  }
  const cfg = vscode.workspace.getConfiguration('teamclaude');
  const warning = cfg.get<number>('warningThreshold', 0.7);
  const critical = cfg.get<number>('criticalThreshold', 0.9);
  const avgUrgency = average7dPercent(accounts);

  if (avgUrgency >= critical) {
    return new vscode.ThemeColor('statusBarItem.errorBackground');
  }
  if (avgUrgency >= warning) {
    return new vscode.ThemeColor('statusBarItem.warningBackground');
  }
  return undefined;
}

export class TeamClaudeStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'teamclaude.openPanel';
    this.item.show();
  }

  update(state: ConnectionState): void {
    switch (state.kind) {
      case 'loading':
        this.item.text = '$(sync~spin) TeamClaude';
        this.item.tooltip = 'Loading TeamClaude status…';
        this.item.backgroundColor = undefined;
        break;

      case 'unconfigured':
        this.item.text = '$(debug-disconnect) TeamClaude';
        this.item.tooltip = new vscode.MarkdownString(
          'TeamClaude gateway not configured.\n\nSet `teamclaude.baseUrl`, or run this in an environment where `teamclaude.json` is reachable.',
        );
        this.item.backgroundColor = undefined;
        break;

      case 'unreachable':
        this.item.text = '$(debug-disconnect) TeamClaude';
        this.item.tooltip = new vscode.MarkdownString(
          `TeamClaude gateway unreachable: ${state.message}\n\nIs the gateway container running? Is \`teamclaude.baseUrl\` correct?`,
        );
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        break;

      case 'unauthorized':
        this.item.text = '$(debug-disconnect) TeamClaude';
        this.item.tooltip = new vscode.MarkdownString(
          'TeamClaude gateway rejected the request (unauthorized).\n\nRun **TeamClaude: Set API Key…** to provide a valid key, or check `TEAMCLAUDE_API_KEY`/`teamclaude.json`.',
        );
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        break;

      case 'ok': {
        const cfg = vscode.workspace.getConfiguration('teamclaude');
        const maxGlyphs = cfg.get<number>('maxStatusBarAccounts', 8);
        const accounts = state.status.accounts;
        this.item.text = buildInlineText(accounts, maxGlyphs);
        this.item.tooltip = buildTooltip(state);
        this.item.backgroundColor = thresholdColor(accounts);
        break;
      }
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
