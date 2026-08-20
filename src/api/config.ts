import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export const SECRET_API_KEY = 'teamclaude.apiKey';

/** Fields read from teamclaude.json — nothing else from that file is ever touched. */
interface ProxyConfig {
  port?: number;
  apiKey?: string;
}

function resolveConfigPath(): string {
  const setting = vscode.workspace.getConfiguration('teamclaude').get<string>('configPath', '');
  if (setting) {
    return setting;
  }
  if (process.env.TEAMCLAUDE_CONFIG) {
    return process.env.TEAMCLAUDE_CONFIG;
  }
  return path.join(os.homedir(), '.config', 'teamclaude', 'teamclaude.json');
}

function readProxyConfig(configPath: string): ProxyConfig | undefined {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as { proxy?: ProxyConfig };
    if (!parsed.proxy) {
      return undefined;
    }
    // Only ever lift the two fields we need — never hold on to the rest of
    // the parsed object, which contains live OAuth tokens for both accounts.
    return { port: parsed.proxy.port, apiKey: parsed.proxy.apiKey };
  } catch {
    return undefined;
  }
}

export interface ResolvedConfig {
  /** undefined when no base URL could be determined at all. */
  baseUrl: string | undefined;
  apiKey: string | undefined;
}

export async function resolveConfig(secrets: vscode.SecretStorage): Promise<ResolvedConfig> {
  const cfg = vscode.workspace.getConfiguration('teamclaude');
  const configPath = resolveConfigPath();
  const proxyConfig = readProxyConfig(configPath);

  const baseUrlSetting = cfg.get<string>('baseUrl', '');
  let baseUrl: string | undefined;
  if (baseUrlSetting) {
    baseUrl = baseUrlSetting;
  } else if (proxyConfig?.port) {
    baseUrl = `http://127.0.0.1:${proxyConfig.port}`;
  } else {
    baseUrl = undefined;
  }

  const storedKey = await secrets.get(SECRET_API_KEY);
  const apiKey = storedKey || process.env.TEAMCLAUDE_API_KEY || proxyConfig?.apiKey || undefined;

  return { baseUrl, apiKey };
}

/** Watches teamclaude.json for changes so a rotated key/port is picked up without restart. */
export function watchConfigFile(onChange: () => void): vscode.Disposable {
  const configPath = resolveConfigPath();
  try {
    const watcher = fs.watch(configPath, { persistent: false }, () => onChange());
    return new vscode.Disposable(() => watcher.close());
  } catch {
    // File may not exist yet (env-var-only deployments) — nothing to watch.
    return new vscode.Disposable(() => {});
  }
}
