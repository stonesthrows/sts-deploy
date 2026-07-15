import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node environment: Pages Functions run on the Workers runtime, but the
    // Web APIs they use (Request/Response/Headers/URL/crypto.subtle/btoa)
    // are all available in Node 18+, so plain node keeps the setup light.
    environment: 'node',
    include: ['test/**/*.test.mjs'],
  },
});
