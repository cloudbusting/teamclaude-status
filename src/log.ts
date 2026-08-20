import * as vscode from 'vscode';

export const output = vscode.window.createOutputChannel('TeamClaude');

export function log(message: string): void {
  output.appendLine(`[${new Date().toISOString()}] ${message}`);
}
