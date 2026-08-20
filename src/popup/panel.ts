import * as vscode from 'vscode';
import { sortForDisplay } from '../statusBar';
import type { ConnectionState } from '../api/types';
import { buildWebviewHtml } from './webviewContent';

export class UsagePanel {
  private static current: UsagePanel | undefined;

  static createOrShow(onVisibilityChange: (visible: boolean) => void): UsagePanel {
    if (UsagePanel.current) {
      UsagePanel.current.panel.reveal();
      return UsagePanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      'teamclaudeUsage',
      'TeamClaude Usage',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );

    UsagePanel.current = new UsagePanel(panel, onVisibilityChange);
    return UsagePanel.current;
  }

  private lastState: ConnectionState | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly onVisibilityChange: (visible: boolean) => void,
  ) {
    this.panel.webview.html = buildWebviewHtml(this.panel.webview.cspSource);

    this.panel.onDidDispose(() => {
      UsagePanel.current = undefined;
      this.onVisibilityChange(false);
    });

    this.panel.onDidChangeViewState(() => {
      this.onVisibilityChange(this.panel.visible);
    });

    this.panel.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === 'ready' && this.lastState) {
        this.postState(this.lastState);
      }
    });

    this.onVisibilityChange(true);
  }

  postState(state: ConnectionState): void {
    this.lastState = state;
    if (state.kind !== 'ok') {
      this.panel.webview.postMessage({
        type: 'status',
        payload: { accounts: [], server: undefined, warning: 0.7, critical: 0.9 },
      });
      return;
    }

    const cfg = vscode.workspace.getConfiguration('teamclaude');
    const warning = cfg.get<number>('warningThreshold', 0.7);
    const critical = cfg.get<number>('criticalThreshold', 0.9);

    this.panel.webview.postMessage({
      type: 'status',
      payload: {
        accounts: sortForDisplay(state.status.accounts),
        server: state.status.server,
        warning,
        critical,
      },
    });
  }
}
