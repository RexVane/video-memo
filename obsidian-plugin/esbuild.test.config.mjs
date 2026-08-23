// Bundles tests/*.test.ts into test-dist/*.test.cjs so `node --test` can run
// them with no extra test runner. The `obsidian` and `electron` imports are
// aliased to local mocks (tests/mocks/), and node built-ins like node:sqlite
// resolve to the real runtime module.
import esbuild from "esbuild";

await esbuild.build({
  entryPoints: [
    "tests/ccswitch.test.ts",
    "tests/settings.test.ts",
    "tests/settings-tab.test.ts",
    "tests/ccswitch-ui.test.ts",
    "tests/source-modal.test.ts",
    "tests/run-progress.test.ts",
  ],
  bundle: true,
  outdir: "test-dist",
  format: "cjs",
  platform: "node",
  target: "node22",
  alias: {
    obsidian: "./tests/mocks/obsidian.ts",
    electron: "./tests/mocks/electron.ts",
  },
  // jsdom resolves asset files relative to its own package at runtime, so it
  // must stay a real module instead of being inlined into the bundle.
  external: ["jsdom"],
  logLevel: "info",
  outExtension: { ".js": ".cjs" },
});
