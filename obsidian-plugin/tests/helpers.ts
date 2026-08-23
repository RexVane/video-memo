/**
 * Test helpers: temporary cc-switch style SQLite databases created through the
 * real node:sqlite module, mirroring the schema the plugin reads
 * (`SELECT * FROM providers`).
 */
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PROVIDERS_SCHEMA = `
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT,
  provider_type TEXT,
  app_type TEXT,
  category TEXT,
  website_url TEXT,
  sort_index INTEGER,
  created_at INTEGER,
  is_current INTEGER,
  notes TEXT,
  settings_config TEXT,
  meta TEXT
)
`;

export interface FixtureDb {
  path: string;
  db: DatabaseSync;
  /** Remove the whole temp directory, including any -wal/-shm sidecars. */
  cleanup: () => void;
}

export function createFixtureDb(): FixtureDb {
  const dir = mkdtempSync(join(tmpdir(), "ccswitch-test-"));
  const path = join(dir, "cc-switch.db");
  const db = new DatabaseSync(path);
  db.exec(PROVIDERS_SCHEMA);
  return {
    path,
    db,
    cleanup: () => {
      try {
        db.close();
      } catch {
        // Already closed by the test.
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function insertProvider(
  db: DatabaseSync,
  row: {
    id: string;
    name?: string;
    providerType?: string;
    appType?: string;
    category?: string | null;
    websiteUrl?: string | null;
    sortIndex?: number | null;
    createdAt?: number | null;
    isCurrent?: number;
    notes?: string | null;
    settingsConfig?: string | null;
    meta?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO providers (
      id, name, provider_type, app_type, category, website_url,
      sort_index, created_at, is_current, notes, settings_config, meta
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.name ?? row.id,
    row.providerType ?? "",
    row.appType ?? "codex",
    row.category ?? null,
    row.websiteUrl ?? null,
    row.sortIndex ?? null,
    row.createdAt ?? null,
    row.isCurrent ?? 0,
    row.notes ?? null,
    row.settingsConfig ?? null,
    row.meta ?? null,
  );
}

/** A settings_config carrying a codex-style TOML `config` blob. */
export function codexSettingsConfig(tomlConfig: string): string {
  return JSON.stringify({ config: tomlConfig });
}

/** A settings_config carrying a grok-style TOML `config` blob. */
export function grokSettingsConfig(tomlConfig: string): string {
  return JSON.stringify({ config: tomlConfig });
}

export function codexToml(overrides: {
  baseUrl?: string;
  envKey?: string;
  wireApi?: string;
  model?: string;
  providerName?: string;
} = {}): string {
  const providerName = overrides.providerName ?? "openai";
  const lines = [
    `model_provider = "${providerName}"`,
    "",
    `[model_providers.${providerName}]`,
  ];
  const baseUrl = overrides.baseUrl ?? "https://api.openai.com/v1";
  lines.push(`base_url = "${baseUrl}"`);
  if (overrides.envKey) lines.push(`env_key = "${overrides.envKey}"`);
  if (overrides.wireApi) lines.push(`wire_api = "${overrides.wireApi}"`);
  if (overrides.model) lines.push(`model = "${overrides.model}"`);
  return lines.join("\n");
}
