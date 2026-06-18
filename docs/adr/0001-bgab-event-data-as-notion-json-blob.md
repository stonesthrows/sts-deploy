# ADR 0001 — BGAB Event Data Stored as JSON Blob in Notion

**Status:** Accepted  
**Date:** 2026-06-18

## Context

BGAB Events need durable, cross-session storage. Notion was chosen as the backend (consistent with Orders, Notes, and Inventory History). The data model is hierarchical: one Event contains many Items, each with multiple Variations, each Variation tracking Brought and Sold quantities.

Two Notion storage shapes were considered:

**Option A — One Notion page per Event, item data as serialized JSON in a rich text property.**  
**Option B — One Notion page per Variation row**, with Event name, Item name, Variation name, Brought, and Sold as structured Notion properties.

## Decision

Option A: one Notion page per Event, with the full item/variation/quantity structure stored as a JSON string in a rich text block on that page.

## Reasons

- **Notion readability.** A full Art Bazaar with ~50 items × 4 variations each = 200 rows in Option B. That database would be unreadable as a human in Notion. Option A keeps one row per event — clean and scannable.
- **Consistency with existing integrations.** Every other multi-value Notion write in this app (Designs tab, Inventory History) either serializes data or uses a single lightweight record per logical unit. No integration in this codebase uses Notion as a relational store.
- **Atomic save.** Option A writes a single PATCH to one Notion page per save. Option B would require batching 200+ page updates — complex, slow, and fragile at the booth on mobile.
- **No Notion relational queries needed.** The app only ever needs "give me all events" (list) and "give me one event's data" (detail). Neither requires structured Notion properties.

## Trade-offs

- The JSON blob is opaque inside Notion — you cannot filter or sort by item name in Notion's UI.
- If the schema changes, old events need a migration (read-parse-rewrite). Acceptable given the twice-yearly cadence and small total number of events.
