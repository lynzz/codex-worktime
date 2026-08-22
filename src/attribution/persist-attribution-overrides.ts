import Database from "better-sqlite3";
import { isAbsolute, relative, resolve } from "node:path";

import { applyAttributionOverride, revokeAttributionOverride, type AttributionOverride } from "./attribution-overrides.js";
import type { FeatureAttribution } from "./derive-feature-attributions.js";

type StorageOptions = { databasePath: string; applicationDataDirectory: string; projectRoots: readonly string[] };

function inside(path: string, directory: string): boolean {
  const difference = relative(directory, path);
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference));
}

function open(options: StorageOptions): Database.Database {
  const databasePath = resolve(options.databasePath);
  const dataDirectory = resolve(options.applicationDataDirectory);
  if (!inside(databasePath, dataDirectory) || options.projectRoots.some((root) => inside(databasePath, resolve(root)))) {
    throw new Error("Attribution overrides must be stored in user application data outside Project Profile roots");
  }
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS attribution_overrides (
      id TEXT PRIMARY KEY,
      original_json TEXT NOT NULL,
      replacement_feature_id TEXT NOT NULL,
      reason TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attribution_override_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      override_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      reason TEXT NOT NULL
    )
  `);
  const legacyColumns = database.prepare("PRAGMA table_info(attribution_overrides)").all() as { name: string }[];
  if (legacyColumns.some((column) => column.name === "active")) {
    const legacyRows = database.prepare(`SELECT id, reason, active, revoked_reason FROM attribution_overrides`).all() as { id: string; reason: string; active: number; revoked_reason: string | null }[];
    const insertEvent = database.prepare(`INSERT OR IGNORE INTO attribution_override_events (override_id, event_type, reason) VALUES (?, ?, ?)`);
    const migrate = database.transaction(() => {
      for (const row of legacyRows) {
        insertEvent.run(row.id, "applied", row.reason);
        if (row.active === 0) insertEvent.run(row.id, "revoked", row.revoked_reason ?? "Migrated legacy revocation");
      }
    });
    migrate();
  }
  return database;
}

export function appendOverride(options: StorageOptions, input: { id: string; attribution: FeatureAttribution; replacementFeatureId: string; reason: string }): AttributionOverride {
  const override = applyAttributionOverride(input);
  const database = open(options);
  try {
    database.prepare(`INSERT INTO attribution_overrides (id, original_json, replacement_feature_id, reason) VALUES (?, ?, ?, ?)`).run(override.id, JSON.stringify(override.original), override.replacementFeatureId, override.reason);
    database.prepare(`INSERT INTO attribution_override_events (override_id, event_type, reason) VALUES (?, 'applied', ?)`).run(override.id, override.reason);
    return override;
  } finally { database.close(); }
}

export function revokeOverride(options: StorageOptions, id: string, reason: string): AttributionOverride {
  const database = open(options);
  try {
    const row = database.prepare(`SELECT * FROM attribution_overrides WHERE id = ?`).get(id) as { id: string; original_json: string; replacement_feature_id: string; reason: string } | undefined;
    if (!row) throw new Error(`Unknown attribution override: ${id}`);
    const revoked = revokeAttributionOverride({ id: row.id, original: JSON.parse(row.original_json) as FeatureAttribution, replacementFeatureId: row.replacement_feature_id, reason: row.reason, active: true }, reason);
    database.prepare(`INSERT INTO attribution_override_events (override_id, event_type, reason) VALUES (?, 'revoked', ?)`).run(id, reason);
    return revoked;
  } finally { database.close(); }
}

export function listOverrides(options: StorageOptions): AttributionOverride[] {
  const database = open(options);
  try {
    return (database.prepare(`SELECT * FROM attribution_overrides ORDER BY rowid`).all() as { id: string; original_json: string; replacement_feature_id: string; reason: string }[]).map((row) => {
      const revoked = database.prepare(`SELECT reason FROM attribution_override_events WHERE override_id = ? AND event_type = 'revoked' ORDER BY sequence DESC LIMIT 1`).get(row.id) as { reason: string } | undefined;
      return { id: row.id, original: JSON.parse(row.original_json) as FeatureAttribution, replacementFeatureId: row.replacement_feature_id, reason: row.reason, active: !revoked, ...(revoked ? { revokedReason: revoked.reason } : {}) };
    });
  } finally { database.close(); }
}
