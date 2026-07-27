// ════════════════════════════════════════════
//  SMOKE SUITE RUNNER  —  tests/run.js
//  Runs every suite in this folder against one shared local server and
//  reports a combined pass/fail. See tests/README.md before running.
// ════════════════════════════════════════════
const { startServer } = require('./lib/server');
const fingerprint = require('./fingerprint');
const offlineStorage = require('./offline-storage');
const intakeAiNotes = require('./intake-ai-notes');
const themeAudit = require('./theme-audit');
const intakePhone = require('./intake-phone');

async function main() {
  const server = await startServer();
  console.log('Test server up at ' + server.baseUrl + '\n');

  let overallPass = true;

  console.log('── Fingerprint suite ──────────────────────');
  const fp = await fingerprint.run({ baseUrl: server.baseUrl });
  console.log(fp.lines.join('\n'));
  overallPass = overallPass && fp.pass;

  console.log('\n── Offline / storage suite ────────────────');
  const os = await offlineStorage.run({ baseUrl: server.baseUrl });
  console.log(os.lines.join('\n'));
  overallPass = overallPass && os.pass;

  console.log('\n── Theme audit ────────────────────────────');
  const th = await themeAudit.run({ baseUrl: server.baseUrl });
  console.log(th.lines.join('\n'));
  overallPass = overallPass && th.pass;

  console.log('\n── Intake AI note taker suite ─────────────');
  const ai = await intakeAiNotes.run({ baseUrl: server.baseUrl });
  console.log(ai.lines.join('\n'));
  overallPass = overallPass && ai.pass;

  console.log('\n── Customer phone handoff suite ───────────');
  const ph = await intakePhone.run({ baseUrl: server.baseUrl });
  console.log(ph.lines.join('\n'));
  overallPass = overallPass && ph.pass;

  server.stop();

  console.log('\n════════════════════════════════════════════');
  console.log(overallPass ? 'ALL SUITES PASSED' : 'SUITES FAILED — see DIFF/FAIL lines above');
  process.exit(overallPass ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
