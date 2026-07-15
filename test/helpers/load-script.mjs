// Loads a browser-global script (js/*.js — plain <script> files with no
// exports) into an isolated vm context and hands back the named top-level
// bindings, so tests can call them without modifying the production files.
//
//   const { normalizeOrder } = loadGlobalScript('js/order-normalize.js',
//     ['normalizeOrder']);
//
// `const`/`let` declarations never land on the context's global object, so
// the names are captured by appending an object-literal expression that
// evaluates in the same script scope.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');

export function loadGlobalScript(relPath, names, extraGlobals = {}) {
  const code = readFileSync(resolve(ROOT, relPath), 'utf8');
  const context = vm.createContext({ console, ...extraGlobals });
  const extract = `\n;({ ${names.join(', ')} });`;
  return vm.runInContext(code + extract, context, { filename: relPath });
}

export function readSource(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8');
}
