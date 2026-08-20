function nonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

export function buildWebviewHtml(cspSource: string): string {
  const scriptNonce = nonce();

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${scriptNonce}';" />
<title>TeamClaude Usage</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 16px;
    margin: 0;
  }
  h1 { font-size: 1.1em; margin: 0 0 12px; }
  #server-footer {
    margin-bottom: 14px;
    color: var(--vscode-descriptionForeground);
    font-size: 0.9em;
  }
  #empty {
    color: var(--vscode-descriptionForeground);
    padding: 24px 0;
  }
  #grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
  }
  .card {
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-radius: 6px;
    padding: 12px;
    background: var(--vscode-editorWidget-background);
  }
  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    gap: 8px;
  }
  .card-title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badges { display: flex; gap: 4px; flex-shrink: 0; }
  .badge {
    font-size: 0.75em;
    padding: 1px 6px;
    border-radius: 10px;
    white-space: nowrap;
  }
  .badge-current { background: var(--vscode-charts-blue); color: var(--vscode-editor-background); }
  .badge-throttled { background: var(--vscode-charts-yellow); color: var(--vscode-editor-background); }
  .badge-error, .badge-disabled { background: var(--vscode-charts-red); color: var(--vscode-editor-background); }

  .bar-row { margin: 6px 0; }
  .bar-label {
    display: flex;
    justify-content: space-between;
    font-size: 0.85em;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 2px;
  }
  .bar-track {
    height: 6px;
    border-radius: 3px;
    background: var(--vscode-scrollbarSlider-background);
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    background: var(--vscode-charts-green);
    transition: width 0.2s ease;
  }
  .bar-fill.warning { background: var(--vscode-charts-yellow); }
  .bar-fill.critical { background: var(--vscode-charts-red); }

  .usage-line {
    margin-top: 10px;
    font-size: 0.85em;
    color: var(--vscode-descriptionForeground);
    line-height: 1.5;
  }
</style>
</head>
<body>
  <h1>TeamClaude usage</h1>
  <div id="server-footer"></div>
  <div id="empty" hidden>No accounts configured.</div>
  <div id="grid"></div>

  <script nonce="${scriptNonce}">
    const vscode = acquireVsCodeApi();
    const grid = document.getElementById('grid');
    const empty = document.getElementById('empty');
    const serverFooter = document.getElementById('server-footer');

    function pct(n) { return Math.round(n * 100) + '%'; }

    function barClass(percent, warning, critical) {
      if (percent >= critical) return 'critical';
      if (percent >= warning) return 'warning';
      return '';
    }

    function relativeTime(iso) {
      if (!iso) return 'never';
      const diffMs = Date.now() - new Date(iso).getTime();
      const mins = Math.round(diffMs / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + 'm ago';
      const hours = Math.round(mins / 60);
      if (hours < 24) return hours + 'h ago';
      return Math.round(hours / 24) + 'd ago';
    }

    function resetsIn(iso) {
      if (!iso) return null;
      const diffMs = new Date(iso).getTime() - Date.now();
      if (diffMs <= 0) return 'resetting';
      const mins = Math.round(diffMs / 60000);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      if (h >= 24) {
        const d = Math.floor(h / 24);
        const remH = h % 24;
        return 'resets in ' + d + 'd ' + remH + 'h ' + m + 'm';
      }
      return 'resets in ' + (h > 0 ? h + 'h ' : '') + m + 'm';
    }

    function badge(text, cls) {
      const span = document.createElement('span');
      span.className = 'badge ' + cls;
      span.textContent = text;
      return span;
    }

    function bar(label, window, warning, critical) {
      const row = document.createElement('div');
      row.className = 'bar-row';

      const labelRow = document.createElement('div');
      labelRow.className = 'bar-label';
      const left = document.createElement('span');
      left.textContent = label + ' ' + pct(window.percent);
      const right = document.createElement('span');
      right.textContent = resetsIn(window.resetsAt) || '';
      labelRow.append(left, right);

      const track = document.createElement('div');
      track.className = 'bar-track';
      const fill = document.createElement('div');
      fill.className = 'bar-fill ' + barClass(window.percent, warning, critical);
      fill.style.width = pct(Math.min(1, window.percent));
      track.appendChild(fill);

      row.append(labelRow, track);
      return row;
    }

    function renderCard(account, warning, critical) {
      const card = document.createElement('div');
      card.className = 'card';

      const header = document.createElement('div');
      header.className = 'card-header';
      const title = document.createElement('div');
      title.className = 'card-title';
      title.textContent = account.name || account.id;
      title.title = account.org ? account.name + ' (' + account.org + ')' : title.textContent;
      header.appendChild(title);

      const badges = document.createElement('div');
      badges.className = 'badges';
      if (account.current) badges.appendChild(badge('current', 'badge-current'));
      if (account.disabled) badges.appendChild(badge('disabled', 'badge-disabled'));
      else if (account.status === 'throttled') badges.appendChild(badge('throttled', 'badge-throttled'));
      else if (account.status === 'error') badges.appendChild(badge('error', 'badge-error'));
      header.appendChild(badges);

      card.appendChild(header);
      card.appendChild(bar('5h', account.quota.unified5h, warning, critical));
      card.appendChild(bar('7d', account.quota.unified7d, warning, critical));

      const usage = document.createElement('div');
      usage.className = 'usage-line';
      const u = account.usage;
      usage.textContent =
        u.requests + ' requests · ' +
        u.inputTokens.toLocaleString() + ' in / ' + u.outputTokens.toLocaleString() + ' out tokens · ' +
        'last used ' + relativeTime(u.lastUsed);
      card.appendChild(usage);

      return card;
    }

    function render(msg) {
      const { accounts, server, warning, critical } = msg;
      grid.innerHTML = '';

      if (!accounts || accounts.length === 0) {
        empty.hidden = false;
        grid.hidden = true;
      } else {
        empty.hidden = true;
        grid.hidden = false;
        for (const account of accounts) {
          grid.appendChild(renderCard(account, warning, critical));
        }
      }

      if (server) {
        const parts = [];
        if (typeof server.uptimeSeconds === 'number') {
          parts.push('uptime ' + Math.round(server.uptimeSeconds / 60) + 'm');
        }
        if (typeof server.sessionsActive === 'number' && typeof server.sessionsKnown === 'number') {
          parts.push(server.sessionsActive + '/' + server.sessionsKnown + ' sessions active');
        }
        serverFooter.textContent = parts.join(' · ');
      } else {
        serverFooter.textContent = '';
      }
    }

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'status') {
        render(message.payload);
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
