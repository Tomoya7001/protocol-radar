import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // opentimestamps ships a broken "main" (open-timestamps.js does not exist; Node falls back
      // to index.js with a deprecation warning, but Vite's stricter resolver errors). Point the
      // bundler straight at the real CommonJS entry so the F6 timestamp tests can import it.
      opentimestamps: fileURLToPath(
        new URL("./node_modules/opentimestamps/index.js", import.meta.url),
      ),
    },
  },
  test: {
    // Node environment by default; foundation (db/ledger/fetch/diff/worker) is server-side.
    // UI component tests (added later by the webapi implementer) can opt into jsdom via
    // an in-file // @vitest-environment jsdom pragma.
    environment: "node",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
