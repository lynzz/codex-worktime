import Database from "better-sqlite3";

import { applyAttributionOverride, revokeAttributionOverride, type AttributionOverride } from "./attribution-overrides.js";
import type { FeatureAttribution } from "./derive-feature-attributions.js";

function open(databasePath: string): Database.Database {
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS attribution_overrides (
      id TEXT PRIMARY KEY,
      original_json TEXT NOT NULL,
      replacement_feature_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      active INTEGER NOT NULL,
      revoked_reason TEXT
    )
  `);
  return database;
}

export function appendOverride(databasePath: string, input: { id: string; attribution: FeatureAttribution; replacementFeatureId: string; reason: string }): AttributionOverride {
  const override = applyAttributionOverride(input);
  const database = open(databasePath);
  try {
    database.prepare(`INSERT INTO attribution_overrides (id, original_json, replacement_feature_id, reason, active) VALUES (?, ?, ?, ?, 1)`).run(override.id, JSON.stringify(override.original), override.replacementFeatureId, override.reason);
    return override;
  } finally { database.close(); }
}

export function revokeOverride(databasePath: string, id: string, reason: string): AttributionOverride {
  const database = open(databasePath);
  try {
    const row = database.prepare(`SELECT * FROM attribution_overrides WHERE id = ?`).get(id) as { id: string; original_json: string; replacement_feature_id: string; reason: string; active: number } | undefined;
    if (!row) throw new Error(`Unknown attribution override: ${id}`);
    const revoked = revokeAttributionOverride({ id: row.id, original: JSON.parse(row.original_json) as FeatureAttribution, replacementFeatureId: row.replacement_feature_id, reason: row.reason, active: row.active === 1 }, reason);
    database.prepare(`UPDATE attribution_overrides SET active = 0, revoked_reason = ? WHERE id = ?`).run(reason, id);
    return revoked;
  } finally { database.close(); }
}

export function listOverrides(databasePath: string): AttributionOverride[] {
  const database = open(databasePath);
  try {
    return (database.prepare(`SELECT * FROM attribution_overrides ORDER BY rowid`).all() as { id: string; original_json: string; replacement_feature_id: string; reason: string; active: number; revoked_reason: string | null }[]).map((row) => ({ id: row.id, original: JSON.parse(row.original_json) as FeatureAttribution, replacementFeatureId: row.replacement_feature_id, reason: row.reason, active: row.active === 1, ...(row.revoked_reason ? { revokedReason: row.revoked_reason } : {}) }));
  } finally { database.close(); }
}
