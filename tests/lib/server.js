// Spawns the repo's serve.js (root) on a dedicated test port so the suite
// never collides with a dev server the user has running on :3000, and
// waits for it to actually accept connections before handing back.
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const TEST_PORT = process.env.STS_TEST_PORT || 3177;
const ROOT = path.join(__dirname, '..', '..');

function poll(url, tries) {
  return new Promise((resolve, reject) => {
    const attempt = n => {
      http.get(url, res => { res.resume(); resolve(); })
        .on('error', () => {
          if (n <= 0) return reject(new Error('server never came up: ' + url));
          setTimeout(() => attempt(n - 1), 150);
        });
    };
    attempt(tries);
  });
}

async function startServer() {
  const proc = spawn(process.execPath, ['serve.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(TEST_PORT) }),
    stdio: 'ignore',
  });
  await poll('http://localhost:' + TEST_PORT + '/jewelry-workflow.html', 40);
  return {
    baseUrl: 'http://localhost:' + TEST_PORT + '/jewelry-workflow.html',
    stop: () => proc.kill(),
  };
}

module.exports = { startServer, TEST_PORT };
