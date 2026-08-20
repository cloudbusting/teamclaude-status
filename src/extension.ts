import * as vscode from 'vscode';
import { fetchStatusForDiagnostics, UnauthorizedError } from './api/client';
import { resolveConfig, SECRET_API_KEY } from './api/config';
import { log, output } from './log';
import { Poller } from './poller';
import { TeamClaudeStatusBar } from './statusBar';
import { UsagePanel } from './popup/panel';

export function activate(context: vscode.ExtensionContext): void {
  const poller = new Poller(context.secrets);
  const statusBar = new TeamClaudeStatusBar();
  let panel: UsagePanel | undefined;

  const onState = poller.onDidChangeState((state) => {
    statusBar.update(state);
    panel?.postState(state);
  });

  context.subscriptions.push(
    poller,
    statusBar,
    onState,
    output,

    vscode.commands.registerCommand('teamclaude.openPanel', () => {
      panel = UsagePanel.createOrShow((visible) => poller.setPopupVisible(visible));
      panel.postState(poller.getState());
    }),

    vscode.commands.registerCommand('teamclaude.refresh', () => poller.refreshNow()),

    vscode.commands.registerCommand('teamclaude.setApiKey', async () => {
      const value = await vscode.window.showInputBox({
        prompt: 'TeamClaude API key',
        password: true,
        ignoreFocusOut: true,
      });
      if (value) {
        await context.secrets.store(SECRET_API_KEY, value);
        void poller.refreshNow();
      }
    }),

    vscode.commands.registerCommand('teamclaude.clearApiKey', async () => {
      await context.secrets.delete(SECRET_API_KEY);
      void poller.refreshNow();
    }),

    vscode.commands.registerCommand('teamclaude.showLogs', () => output.show()),

    vscode.commands.registerCommand('teamclaude.diagnostics', async () => {
      output.show();
      log('--- diagnostics ---');

      const { baseUrl, apiKey } = await resolveConfig(context.secrets);
      log(`resolved baseUrl: ${baseUrl ?? '(none)'}`);
      log(`resolved apiKey: ${apiKey ? 'set (' + apiKey.length + ' chars)' : '(none)'}`);

      if (!baseUrl) {
        log('no baseUrl resolved — nothing to fetch. Check teamclaude.baseUrl / teamclaude.json / $TEAMCLAUDE_CONFIG.');
        return;
      }

      try {
        const { raw, normalized } = await fetchStatusForDiagnostics(baseUrl, apiKey);
        log('raw response:');
        log(JSON.stringify(raw, null, 2));
        log('normalized:');
        log(JSON.stringify(normalized, null, 2));
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          log('request unauthorized (401/403) — check the API key.');
        } else {
          const message = err instanceof Error ? err.message : String(err);
          log(`request failed: ${message}`);
        }
      }
    }),
  );

  poller.start();
}

export function deactivate(): void {
  // Disposables registered via context.subscriptions handle teardown.
}
