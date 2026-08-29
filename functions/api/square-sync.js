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
//  POST { action:'segments', employee, startTime[, stopTime, pauses] }
//                     -> read-only bench segments for a RUNNING timer, so the
//                        Restock Queue bar can show clock-in/clock-out spans
//                        instead of raw wall clock. Touches Square only.
//
//  Requires env vars: NOTION_TOKEN, SQUARE_TOKEN
// ════════════════════════════════════════════

const NOTION_API   = 'https://api.notion.com/v1';
const NOTION_VER   = '2022-06-28';
const DB_ID        = 'e59ae574e5ee4d569395e15bd56450e9';
const SQUARE_API   = 'https://connect.squareup.com';
const SQUARE_VER   = '2025-01-23';
const SQ_LOCATION  = 'D7EZ98V48F79A';
// A job whose worked time runs past an hour carries a 15-minute break, as a
// FLOOR on the deduction rather than an addition to it — a bench worker who
// paused for a real 25-minute break loses 25, not 40. Mirrored in
// js/restock.js (_rqApplyBreak) and time-tracker.html; all three must agree or
// the number moves on its own after this Worker's next sweep.
const BREAK_MS       = 15 * 60 * 1000;
const BREAK_AFTER_MS = 60 * 60 * 1000;

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

  try {
    const deps = { notionToken, squareToken };
    const teamMembers = await fetchTeamMembers(deps);

    // Live bench segments for a timer that is still running. Read-only: it
    // touches Square and never Notion, so the Restock Queue can redraw the
    // running bar as often as it likes without risking a write.
    //
    // Deliberately derived from Square's shift history rather than from a
    // client-side poll watching for punches. A poll only runs in an open, awake
    // tab — an iPad asleep through lunch misses the clock-out and the clock-in
    // both — whereas re-reading the history repaints the whole span correctly
    // the moment the tab wakes. The previous automation was built on that poll
    // and is the reason it had to be removed.
    if (body.action === 'segments') {
      const startMs = new Date(body.startTime).getTime();
      const stopMs  = body.stopTime ? new Date(body.stopTime).getTime() : Date.now();
      if (!startMs) return jsonResp({ error: 'startTime required' }, 400);

      const empId = resolveTeamMemberId(body.employee || '', teamMembers);
      // Nobody by that name punches in Square (Kyle, or a name Square doesn't
      // know). Not an error: the caller falls back to a plain elapsed readout.
      if (!empId) return jsonResp({ punches: false, segments: [] });

      const shifts = await fetchShifts(deps, empId, new Date(startMs).toISOString(), new Date(stopMs).toISOString());
      const segments = segmentsFor(startMs, stopMs, shifts, body.pauses || []);
      return jsonResp({
        punches: true,
        // openEnd marks the segment that is still accruing, so the bar can
        // render it as "running" instead of freezing at the fetch time.
        openEnd: shifts.some(sh => !sh.end_at),
        segments, benchMs: benchMsOf(segments), asOf: stopMs,
      });
    }

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
  } catch (e) {
    // Surface Notion/Square failures (e.g. a missing DB property breaking the
    // eligibility query) as a structured error instead of an opaque 1101.
    return jsonResp({ error: e.message || String(e) }, 500);
  }
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
      // Recheck recently-*stopped* sessions for late Square corrections.
      // Keyed off the immutable Stop Time — keying off Last Square Sync
      // (which every sync resets to now) kept every synced session in the
      // recheck window forever, re-patching all of them each cron sweep.
      { and: [
        { property: 'Square Synced', checkbox: { equals: true } },
        { property: 'Stop Time', date: { after: recheckSinceIso } },
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

async function fetchShifts(deps, empId, startTime, stopTime) {
  // Scope the search to the session's window (±24h for overnight/adjacent
  // shifts) and sort newest-first. Unscoped, Square returns the oldest 100
  // shifts, so once an employee passed 100 lifetime shifts no recent session
  // could ever match — every sync went pending → "Square Sync Failed".
  const padMs = 24 * 60 * 60 * 1000;
  const res = await fetch(`${SQUARE_API}/v2/labor/shifts/search`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + deps.squareToken, 'Square-Version': SQUARE_VER, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: {
        filter: {
          team_member_ids: [empId],
          location_ids: [SQ_LOCATION],
          start: {
            start_at: new Date(new Date(startTime).getTime() - padMs).toISOString(),
            end_at:   new Date(new Date(stopTime).getTime()  + padMs).toISOString(),
          },
        },
        sort: { field: 'START_AT', order: 'DESC' },
      },
      limit: 100,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.errors && data.errors[0] && data.errors[0].detail) || data.message || 'Square shift search failed');
  return data.shifts || [];
}

// ── Bench segments ────────────────────────────────────────────────────
//
// The one place that decides which spans of a timer window count as bench
// time. Both readers go through it: reconcile() below, which writes the
// number to Notion at save, and the `segments` action, which draws the
// running timer's bar in the Restock Queue. They used to be separate pieces
// of arithmetic and the bar showed raw wall clock, so a job left running
// overnight read 27 hours on screen and saved 7.
//
// A segment is the intersection of the timer window with a Square shift,
// minus any span the operator paused by hand. Both subtractions are exact
// rather than aggregate, which is what makes the total below honest: a lunch
// that was BOTH punched out and paused is one gap, while a pause taken while
// still clocked in is a second, and comparing two aggregate totals (what this
// replaced) billed the first twice and missed the second.
//
// pauses is [{from, to}] with `to` null for a pause still open. Empty or
// absent — sessions saved before the app recorded spans — simply yields the
// clocked-in intersections, which is the old behaviour.
function segmentsFor(startMs, stopMs, shifts, pauses) {
  if (!(stopMs > startMs)) return [];

  // Clocked-in spans, clipped to the window. A shift with no end_at is still
  // open, so it runs to the end of the window.
  let segs = (shifts || []).map(sh => ({
    from: Math.max(new Date(sh.start_at).getTime(), startMs),
    to:   Math.min(sh.end_at ? new Date(sh.end_at).getTime() : stopMs, stopMs),
  })).filter(s => s.to > s.from).sort((a, b) => a.from - b.from);

  // Merge overlapping shifts before subtracting, or an overlap would survive
  // as two segments and double-count on the way to the bench total.
  segs = segs.reduce((acc, s) => {
    const last = acc[acc.length - 1];
    if (last && s.from <= last.to) { last.to = Math.max(last.to, s.to); return acc; }
    acc.push(s); return acc;
  }, []);

  // Punch out each manual pause. One pause can split one segment in two, so
  // this rebuilds the list rather than editing in place.
  (pauses || []).forEach(p => {
    const pFrom = Math.max(p.from, startMs);
    const pTo   = Math.min(p.to == null ? stopMs : p.to, stopMs);
    if (!(pTo > pFrom)) return;
    segs = segs.reduce((acc, s) => {
      if (pTo <= s.from || pFrom >= s.to) { acc.push(s); return acc; }  // no overlap
      if (pFrom > s.from) acc.push({ from: s.from, to: pFrom });        // head survives
      if (pTo   < s.to)   acc.push({ from: pTo,    to: s.to  });        // tail survives
      return acc;
    }, []);
  });

  return segs;
}

function benchMsOf(segs) {
  return segs.reduce((n, s) => n + (s.to - s.from), 0);
}

// ── Reconciliation (the math previously duplicated client-side) ───────

function reconcile(startTime, stopTime, shifts, recordedDedMs, pauses) {
  const pStartMs = new Date(startTime).getTime();
  const pStopMs  = new Date(stopTime).getTime();
  const fTime = ms => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
  const fDay  = ms => new Date(ms).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/Chicago' });

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
  // Bench time is the sum of the segments the employee was both clocked in and
  // not hand-paused, so off-bench falls out as the remainder. This replaces a
  // max() of two aggregate readings — clocked-out span vs. recorded pause total
  // — which double-billed a lunch that was both, and missed a pause taken while
  // still clocked in. segmentsFor is exact about both, so the two can simply be
  // unioned instead of compared.
  //
  // recordedDedMs is the floor the app computed at Stop, kept as a fallback for
  // sessions whose pause spans predate this and for the case where the client
  // saw shifts the sweep's own query missed.
  const benchRawMs = benchMsOf(segmentsFor(pStartMs, pStopMs, overlapping, pauses));
  const offBenchMs = Math.max(Math.max(0, totalMs - benchRawMs), recordedDedMs || 0);
  const benchMs = Math.max(0, totalMs - offBenchMs);
  // The break is then floored onto that, but only once the job's worked time
  // runs past an hour — the flat 15 this replaces came off every session
  // regardless of length, so a 20-minute restock reconciled to 5 minutes of
  // bench time and anything shorter reconciled to zero.
  const dedMs = benchMs > BREAK_AFTER_MS
    ? Math.min(totalMs, Math.max(offBenchMs, BREAK_MS))
    : offBenchMs;
  const netMs = Math.max(0, totalMs - dedMs);

  return { matched: overlapping.length > 0, notionBlock, timeline, totalMs, dedMs, netMs };
}

// ── Per-session sync ────────────────────────────────────────────────

// Join every rich_text block — long values are stored split across multiple
// 2000-char blocks (see rtBlocks in notion-timesession.js).
function txt(prop) { return (prop?.rich_text || []).map(r => r.plain_text || '').join(''); }

async function syncOneSession(deps, teamMembers, page) {
  const props = page.properties;
  const pageId    = page.id;
  const startTime = props['Start Time']?.date?.start || null;
  const stopTime  = props['Stop Time']?.date?.start || null;
  const empName   = txt(props['Employee']);
  // The deduction the app recorded at Stop — pause time the employee actually
  // banked. Null on sessions saved before it was written, which reconcile()
  // treats as "no pause signal" and falls back to the clocked-out span alone.
  const recordedDedMin = props['Clocked-Out Deducted (min)']?.number ?? null;
  if (!startTime || !stopTime) return { pageId, status: 'skipped', reason: 'incomplete session' };

  const empId = resolveTeamMemberId(empName, teamMembers);
  const stopMs = new Date(stopTime).getTime();
  const pastFailCutoff = (Date.now() - stopMs) > FAIL_AFTER_MS;

  let shifts = [];
  try {
    if (empId) shifts = await fetchShifts(deps, empId, startTime, stopTime);
  } catch (e) {
    if (pastFailCutoff) await markFailed(deps, pageId);
    return { pageId, status: 'error', reason: e.message };
  }

  const rec = reconcile(startTime, stopTime, shifts, recordedDedMin != null ? recordedDedMin * 60000 : null);

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
