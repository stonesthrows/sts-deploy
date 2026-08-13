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
// A job whose worked time runs past an hour carries a 15-minute break, as a
// FLOOR on the deduction rather than an addition to it — a bench worker who
// paused for a real 25-minute break loses 25, not 40. Mirrored in
// js/restock.js (_rqApplyBreak) and time-tracker.html; all three must agree or
// the number moves on its own after this Worker's next sweep.
const BREAK_MS       = 15 * 60 * 1000;
const BREAK_AFTER_MS = 60 * 60 * 1000;

// ── Open-timer sweep ─────────────────────────────────────────────────
// A restock timer nobody stops runs forever. js/restock.js polls the Square
// clock and pauses/stops it, but that poll only exists inside an open, awake
// browser tab — so it reliably does NOT fire in the one case it is for: end of
// day, clock out, put the iPad down. Same failure mode as ADR 0002, same fix:
// only a process independent of the browser can act after that point.
//
// This is a BACKSTOP, not a competitor. Its window is deliberately longer than
// the client's 90-minute conversion so it only mops up what the client could
// not, and it implements the stop decision only — never pause/resume. Two
// systems racing to make the same decision is how the resurrect-and-restop loop
// happened; one that deliberately runs late does not race.
const SWEEP_AFTER_MS      = 3  * 60 * 60 * 1000; // clocked out this long → finalize
// Ceiling on what an unattended save may write, mirroring the client guard in
// js/restock.js (_RQ_STALE_MS). Above it nothing is written and the timer is
// flagged for a human instead — a forgotten timer once banked 334 hours.
const HOLD_ABOVE_NET_MS   = 12 * 60 * 60 * 1000;
const RQ_TIMER_PREFIX     = 'rq_timer:';

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
  if (!squareToken)  return jsonResp({ error: 'SQUARE_TOKEN not set' }, 500);

  const body = await context.request.json().catch(() => ({}));

  // Square-only action: is this employee still on the clock, and if not, when
  // did they punch out? Drives the Restock Queue's auto-stop (js/restock.js).
  // Lives here rather than client-side so it can reuse resolveTeamMemberId and
  // the KNOWN_TEAM_MEMBER_IDS alias map — the queue only knows an employee by
  // name, and a second copy of that mapping is exactly what this file exists
  // to avoid. Needs no Notion access, so it runs before the NOTION_TOKEN gate.
  if (body.action === 'shift-status') {
    try {
      const deps = { squareToken };
      const teamMembers = await fetchTeamMembers(deps);
      return jsonResp(await shiftStatus(deps, teamMembers, body.employeeName || '', body.sinceIso || null));
    } catch (e) {
      // 502, not a 200 with a null shift: the caller stops a running timer on
      // this answer, and "the lookup broke" must never read as "clocked out".
      return jsonResp({ error: e.message || String(e) }, 502);
    }
  }

  if (!notionToken) return jsonResp({ error: 'NOTION_TOKEN not set' }, 500);

  try {
    // STS_TIMER is the same KV namespace functions/api/rq-timer-state.js uses;
    // both are Pages Functions in one project, so the binding is already here.
    const deps = { notionToken, squareToken, kv: context.env.STS_TIMER };
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
    // Same cron pass also closes timers nobody stopped. Runs after the session
    // sweep and in its own try, so a failure here can't cost us the
    // reconciliation work that already succeeded.
    let openTimers = null;
    try {
      openTimers = await sweepOpenTimers(deps, teamMembers);
    } catch (e) {
      openTimers = { error: e.message || String(e) };
    }
    return jsonResp({ swept: results.length, synced: results.filter(r => r.status === 'synced').length,
      failed: results.filter(r => r.status === 'failed').length, results, openTimers });
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

// Clock state for one employee, for the Restock Queue's auto-pause.
//   { clockedIn, lastEndAt, openStartAt }
// lastEndAt is the most recent clock-out AFTER sinceIso (the timer's start).
// Filtering by sinceIso matters: an earlier shift's end_at would rewind a
// session's stop time behind its own start. Null means "no recoverable punch"
// — the caller must then leave the timer alone rather than acting at "now",
// which would bank every minute since the punch it couldn't see.
//
// openStartAt is when the currently-open shift began, so a resume can be
// backdated to the punch rather than to whenever the 3-minute poll noticed it.
async function shiftStatus(deps, teamMembers, empName, sinceIso) {
  const empId = resolveTeamMemberId(empName, teamMembers);
  if (!empId) throw new Error('employee not matched in Square: ' + (empName || '(none)'));

  const sinceMs = sinceIso ? new Date(sinceIso).getTime() : 0;
  if (sinceIso && isNaN(sinceMs)) throw new Error('bad sinceIso');

  const res = await fetch(`${SQUARE_API}/v2/labor/shifts/search`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + deps.squareToken, 'Square-Version': SQUARE_VER, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: {
        filter: {
          team_member_ids: [empId],
          location_ids: [SQ_LOCATION],
          // 24h back from the timer start covers an overnight or adjacent shift.
          start: { start_at: new Date((sinceMs || Date.now()) - 24 * 60 * 60 * 1000).toISOString() },
        },
        sort: { field: 'START_AT', order: 'DESC' },
      },
      limit: 10,
    }),
  });
  const data = await res.json();
  // An error payload must throw, not fall through as an empty shift list — an
  // empty list reads as "clocked out" and would stop every running timer on
  // nothing worse than a blip at Square.
  if (!res.ok || (data.errors && data.errors.length)) {
    throw new Error((data.errors && data.errors[0] && data.errors[0].detail) || data.message || 'Square shift search failed');
  }

  const shifts = data.shifts || [];
  const ends = shifts.map(s => (s.end_at ? new Date(s.end_at).getTime() : 0)).filter(ms => ms > sinceMs);
  // Newest open shift, if they're on the clock right now. Shifts come back
  // sorted START_AT DESC, but sort defensively rather than trusting the order.
  const open = shifts.filter(s => !s.end_at)
    .sort((a, b) => new Date(b.start_at) - new Date(a.start_at))[0] || null;
  return {
    clockedIn: !!open,
    lastEndAt: ends.length ? new Date(Math.max(...ends)).toISOString() : null,
    openStartAt: open && open.start_at ? open.start_at : null,
  };
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

// ── Reconciliation (the math previously duplicated client-side) ───────

function reconcile(startTime, stopTime, shifts, recordedDedMs) {
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
  let workedMs = 0;
  overlapping.forEach(sh => {
    const cin  = Math.max(new Date(sh.start_at).getTime(), pStartMs);
    const cout = Math.min(sh.end_at ? new Date(sh.end_at).getTime() : pStopMs, pStopMs);
    if (cout > cin) workedMs += (cout - cin);
  });
  // Two independent readings of off-bench time: the span the employee was
  // clocked out of Square inside the timer window, and the time they actually
  // paused the timer (recorded at Stop). Take the larger, never the sum — a
  // lunch that was both paused and punched out is one lunch, and adding them
  // would bill it twice. This under-counts when a pause and a clock-out cover
  // different minutes; an exact union needs per-pause timestamps, which the
  // session record doesn't carry.
  //
  // The break is then floored onto that, but only once the job's worked time
  // runs past an hour — the flat 15 this replaces came off every session
  // regardless of length, so a 20-minute restock reconciled to 5 minutes of
  // bench time and anything shorter reconciled to zero.
  const clockedOutMs = Math.max(0, totalMs - workedMs);
  const offBenchMs = Math.max(clockedOutMs, recordedDedMs || 0);
  const benchMs = Math.max(0, totalMs - offBenchMs);
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

// ── Open-timer sweep ─────────────────────────────────────────────────

// What a still-running timer would record if finalized at stopMs. Mirrors
// _rqSessionSpan in js/restock.js — same fields, same break rule — so a session
// closed by this sweep is indistinguishable from one the bench closed.
function openTimerSpan(t, stopMs) {
  const wallMs = Math.max(0, stopMs - t.startTime);
  let pausedMs = (t.pausedMs || 0) + (t.pausedAt ? Math.max(0, stopMs - t.pausedAt) : 0);
  pausedMs = Math.min(pausedMs, wallMs);
  const workedMs = Math.max(0, wallMs - pausedMs);
  const dedMs = workedMs <= BREAK_AFTER_MS
    ? pausedMs
    : Math.min(wallMs, Math.max(pausedMs, BREAK_MS));
  return { wallMs, pausedMs, dedMs, netMs: Math.max(0, wallMs - dedMs) };
}

// Decide what to do with one open timer. Returns an action rather than
// performing one, so every branch can be driven directly in a test — this runs
// unattended and writes payroll data, so a silent wrong branch is expensive.
//
//   null                        → leave it running
//   { kind:'close',  at, span } → finalize at the punch
//   { kind:'hold',   at, span } → implausible; write nothing, flag for a human
function openTimerAction(t, clock, nowMs) {
  if (!t || !t.startTime || t.closed) return null;
  // Already flagged; a person has to resolve it.
  if (t.autoSaveHeld) return null;
  // Still on the clock — nothing to do, whatever else is true.
  if (clock.clockedIn) return null;
  // No clock-out after this timer started. Covers people who don't punch at
  // all (Kyle), and the case where the only end_at predates the timer, which
  // would rewind the stop behind the start.
  if (!clock.lastEndAt) return null;
  const endMs = new Date(clock.lastEndAt).getTime();
  if (!endMs || endMs <= t.startTime) return null;
  // Inside the client's window — let the bench's own poll handle it, so the two
  // never act on the same punch.
  if (nowMs - endMs <= SWEEP_AFTER_MS) return null;

  const span = openTimerSpan(t, endMs);
  return { kind: span.netMs > HOLD_ABOVE_NET_MS ? 'hold' : 'close', at: endMs, span };
}

async function readOpenTimers(kv) {
  const out = {};
  let cursor;
  for (;;) {
    const page = cursor ? await kv.list({ prefix: RQ_TIMER_PREFIX, cursor })
                        : await kv.list({ prefix: RQ_TIMER_PREFIX });
    await Promise.all((page.keys || []).map(async (k) => {
      try {
        const val = await kv.get(k.name);
        if (val) out[k.name.slice(RQ_TIMER_PREFIX.length)] = JSON.parse(val);
      } catch (e) { /* skip unparsable entry */ }
    }));
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }
  return out;
}

// The owning device treats "my timer is missing from KV" as a cue to re-push
// it, so deleting the key here would resurrect the timer from the other side.
// Overwrite it with a marker the client knows how to finalize on instead.
//
// The TTL is the marker's whole lifecycle: clients never delete it (whichever
// device polled first would otherwise pull the key out from under one that
// hadn't yet, and that one would self-heal the timer back). Two days is well
// past every device having polled, and the client's tombstone keeps it inert
// meanwhile.
const CLOSED_MARKER_TTL_SECS = 2 * 24 * 60 * 60;

async function markTimerClosed(kv, pid, entry, stopAtMs) {
  const closed = Object.assign({}, entry, { closed: true, stopAt: stopAtMs, sqRev: Date.now() });
  await kv.put(RQ_TIMER_PREFIX + pid, JSON.stringify(closed), { expirationTtl: CLOSED_MARKER_TTL_SECS });
}

async function sweepOpenTimers(deps, teamMembers) {
  const kv = deps.kv;
  if (!kv) return { swept: 0, closed: 0, held: 0, results: [], skipped: 'no STS_TIMER binding' };

  const timers = await readOpenTimers(kv);
  const results = [];
  const nowMs = Date.now();

  for (const pid of Object.keys(timers)) {
    const t = timers[pid];
    if (!t || t.closed || !t.startTime) continue;
    const empName = (t.employee && t.employee.name) || '';
    if (!empName) { results.push({ pid, status: 'skipped', reason: 'no employee' }); continue; }

    try {
      // Throws on an error payload rather than returning an empty shift list —
      // "the lookup broke" must never read as "clocked out" and close a timer.
      const clock = await shiftStatus(deps, teamMembers, empName, new Date(t.startTime).toISOString());
      const act = openTimerAction(t, clock, nowMs);
      if (!act) { results.push({ pid, status: 'running' }); continue; }

      if (act.kind === 'hold') {
        await kv.put(RQ_TIMER_PREFIX + pid,
          JSON.stringify(Object.assign({}, t, { autoSaveHeld: true, sqRev: Date.now() })),
          { expirationTtl: 30 * 24 * 60 * 60 });
        results.push({ pid, status: 'held', netMin: +(act.span.netMs / 60000).toFixed(2) });
        continue;
      }

      if (t.sessionNotionPageId) {
        await notionPatch(deps, t.sessionNotionPageId, {
          'Stop Time':                  { date: { start: new Date(act.at).toISOString() } },
          'Duration (min)':             { number: +(act.span.wallMs / 60000).toFixed(2) },
          'Clocked-Out Deducted (min)': { number: +(act.span.dedMs  / 60000).toFixed(2) },
          'Net Work Time (min)':        { number: +(act.span.netMs  / 60000).toFixed(2) },
        });
      }
      await markTimerClosed(kv, pid, t, act.at);
      results.push({ pid, status: 'closed', stopAt: new Date(act.at).toISOString(),
                     netMin: +(act.span.netMs / 60000).toFixed(2) });
    } catch (e) {
      // Leave the timer running — the next sweep retries in 15 minutes.
      results.push({ pid, status: 'error', reason: e.message || String(e) });
    }
  }

  return {
    swept: results.length,
    closed: results.filter(r => r.status === 'closed').length,
    held: results.filter(r => r.status === 'held').length,
    results,
  };
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
