#!/usr/bin/env node
import { build } from "esbuild";

await build({
  entryPoints: ["src/cli/beam-flow.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/cli/beam-flow.bundle.mjs",
});

console.log("Built: dist/cli/beam-flow.bundle.mjs");
