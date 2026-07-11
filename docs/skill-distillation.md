# STS Skill Distillation Plan

Purpose: distill the judgment a frontier model applies in this repo into explicit,
literal-minded playbooks (custom skills), so sessions run on cheaper models perform
close to frontier quality. Written 2026-07-11 from evidence in this repository only.

---

## Step 1 — Profile (evidence-based)

**Who / what.** Stones Throw Studio, a custom jewelry business (owner: Kyle,
kyle@stonesthrowjewelry.com; this session's user is georgina@stonesthrowjewelry.com).
Revenue comes from farmers-market weekends (Square), the twice-yearly Blue Genie Art
Bazaar, and a custom order / repair pipeline. The software is **STS Workflow**: one
vanilla HTML/CSS/JS PWA monolith (`jewelry-workflow.html`, ~522 KB, ~30 JS modules in
`js/`, no framework, no build step, **no test suite**), plus an iPad intake app
(`intake.html`) and a timer app (`time-tracker.html`). Hosted on Cloudflare Pages;
push to `main` = deploy. Integrations: **Notion** (source of truth for orders,
customers, work sessions), **Square** (sales, labor shifts, inventory), Gmail, Google
Drive, TripLog, plus stub integrations (Shopify, Etsy, ShipStation, USPS — small files,
apparently early-stage).

**Workflows repeated 3+ times (from git history and docs):**

1. **Single-tab fix/polish sessions** — dozens of commits like "Tighten the gap between
   stone name and its attributes", "Align stone-row columns", "Widen restock qty input".
   Small, visually-judged changes scoped to one tab or modal.
2. **Phased feature epics** — "Intake Phase 1", "Phase 2.1" … "Phase 2.7"; the sketch
   pad series (~12 commits); the Edit Order view-mode series (#10–#13). Big features are
   decomposed into numbered, individually-shipped phases.
3. **Audit → fix-plan → phased implementation** — `docs/production-report-review.md`:
   a full subsystem audit with lettered/numbered findings (A1–C7), root causes, exact
   code-level fixes, a phase plan, and items deliberately left "open by design".
4. **Sync/integration semantics work** — ADR 0002 (Square shift reconciliation via
   scheduled Worker), the snapshot-once rules for Labor Rate / Item Value, the
   `Square Synced` / `Square Sync Failed` state machine, TripLog mileage reconciliation.
5. **Decision + vocabulary documentation** — two ADRs and a 140-line domain glossary
   (`CONTEXT.md`) that pins down terms like Estimate, Deposit, Production Session.
6. **Non-code automation specs** — `STS-Automation-Guide.md` (Make.com pipelines) and
   `sts-drive-bag-scan-skill.md` (a hand-written skill already in the house style).

**Where time goes that a documented workflow could absorb:** re-locating code inside the
monolith; re-deriving sync semantics before touching them; verifying changes with no
tests; remembering deploy quirks (must touch `jewelry-workflow.html`; service-worker
cache); not resurrecting retired things (`clickup.js`, `crm.html`, Netlify URLs).

**Where evidence is thin (flagged, not guessed):** I can only see this repository — no
chat history, memory, email, or connected docs. So: Georgina's role vs Kyle's is unclear
(CLAUDE.md paths point at Kyle's machine; Production Report is "scoped to Kyle");
business volume is unknown; the Shopify/Etsy/ShipStation stubs may be active, planned,
or abandoned. Skills below rely only on the repo evidence.

---

## Step 2 — What the frontier model does that a weaker model won't

These are the implicit behaviors each skill must make explicit:

1. **Blast-radius check before editing the monolith.** Greps every identifier and CSS
   class it's about to change to see which tabs use it; refuses to do global
   find/replace in a 522 KB file. (The #1 house rule: never alter another tab's code.)
2. **Root-cause before patching.** The A1 bug was not "labor cost shows $0" → "hide
   $0"; it was traced to `_rqRateFor()` returning `0` instead of `null`, snapshotted
   forever, across three files. Sentinel-value discipline (null ≠ 0), per-device
   localStorage, and races with external systems (Square shift lag) are recurring
   root-cause classes here.
3. **Backward compatibility reflex.** Every data-shape change ships with a fallback for
   old records ("degraded but never broken" — Items JSON fallback, "(est.)" labor
   rates). Old Notion pages and old localStorage blobs must still render.
4. **Surface disambiguation.** Features exist in 2–3 places (sketch pad lives in both
   `jewelry-workflow.html` and `intake.html`; session sync logic existed in both
   `time-tracker.html` and `notes.js`). Asks *which surface* before changing "the
   sketch pad", and checks for duplicated copies of any function it fixes.
5. **Classifying "bugs" as business rules.** B4 (flat 15-minute deduction) was left
   "open by design" rather than silently "fixed" — some findings are decisions only the
   owner can make.
6. **Deploy-reality checks.** Touch `jewelry-workflow.html` (not just `sw.js`) or
   Cloudflare won't redeploy; remind about hard refresh; never open a PR unless asked.
7. **Phase decomposition** where each phase is independently shippable and committed.
8. **Verification without tests:** run `node serve.js`, click through the affected
   flows, watch the console, and test with old-shaped data — because nothing else will
   catch a regression before it hits the live app Kyle uses at the bench.
9. **Writing decisions down** (ADRs, glossary updates) so future sessions don't
   re-litigate or contradict them.
10. **Respecting the graveyard:** clickup.js, crm.html, Netlify, `2-deploy.bat` are
    retired; never edit, reference, or resurrect them.

---

## Step 3 & 4 — Skill candidates, ranked by distillation value

Ranking rule applied: a skill ranks higher the more its current quality depends on model
intelligence rather than tool access. Build in this order.

---

### 1. `root-cause-sync-bug` — Leverage 10/10

**Trigger:** Any report of wrong/missing/stale data involving Notion, Square, TripLog,
or localStorage — "labor cost shows $0", "session didn't save", "mileage is off",
"inventory count is wrong", "it didn't sync".

**DECOMPOSITION (ordered, mandatory):**
1. Restate the symptom as: *which value, on which surface (tab/app), for which record(s),
   since when.* If the report doesn't say, ask before reading code.
2. Identify the source of truth for that value using this fixed table — never guess:
   pipeline stage / orders / customers / notes / work sessions → **Notion**; market
   sales, labor shifts, retail inventory → **Square**; drives/mileage → **TripLog**;
   employee labor rates (legacy), odometer log, trip edits, push state → **localStorage
   (per device!)**; BGAB items → Notion JSON blob, never Square.
3. Trace the value's full path: where it's written → whether it's **snapshotted once**
   (Labor Rate and Item Value snapshot at first Stop & Save and are never re-snapshotted)
   → where it's read → what the display fallback is.
4. Check the four recurring root-cause classes, in order, and write down the answer for
   each even if "no": (a) sentinel confusion — is `0`/`''` being treated as "set" when
   only `null` means unset? (b) per-device state — does the value live in localStorage
   on a different device than where the bug was seen? (c) external-system lag — did the
   app read Square/Notion before the record existed (Square shifts lag stop-time; that's
   the whole reason ADR 0002 exists)? (d) old-shaped records — was the record created
   before the field existed?
5. Only after naming the root cause, write the fix. The fix must handle old records
   (fallback, migration, or "(est.)"-style marker), not just new ones.
6. Verify per `verify-without-tests` (skill 6), including one old-shaped record.

**JUDGMENT RUBRIC (all must pass):**
- [ ] The write-up names a root cause in the code, with file:line, before any fix.
  *Good:* "`_rqRateFor()` returns 0 when unset (restock-sessions.js:545); rqStopTimer
  snapshots it forever." *Bad:* "Added a check so $0 doesn't display."
- [ ] Existing records created before the fix still render (state exactly how).
- [ ] Sentinels: after the fix, "unset" is representable and distinct from a real zero.
- [ ] If the value crosses devices, the fix does not depend on localStorage.
- [ ] No second copy of the fixed logic remains (grep for duplicates — sync logic has
  historically been duplicated across `time-tracker.html` and `notes.js`).

**PUSHBACK RULES:**
- If the "fix" would change behavior that could be intentional (rounding, deductions,
  what counts as billable), STOP: present it as a business-rule question with options.
  Do not decide. (Precedent: B4 left open by design.)
- If the fix requires a Notion schema change, STOP and say so — Notion properties must
  be added by hand in Notion's UI; the API here cannot do it (ADR 0002 trade-offs).
- If you cannot reproduce the data path end-to-end from code, say which link is unproven
  instead of asserting the diagnosis.

**SELF-CHECK before showing output:** root cause stated with evidence; old-record
behavior stated; duplicate-copy grep done; business-rule question separated from bug fix.

**Evidence:** production-report-review.md A1–A5/B/C findings; ADR 0002; CONTEXT.md's
Square Synced/Failed state machine and Mileage Reconciliation spec.

---

### 2. `review-subsystem` — Leverage 9/10

**Trigger:** "Review/audit/debug the X tab", "why is X unreliable", or any request that
names a subsystem rather than a single bug.

**DECOMPOSITION:**
1. List the files in scope by tracing the tab's entry points from `jewelry-workflow.html`
   and `js/app.js` (`switchParent`/`switchTab`/`switchSubTab`), plus any
   `functions/api/*` endpoints they call. Write the list at the top of the doc.
2. Read every listed file fully. For each finding, record: an ID (A1, A2… grouped by
   theme), the symptom, the root cause with file:line, and the exact code-level fix
   (a real code block, not a description).
3. Classify each finding: **bug** (behavior contradicts intent) / **business-rule
   question** (behavior might be intended — goes in an "open by design" list with the
   decision needed) / **structural** (works but fragile — Phase 2 material).
4. Order fixes into phases: Phase 1 = bugs, smallest-risk first; Phase 2 = structural.
   Each phase must leave the app shippable.
5. Write the doc to `docs/<subsystem>-review.md` in the exact format of
   `docs/production-report-review.md` (it is the template — match its headings,
   ID scheme, and status banner). Then implement only the phase(s) the user approved,
   updating the status banner as items land.

**JUDGMENT RUBRIC:**
- [ ] Every finding has file:line and a concrete fix. *Good:* A1 in the existing review
  doc. *Bad:* "The error handling could be improved in several places."
- [ ] At least the business-rule bucket is non-empty OR the doc states you checked and
  found none — silence is a fail.
- [ ] No finding proposes a framework, build step, or rewrite; fixes stay vanilla-JS
  in-place.
- [ ] Findings about data include the old-records story.

**PUSHBACK RULES:**
- If asked to "just fix everything", still produce the doc first and get sign-off on
  business-rule items before touching them; implement pure bugs without waiting.
- If scope creeps past the named subsystem's file list, stop and confirm before reading
  another tab's code.

**SELF-CHECK:** doc committed; IDs stable; status banner reflects what's actually
implemented on the branch (not what's planned).

**Evidence:** `docs/production-report-review.md` + the two commits "Add Production
Report debug review and BI upgrade plan" → "Fix Production Report data-correctness bugs".

---

### 3. `patch-one-tab` — Leverage 9/10

**Trigger:** Any change request naming a tab, modal, or visible element ("fix the
Occasion Date misalignment", "the restock qty input clips"). This is the default skill
for most sessions.

**DECOMPOSITION:**
1. Map the request to exactly one tab from the CLAUDE.md tab list and one surface
   (`jewelry-workflow.html` desktop app vs `intake.html` iPad app vs
   `time-tracker.html`). If the element exists on more than one surface (sketch pad,
   session sync, order forms do), ask which one — or state you're changing both and why.
2. Locate the tab's code: its HTML section inside the monolith, its `js/` module(s),
   and its CSS. Write down the line ranges you consider "in scope".
3. Before editing, grep the whole repo for **every** function name, CSS class, and id
   you plan to touch. For each hit outside your scope: either leave that symbol alone
   (make a new one) or list the hit and justify why the change is safe for that tab.
4. Make the change with the smallest possible diff. New CSS classes get a tab-specific
   prefix matching the module's existing convention (e.g. `rq…` in restock code).
5. Verify per `verify-without-tests`, including a click-through of the *neighboring*
   features in the same tab.

**JUDGMENT RUBRIC:**
- [ ] `git diff` contains no hunks outside the declared scope. *Good:* commit
  "Widen restock qty input so 2-digit counts aren't clipped" — one concern, one place.
  *Bad:* a shared utility edited "while I was in there".
- [ ] No edits to retired files: `clickup.js`, `crm.html`, `crm/`, anything Netlify.
- [ ] Styling matches the tab's existing idiom (this codebase repeats patterns
  per-module rather than sharing abstractions — copy the neighbor, don't refactor it).
- [ ] View mode and edit mode both checked when touching the Edit Order popup (they are
  separate render paths — the #10–#13 commit series exists because of this).

**PUSHBACK RULES:**
- Request doesn't identify a tab, or the described element matches multiple tabs →
  stop and ask; do not search-and-guess.
- The clean fix requires changing a shared helper used by other tabs → stop, present
  the choice: duplicate locally (house norm) vs shared change with a list of every
  affected tab you will then manually verify.

**SELF-CHECK:** diff reviewed hunk-by-hunk against declared scope; identifier grep
results recorded; both modes/surfaces checked where applicable.

**Evidence:** CLAUDE.md's Key Rule (in bold, all-caps "NEVER"); ~40 recent commits are
exactly this shape.

---

### 4. `evolve-notion-schema` — Leverage 8/10

**Trigger:** Any change that adds/renames/repurposes data stored in Notion, or adds a
field to records the app persists (orders, sessions, customers, BGAB events).

**DECOMPOSITION:**
1. Decide the storage shape using the house rule: complex/nested per-record data goes
   into **one JSON blob property on one page per logical unit** (ADR 0001 pattern —
   Items JSON, BGAB Event data). Discrete Notion columns only for values Notion itself
   must filter/sort/check (sync flags, dates). Never one-page-per-child-row.
2. Write the read path FIRST, with a fallback for pages that predate the field
   ("degraded but never broken" — reconstruct what you can from core properties, mark
   estimates as "(est.)" style).
3. Decide snapshot semantics explicitly: is this value snapshotted once (like Labor
   Rate: first Stop & Save only, never re-snapshotted on edit) or live? Write the answer
   into CONTEXT.md.
4. If a new Notion property is required, output a manual-steps block for the user
   (property name, exact type, which database) — the API cannot create properties here.
5. Update `CONTEXT.md` glossary with the new term/semantics in the same entry style.

**JUDGMENT RUBRIC:**
- [ ] Old pages load without errors and display something sensible (name what).
- [ ] Save is atomic — one PATCH per logical record, never N-row batches (ADR 0001's
  booth-on-mobile reasoning).
- [ ] Snapshot-vs-live decision written down, not implied.
- [ ] Manual Notion steps listed if any property was added. *Good:* ADR 0002's
  trade-offs section listing the three properties to add by hand. *Bad:* code that
  silently 400s against a property that doesn't exist yet.

**PUSHBACK RULES:**
- Asked to store relational/filterable data as Notion rows-per-child → push back with
  ADR 0001's readability/atomicity reasons; require explicit override.
- Migration of old records is impossible or lossy → stop and present options; never
  silently drop old data.

**SELF-CHECK:** tested read path against a mentally-constructed old-shaped page;
CONTEXT.md updated; manual steps (if any) surfaced at the top of the reply.

**Evidence:** ADR 0001; Items JSON entry in CONTEXT.md; "(est.)" fallback convention.

---

### 5. `phase-big-feature` — Leverage 8/10

**Trigger:** A feature request that touches multiple screens/flows, or anything
estimated over ~300 lines of change ("redesign intake", "add a sales dashboard").

**DECOMPOSITION:**
1. Write the phase list before any code: numbered phases (1, 2.1, 2.2, …), each a
   one-line user-visible outcome, each independently shippable to `main`.
2. Order phases so the data model lands before UI that depends on it, and so each phase
   can be used at the bench the day it ships (Intake shipped sticky-total + presets
   before signature capture, not after).
3. Ship each phase as its own commit titled `<Feature> Phase N.M: <outcome>` — this
   exact format; it's how history stays navigable.
4. At each phase boundary, report what shipped and what the next phase is; the user
   may reorder or stop — treat the plan as re-negotiable at every boundary.
5. If a phase uncovers a bug in earlier work, fix it inside that phase's commit message
   ("…; fix lost order.materials" — precedent from Phase 2.3).

**JUDGMENT RUBRIC:**
- [ ] Every phase leaves the live app fully usable (no half-rendered tabs on `main`).
- [ ] No phase mixes a schema change and a large UI change in one commit.
- [ ] Phase list total ≤ ~8; more means the feature was under-decomposed at level 1
  (use sub-numbers like 2.x, as intake did).

**PUSHBACK RULES:**
- User asks to "just build the whole thing" → build it, but still in phase commits;
  do not collapse into one mega-commit.
- A requested phase ordering would ship a UI that writes data no reader handles yet →
  stop and propose the swap.

**SELF-CHECK:** each commit boots the app cleanly; phase numbering matches the plan;
final summary lists shipped phases vs deferred ones.

**Evidence:** Intake Phase 1 → 2.7 commit series; sketch pad series; ADR 0002's
two-piece rollout.

---

### 6. `verify-without-tests` — Leverage 7/10

**Trigger:** Before ANY commit that touches product code. There is no test suite; this
is the only safety net.

**DECOMPOSITION:**
1. Serve locally: `node serve.js` (port 3000; `.claude/launch.json` confirms this is
   the house runner). Open the page you changed.
2. Click the primary flow you changed, end to end, with realistic inputs (a customer
   with a long name, a 2-digit quantity, a stone with attributes).
3. Click every neighboring feature in the same tab (the things your diff sat next to).
4. Open the browser console; zero new errors/warnings is the bar.
5. Data changes: exercise the read path with an old-shaped record (no snapshot fields,
   no Items JSON) and confirm the documented fallback renders.
6. UI changes: check at iPad width (~810–1080px) and phone width (~390px) — the intake
   app lives on an iPad and commits like "Show Restock Queue's Square add bar on phones
   again" exist because this step was skipped once.
7. If the change is in the Edit Order popup: check BOTH view mode and edit mode, and a
   round-trip (edit → save → reopen) for losslessness (the "lossless round-trip +
   full parity" commit is the standard).

**JUDGMENT RUBRIC:**
- [ ] You can state, in one sentence per flow, what you clicked and what you saw —
  "it looks fine" is a fail; "created a Repair, moved it to Deposit, reopened it,
  stones intact" is a pass.
- [ ] Console clean.
- [ ] Old-data fallback observed, not assumed.

**PUSHBACK RULES:**
- If the flow can't be exercised without live credentials (Notion/Square/Gmail), say
  exactly which steps were verified locally and which need Kyle/Georgina to check on
  the live site after deploy — never claim full verification.

**SELF-CHECK:** the commit message's claim matches only what was actually observed.

**Evidence:** no test files anywhere in repo; regression-shaped commits ("…again",
"Fix dead flow/smoothing slider"); serve.js + launch.json.

---

### 7. `polish-ui-loop` — Leverage 7/10

**Trigger:** Vague aesthetic requests: "make it cleaner", "it feels cramped",
"more readable", "dynamic look".

**DECOMPOSITION:**
1. Translate the vibe into 2–4 concrete, individually-committable changes and list them
   before editing (e.g. "cramped" → row gap 4px→8px, label size 11px→13px, group
   attributes under name). Get implicit approval by stating the list; proceed unless
   told otherwise.
2. One visual concern per commit, in the house commit style: imperative, names the
   element and the tab ("Tighten the gap between stone name and its attributes in
   view mode").
3. Respect the app's established look: serif headings where the tab already uses them
   (customer form moved TO serif deliberately), existing spacing scale, existing color
   variables. Never introduce a new font, palette, or component style in a polish pass.
4. Screenshot or describe before/after per change when reporting back.

**JUDGMENT RUBRIC:**
- [ ] Each commit reversible on its own (Kyle/Georgina reverts taste misses by commit —
  granularity is the feature).
- [ ] Nothing moved between tabs; no markup restructuring beyond the named element.
- [ ] Touch targets stay ≥ 40px on intake/iPad surfaces.

**PUSHBACK RULES:**
- If "cleaner" could mean removing information (fields, hints), list what would be
  hidden and ask — precedent: hiding the redundant Gemstones field was its own
  deliberate commit, not a side effect.

**SELF-CHECK:** per-change list stated up front matches the commits produced; verified
at both desktop and iPad widths.

**Evidence:** the Edit Order view-mode polish series; sketch-dock polish commits;
"Larger, serif type for the customer edit form".

---

### 8. `write-adr` — Leverage 6/10

**Trigger:** Any decision that adds infrastructure (a Worker, an endpoint, a cron),
chooses a storage shape, or picks between ≥2 viable architectures. Also when the user
asks "should we…".

**DECOMPOSITION:**
1. Number sequentially: next is `docs/adr/000N-kebab-title.md`.
2. Use exactly the house template (match ADR 0001/0002): Status/Date header → Context
   (the problem + the options as **Option A/B** with honest descriptions) → Decision →
   Reasons (bulleted, each one falsifiable) → Trade-offs (REQUIRED — an ADR with no
   trade-offs section is rejected).
3. Trade-offs must include operational ones: new thing to maintain, manual steps
   required, feedback loops lost (ADR 0002 lists all three).
4. Reference the ADR from CLAUDE.md or CONTEXT.md if it introduces a moving part that
   future sessions must know exists (the square-sync-trigger note in CLAUDE.md is the
   model).

**JUDGMENT RUBRIC:**
- [ ] The rejected option is described well enough that a reader could disagree.
  *Good:* ADR 0001 quantifying Option B as "200 rows… unreadable". *Bad:* "Option B
  was worse."
- [ ] Every Reason ties to a real constraint of THIS business (mobile at the booth,
  one-person ops, secrets living in one place) — generic "best practice" reasons fail.

**PUSHBACK RULES:**
- If asked to implement an architecture choice with no ADR, write the ADR first when
  the decision adds a deployable or a storage shape; skip it for anything smaller.

**SELF-CHECK:** file numbered correctly; trade-offs section present; CLAUDE.md/CONTEXT.md
cross-reference added when a new moving part exists.

**Evidence:** ADR 0001, ADR 0002, and CLAUDE.md's square-sync-trigger pointer.

---

### 9. `sync-context-docs` — Leverage 5/10

**Trigger:** End of any session that changed data semantics, added/retired a feature,
tab, term, or moving part.

**DECOMPOSITION:**
1. Diff your session's changes against CONTEXT.md's glossary: any term whose meaning
   changed, any new term users will say out loud ("push", "snapshot", "failed sync")
   → add/update an entry in the existing style: **Term**, one-paragraph definition,
   including where it's stored, when it's set, and its fallback behavior.
2. Update CLAUDE.md only for structural facts: new tab in the tab list, new
   file/folder, something newly retired (add to the retired list — never delete the
   warning about a retired thing).
3. Commit docs in the same push as the feature, not a follow-up.

**JUDGMENT RUBRIC:**
- [ ] A new session reading only CLAUDE.md + CONTEXT.md would not contradict what you
  just built. Test: does the glossary answer "is this value snapshotted or live?" and
  "which system is the source of truth?" for anything you added.
- [ ] No stale claims left behind (e.g. if a localStorage store moved server-side,
  its glossary entry changed too).

**PUSHBACK RULES:**
- None — this skill never blocks; it appends. But if the session revealed the docs were
  already wrong about something you didn't touch, report it rather than silently fixing.

**SELF-CHECK:** grep CONTEXT.md and CLAUDE.md for every term/file your diff introduced.

**Evidence:** CONTEXT.md's precision (Square Synced vs Square Sync Failed distinction);
CLAUDE.md's retired-items warnings; both clearly maintained across sessions.

---

### 10. `ship-to-production` — Leverage 4/10 (ranked last by rule: mostly mechanical)

**Trigger:** Every deploy-bound push.

**DECOMPOSITION:**
1. Work on a `claude/<topic>-<suffix>` branch; push with `git push -u origin <branch>`.
2. Merging to `main` IS deploying — Cloudflare Pages auto-deploys. There is no staging.
   Treat any push to main as live at the bench within minutes.
3. Cloudflare only redeploys when `jewelry-workflow.html` changes — if your diff is
   JS/CSS-only, touch the HTML file (whitespace or version comment) in the same commit.
4. Never edit or restore: `clickup.js`, `crm.html`, `crm/`, Netlify anything,
   `2-deploy.bat`.
5. Do NOT create a PR unless explicitly asked. After deploy, remind the user: hard
   refresh (Ctrl+Shift+R) to bust the service-worker cache.
6. Commit messages: imperative, name the element and tab, phase-numbered when part of
   an epic.

**JUDGMENT RUBRIC:** [ ] HTML touched when deploy intended; [ ] no retired files in
diff; [ ] hard-refresh reminder given.

**PUSHBACK RULES:** If asked to push a half-done phase to `main`, warn that main is
production used live at the studio, and confirm.

**SELF-CHECK:** `git status` clean after push; branch name matches assignment.

**Evidence:** CLAUDE.md Deployment section (every quirk above is written there because
it was once forgotten).

---

## Build order (Step 4 recap)

1. root-cause-sync-bug — degrades most on cheap models; wrong fixes here corrupt data.
2. review-subsystem — the audit format is pure judgment; template exists to copy.
3. patch-one-tab — highest frequency judgment skill; protects the monolith.
4. evolve-notion-schema — irreversible-mistake territory (old records).
5. phase-big-feature — planning judgment; keeps main shippable.
6. verify-without-tests — the only safety net; checklist-izable.
7. polish-ui-loop — taste, partially encodable via granularity rules.
8. write-adr — template + rubric captures most of it.
9. sync-context-docs — low judgment, high compounding value.
10. ship-to-production — pure mechanics; any model can run it. Last, despite being the
    most frequent.
