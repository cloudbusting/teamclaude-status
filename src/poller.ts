import * as vscode from 'vscode';
import { fetchStatus, UnauthorizedError } from './api/client';
import { resolveConfig, watchConfigFile } from './api/config';
import type { ConnectionState } from './api/types';
import { log } from './log';

const FOCUSED_POPUP_INTERVAL_MS = 5_000;

export class Poller implements vscode.Disposable {
  private state: ConnectionState = { kind: 'loading' };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private popupVisible = false;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly emitter = new vscode.EventEmitter<ConnectionState>();
  readonly onDidChangeState = this.emitter.event;

  constructor(private readonly secrets: vscode.SecretStorage) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('teamclaude')) {
          void this.poll();
        }
      }),
      watchConfigFile(() => void this.poll()),
      vscode.window.onDidChangeWindowState((e) => {
        if (e.focused) {
          void this.poll();
        } else if (this.timer) {
          clearTimeout(this.timer);
          this.timer = undefined;
        }
      }),
    );
  }

  getState(): ConnectionState {
    return this.state;
  }

  setPopupVisible(visible: boolean): void {
    this.popupVisible = visible;
    void this.poll();
  }

  start(): void {
    void this.poll();
  }

  async refreshNow(): Promise<void> {
    await this.poll();
  }

  private currentIntervalMs(): number {
    if (this.popupVisible) {
      return FOCUSED_POPUP_INTERVAL_MS;
    }
    const seconds = vscode.workspace
      .getConfiguration('teamclaude')
      .get<number>('pollIntervalSeconds', 20);
    return Math.max(5, seconds) * 1000;
  }

  private async poll(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    const { baseUrl, apiKey } = await resolveConfig(this.secrets);

    if (!baseUrl) {
      log('poll: unconfigured (no baseUrl resolved)');
      this.setState({ kind: 'unconfigured' });
    } else {
      try {
        const status = await fetchStatus(baseUrl, apiKey);
        log(
          `poll: ok, ${status.accounts.length} account(s) from ${baseUrl} (apiKey ${apiKey ? 'set' : 'not set'})`,
        );
        this.setState({ kind: 'ok', status });
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          log(`poll: unauthorized from ${baseUrl}`);
          this.setState({ kind: 'unauthorized' });
        } else {
          const message = err instanceof Error ? err.message : String(err);
          log(`poll: unreachable at ${baseUrl}: ${message}`);
          this.setState({ kind: 'unreachable', message });
        }
      }
    }

    if (vscode.window.state.focused) {
      this.timer = setTimeout(() => void this.poll(), this.currentIntervalMs());
    }
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    this.emitter.fire(state);
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    this.emitter.dispose();
  }
}
