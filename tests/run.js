// ════════════════════════════════════════════
//  SMOKE SUITE RUNNER  —  tests/run.js
//  Runs every suite in this folder against one shared local server and
//  reports a combined pass/fail. See tests/README.md before running.
// ════════════════════════════════════════════
const { startServer } = require('./lib/server');
const fingerprint = require('./fingerprint');
const offlineStorage = require('./offline-storage');
const estimateCalc = require('./estimate-calc');

async function main() {
  const server = await startServer();
  console.log('Test server up at ' + server.baseUrl + '\n');

  let overallPass = true;

  // Pure math suite — no server/browser needed, run it first so a broken
  // calculator fails fast before the slower headless suites spin up.
  console.log('── Estimate-calc suite ────────────────────');
  const ec = await estimateCalc.run();
  console.log(ec.lines.join('\n'));
  overallPass = overallPass && ec.pass;

  console.log('\n── Fingerprint suite ──────────────────────');
  const fp = await fingerprint.run({ baseUrl: server.baseUrl });
  console.log(fp.lines.join('\n'));
  overallPass = overallPass && fp.pass;

  console.log('\n── Offline / storage suite ────────────────');
  const os = await offlineStorage.run({ baseUrl: server.baseUrl });
  console.log(os.lines.join('\n'));
  overallPass = overallPass && os.pass;

  server.stop();

  console.log('\n════════════════════════════════════════════');
  console.log(overallPass ? 'ALL SUITES PASSED' : 'SUITES FAILED — see DIFF/FAIL lines above');
  process.exit(overallPass ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
