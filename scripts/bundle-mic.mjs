import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["web/mic/browser.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: "web/play/mic-engine.js",
  legalComments: "none",
  // Filesystem helpers are dynamic and only run during Node replay.
  external: [
    "node:fs/promises",
    "node:path",
    "node:perf_hooks",
    "node:child_process",
    "node:os",
    "node:util",
  ],
});
