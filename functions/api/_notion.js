// ════════════════════════════════════════════
//  Shared Notion helpers  —  functions/api/_notion.js
//  Underscore-prefixed: ignored by the Pages router (import-only, not an
//  endpoint), same as functions/api/_middleware.js.
// ════════════════════════════════════════════

// Caller-supplied page IDs get interpolated into Notion API URL paths, so
// they must be genuine Notion IDs (32 hex, hyphenated or not) — never a
// value that could steer the request to a different path.
export function isNotionId(id) {
  return typeof id === 'string' && /^[0-9a-fA-F]{32}$/.test(id.replace(/-/g, ''));
}
