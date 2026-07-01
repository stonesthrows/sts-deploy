// ════════════════════════════════════════════
//  Square Shift Sync  —  /api/square-sync
//  Consolidated reconciliation of a Production Session's timer
//  against Square's /labor/shifts data. Replaces the duplicated
//  client-side syncShiftsForSession (time-tracker.html) and
//  rqSyncShiftsForSession (js/notes.js) implementations.
//
//  POST { pageId }   -> force-sync one session now (used by the
//                        manual "Sync" buttons in the app).
//  POST {}           -> sweep every eligible session (used by the
//                        square-sync-trigger Worker's Cron Trigger).
//
//  Requires env vars: NOTION_TOKEN, SQUARE_TOKEN
// ════════════════════════════════════════════

const NOTION_API   = 'https://api.notion.com/v1';
const NOTION_VER   = '2022-06-28';
const DB_ID        = 'e59ae574e5ee4d569395e15bd56450e9';
const SQUARE_API   = 'https://connect.squareup.com';
const SQUARE_VER   = '2025-01-23';
const SQ_LOCATION  = 'D7EZ98V48F79A';
const FAIL_AFTER_MS  = 48 * 60 * 60 * 1000; // give up matching a shift after 48h
const RECHECK_MS     = 7  * 24 * 60 * 60 * 1000; // re-verify synced sessions for 7 days (catch corrections)

// Names that don't resolve to their Square display name (short name used
// elsewhere in the app vs. full legal name Square returns).
const KNOWN_TEAM_MEMBER_IDS = {
  'Vanessa': 'TMAMWG-ZS9lqZWKm', 'Vanessa Bigley': 'TMAMWG-ZS9lqZWKm',
  'Stevie': 'Q5gZGbDStWUysIE3CKhJ', 'Stevana': 'Q5gZGbDStWUysIE3CKhJ', 'Stevana Schafer': 'Q5gZGbDStWUysIE3CKhJ',
};

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResp(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS),
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const notionToken = context.env.NOTION_TOKEN;
  const squareToken  = context.env.SQUARE_TOKEN;
  if (!notionToken) return jsonResp({ error: 'NOTION_TOKEN not set' }, 500);
  if (!squareToken)  return jsonResp({ error: 'SQUARE_TOKEN not set' }, 500);

  const body = await context.request.json().catch(() => ({}));

  const deps = { notionToken, squareToken };
  const teamMembers = await fetchTeamMembers(deps);

  if (body.pageId) {
    const page = await fetchNotionPage(deps, body.pageId);
    if (!page) return jsonResp({ error: 'Notion page not found' }, 404);
    const result = await syncOneSession(deps, teamMembers, page);
    return jsonResp(result);
  }

  const pages = await fetchEligibleSessions(deps);
  const results = [];
  for (const page of pages) {
    results.push(await syncOneSession(deps, teamMembers, page));
  }
  return jsonResp({ swept: results.length, synced: results.filter(r => r.status === 'synced').length,
    failed: results.filter(r => r.status === 'failed').length, results });
}

// ── Notion reads ──────────────────────────────────────────────────────

async function fetchNotionPage(deps, pageId) {
  const res = await fetch(`${NOTION_API}/pages/${pageId}`, {
    headers: { 'Authorization': 'Bearer ' + deps.notionToken, 'Notion-Version': NOTION_VER },
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchEligibleSessions(deps) {
  const nowIso = new Date().toISOString();
  const recheckSinceIso = new Date(Date.now() - RECHECK_MS).toISOString();
  const filter = {
    or: [
      { and: [
        { property: 'Stop Time', date: { is_not_empty: true } },
        { property: 'Square Sync Failed', checkbox: { equals: false } },
        { property: 'Square Synced', checkbox: { equals: false } },
      ]},
      { and: [
        { property: 'Square Synced', checkbox: { equals: true } },
        { property: 'Last Square Sync', date: { after: recheckSinceIso } },
      ]},
    ],
  };

  let results = [];
  let cursor = null;
  do {
    const queryBody = { filter, page_size: 100 };
    if (cursor) queryBody.start_cursor = cursor;
    const res = await fetch(`${NOTION_API}/databases/${DB_ID}/query`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + deps.notionToken, 'Notion-Version': NOTION_VER, 'Content-Type': 'application/json' },
      body: JSON.stringify(queryBody),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Notion query failed');
    results = results.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return results.filter(p => !p.archived);
}

// ── Square reads ──────────────────────────────────────────────────────

async function fetchTeamMembers(deps) {
  const res = await fetch(`${SQUARE_API}/v2/team-members?location_ids=${SQ_LOCATION}`, {
    headers: { 'Authorization': 'Bearer ' + deps.squareToken, 'Square-Version': SQUARE_VER },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.team_members || []).filter(m => m.status === 'ACTIVE');
}

function resolveTeamMemberId(empName, teamMembers) {
  if (!empName) return '';
  if (KNOWN_TEAM_MEMBER_IDS[empName]) return KNOWN_TEAM_MEMBER_IDS[empName];
  const match = teamMembers.find(m => {
    const fn = m.display_name || [m.given_name, m.family_name].filter(Boolean).join(' ');
    return fn === empName || fn.split(' ')[0] === empName;
  });
  return match ? match.id : '';
}

async function fetchShifts(deps, empId) {
  const res = await fetch(`${SQUARE_API}/v2/labor/shifts/search`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + deps.squareToken, 'Square-Version': SQUARE_VER, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { filter: { team_member_ids: [empId], location_ids: [SQ_LOCATION] } }, limit: 100 }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Square shift search failed');
  return data.shifts || [];
}

// ── Reconciliation (the math previously duplicated client-side) ───────

function reconcile(startTime, stopTime, shifts) {
  const pStartMs = new Date(startTime).getTime();
  const pStopMs  = new Date(stopTime).getTime();
  const fTime = ms => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const fDay  = ms => new Date(ms).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  const overlapping = shifts.filter(sh => {
    const cin  = new Date(sh.start_at).getTime();
    const cout = sh.end_at ? new Date(sh.end_at).getTime() : pStopMs;
    return cin < pStopMs && cout > pStartMs;
  });

  const timeline = [{ time: pStartMs, type: 'start' }];
  overlapping.sort((a, b) => new Date(a.start_at) - new Date(b.start_at)).forEach(sh => {
    const cin  = new Date(sh.start_at).getTime();
    const cout = sh.end_at ? new Date(sh.end_at).getTime() : pStopMs;
    if (cin  > pStartMs && cin  < pStopMs) timeline.push({ time: cin,  type: 'in'  });
    if (cout > pStartMs && cout < pStopMs) timeline.push({ time: cout, type: 'out' });
  });
  timeline.push({ time: pStopMs, type: 'stop' });

  const byDay = {};
  timeline.forEach(e => { const d = fDay(e.time); (byDay[d] = byDay[d] || []).push(e); });
  const notionBlock = '— Session Timeline —\n' + Object.entries(byDay).map(([day, es]) =>
    day + '\n' + es.map(e => {
      const label = e.type === 'start' ? '▶ Timer Start' : e.type === 'stop' ? '⏹ Timer Stop' : e.type === 'in' ? '  ▶ Clock In' : '  ⏸ Clock Out';
      return `  ${label}: ${fTime(e.time)}`;
    }).join('\n')
  ).join('\n');

  const totalMs = pStopMs - pStartMs;
  let workedMs = 0;
  overlapping.forEach(sh => {
    const cin  = Math.max(new Date(sh.start_at).getTime(), pStartMs);
    const cout = Math.min(sh.end_at ? new Date(sh.end_at).getTime() : pStopMs, pStopMs);
    if (cout > cin) workedMs += (cout - cin);
  });
  const dedMs = Math.max(0, totalMs - workedMs) + 15 * 60000;
  const netMs = Math.max(0, totalMs - dedMs);

  return { matched: overlapping.length > 0, notionBlock, timeline, totalMs, dedMs, netMs };
}

// ── Per-session sync ────────────────────────────────────────────────

function txt(prop) { return prop?.rich_text?.[0]?.plain_text || ''; }

async function syncOneSession(deps, teamMembers, page) {
  const props = page.properties;
  const pageId    = page.id;
  const startTime = props['Start Time']?.date?.start || null;
  const stopTime  = props['Stop Time']?.date?.start || null;
  const empName   = txt(props['Employee']);
  if (!startTime || !stopTime) return { pageId, status: 'skipped', reason: 'incomplete session' };

  const empId = resolveTeamMemberId(empName, teamMembers);
  const stopMs = new Date(stopTime).getTime();
  const pastFailCutoff = (Date.now() - stopMs) > FAIL_AFTER_MS;

  let shifts = [];
  try {
    if (empId) shifts = await fetchShifts(deps, empId);
  } catch (e) {
    if (pastFailCutoff) await markFailed(deps, pageId);
    return { pageId, status: 'error', reason: e.message };
  }

  const rec = reconcile(startTime, stopTime, shifts);

  if (!rec.matched) {
    if (pastFailCutoff) {
      await markFailed(deps, pageId);
      return { pageId, status: 'failed', reason: empId ? 'no matching Square shift within 48h' : 'employee not matched in Square' };
    }
    return { pageId, status: 'pending' };
  }

  const baseNotes = txt(props['Notes']).replace(/— Session Timeline —[\s\S]*$/, '').trim();
  const notes = [baseNotes, rec.notionBlock].filter(Boolean).join('\n\n');

  await notionPatch(deps, pageId, {
    'Notes':                      { rich_text: [{ text: { content: notes.slice(0, 2000) } }] },
    'Duration (min)':             { number: parseFloat((rec.totalMs / 60000).toFixed(2)) },
    'Clocked-Out Deducted (min)': { number: parseFloat((rec.dedMs / 60000).toFixed(2)) },
    'Net Work Time (min)':        { number: parseFloat((rec.netMs / 60000).toFixed(2)) },
    'Square Synced':              { checkbox: true },
    'Square Sync Failed':         { checkbox: false },
    'Last Square Sync':           { date: { start: new Date().toISOString() } },
  });

  return {
    pageId, status: 'synced', notes, notionBlock: rec.notionBlock, timeline: rec.timeline,
    totalMs: rec.totalMs, dedMs: rec.dedMs, netMs: rec.netMs,
  };
}

async function markFailed(deps, pageId) {
  await notionPatch(deps, pageId, { 'Square Sync Failed': { checkbox: true } });
}

async function notionPatch(deps, pageId, properties) {
  const res = await fetch(`${NOTION_API}/pages/${pageId}`, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + deps.notionToken, 'Notion-Version': NOTION_VER, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Notion patch failed: ' + res.status);
  }
}
