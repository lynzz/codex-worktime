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
      reason TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attribution_override_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      override_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      reason TEXT NOT NULL
    )
  `);
  return database;
}

export function appendOverride(databasePath: string, input: { id: string; attribution: FeatureAttribution; replacementFeatureId: string; reason: string }): AttributionOverride {
  const override = applyAttributionOverride(input);
  const database = open(databasePath);
  try {
    database.prepare(`INSERT INTO attribution_overrides (id, original_json, replacement_feature_id, reason) VALUES (?, ?, ?, ?)`).run(override.id, JSON.stringify(override.original), override.replacementFeatureId, override.reason);
    database.prepare(`INSERT INTO attribution_override_events (override_id, event_type, reason) VALUES (?, 'applied', ?)`).run(override.id, override.reason);
    return override;
  } finally { database.close(); }
}

export function revokeOverride(databasePath: string, id: string, reason: string): AttributionOverride {
  const database = open(databasePath);
  try {
    const row = database.prepare(`SELECT * FROM attribution_overrides WHERE id = ?`).get(id) as { id: string; original_json: string; replacement_feature_id: string; reason: string } | undefined;
    if (!row) throw new Error(`Unknown attribution override: ${id}`);
    const revoked = revokeAttributionOverride({ id: row.id, original: JSON.parse(row.original_json) as FeatureAttribution, replacementFeatureId: row.replacement_feature_id, reason: row.reason, active: true }, reason);
    database.prepare(`INSERT INTO attribution_override_events (override_id, event_type, reason) VALUES (?, 'revoked', ?)`).run(id, reason);
    return revoked;
  } finally { database.close(); }
}

export function listOverrides(databasePath: string): AttributionOverride[] {
  const database = open(databasePath);
  try {
    return (database.prepare(`SELECT * FROM attribution_overrides ORDER BY rowid`).all() as { id: string; original_json: string; replacement_feature_id: string; reason: string }[]).map((row) => {
      const revoked = database.prepare(`SELECT reason FROM attribution_override_events WHERE override_id = ? AND event_type = 'revoked' ORDER BY sequence DESC LIMIT 1`).get(row.id) as { reason: string } | undefined;
      return { id: row.id, original: JSON.parse(row.original_json) as FeatureAttribution, replacementFeatureId: row.replacement_feature_id, reason: row.reason, active: !revoked, ...(revoked ? { revokedReason: revoked.reason } : {}) };
    });
  } finally { database.close(); }
}
