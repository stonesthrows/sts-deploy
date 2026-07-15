// Drift detection between the Kanban stages the app knows about
// (js/data.js) and the Notion sync's stage map
// (functions/api/notion-pipeline.js STAGE_TO_NOTION).
//
// Why this matters: notion-pipeline.js falls back to the RAW stage id when
// a stage is missing from STAGE_TO_NOTION (`STAGE_TO_NOTION[o.stage] ||
// o.stage`), which writes e.g. "est-wait-appr" as the Notion Stage select
// value; on the next read NOTION_TO_STAGE doesn't recognize it and the
// order silently snaps back to 'intake-custom'. So any board stage missing
// from the map means cards teleport back to Custom Intake after a sync.
//
// STAGE_TO_NOTION isn't exported (Pages Functions export only handlers),
// so it's extracted from the source text — it's a static object literal.
import { describe, it, expect } from 'vitest';
import { loadGlobalScript, readSource } from './helpers/load-script.mjs';

const { STAGES, COLUMN_GROUPS } = loadGlobalScript('js/data.js', ['STAGES', 'COLUMN_GROUPS']);

const pipelineSrc = readSource('functions/api/notion-pipeline.js');
const mapMatch = /const STAGE_TO_NOTION = (\{[\s\S]*?\});/.exec(pipelineSrc);
const STAGE_TO_NOTION = new Function('return ' + mapMatch[1])();

// Stages the app defines but the Notion sync intentionally(?) does not map.
// ⚠ 'est-wait-appr' ("Waiting on Approval") looks like a REAL GAP, not an
// intentional omission: it sits on the live board (Estimating column) but
// has no Notion mapping, so dragging a card there round-trips it back to
// Custom Intake. When it gets mapped in notion-pipeline.js (and the option
// added to the Notion Stage select), delete it from this list and this
// test starts guarding it too.
const KNOWN_UNMAPPED = new Set([
  'est-wait-appr',
  'repair',      // legacy standalone Repairs stage — not on the board (no column)
  'inquiry',     // marked legacy in data.js
  'wait-cust',   // marked legacy in data.js
]);

describe('data.js internal consistency', () => {
  const stageIds = STAGES.map(s => s.id);

  it('has no duplicate stage ids', () => {
    expect(new Set(stageIds).size).toBe(stageIds.length);
  });

  it('every column-group stage the board renders exists... or is a known Notion-side-only stage', () => {
    // needs-invoice / invoice-sent appear in COLUMN_GROUPS and in the
    // Notion map but are absent from STAGES — flagged here so the gap is
    // at least explicit. If a card can land in those columns, STAGES
    // should list them too.
    const KNOWN_MISSING_FROM_STAGES = new Set(['needs-invoice', 'invoice-sent']);
    const boardIds = COLUMN_GROUPS.flatMap(g => g.stages.map(s => s.id));
    const missing = boardIds.filter(id => !stageIds.includes(id) && !KNOWN_MISSING_FROM_STAGES.has(id));
    expect(missing).toEqual([]);
  });
});

describe('app stages ↔ Notion stage map', () => {
  const boardIds = [...new Set(COLUMN_GROUPS.flatMap(g => g.stages.map(s => s.id)))];

  it('every stage rendered on the board maps to a Notion Stage option (except documented gaps)', () => {
    const unmapped = boardIds.filter(id => !(id in STAGE_TO_NOTION) && !KNOWN_UNMAPPED.has(id));
    expect(unmapped).toEqual([]);
  });

  it('every non-legacy STAGES entry maps to a Notion Stage option (except documented gaps)', () => {
    const unmapped = STAGES
      .map(s => s.id)
      .filter(id => !(id in STAGE_TO_NOTION) && !KNOWN_UNMAPPED.has(id));
    expect(unmapped).toEqual([]);
  });

  it('documented gaps stay accurate — a mapped stage must leave KNOWN_UNMAPPED', () => {
    const stale = [...KNOWN_UNMAPPED].filter(id => id in STAGE_TO_NOTION);
    expect(stale).toEqual([]);
  });

  it('Notion option names are unique, so NOTION_TO_STAGE round-trips losslessly', () => {
    // notion-pipeline.js inverts the map by lowercased value; a duplicate
    // value would silently remap one stage onto another.
    const values = Object.values(STAGE_TO_NOTION).map(v => v.toLowerCase());
    expect(new Set(values).size).toBe(values.length);
  });
});
