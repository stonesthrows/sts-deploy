// Resolve a Chromium/Chrome executable for playwright-core (which bundles no
// browser). The suite was authored in a Linux sandbox with a fixed path; on
// other machines (e.g. Kyle's Windows box) fall back to an installed
// Chrome/Edge. Override with CHROMIUM_PATH env when neither guess fits.
const fs = require('fs');

module.exports = function resolveChromiumPath() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/opt/pw-browsers/chromium',                                          // Linux sandbox
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',         // Windows Chrome
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',  // Windows Edge
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  const found = candidates.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!found) {
    throw new Error('No Chromium/Chrome/Edge executable found — set CHROMIUM_PATH to a browser binary');
  }
  return found;
};
