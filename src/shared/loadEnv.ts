import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseEnvContent(content: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const index = line.indexOf('=');
    if (index <= 0) {
      continue;
    }

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

export function loadEnvFile(path = '.env'): void {
  const resolved = resolve(process.cwd(), path);
  if (!existsSync(resolved)) {
    return;
  }

  const parsed = parseEnvContent(readFileSync(resolved, 'utf-8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();
