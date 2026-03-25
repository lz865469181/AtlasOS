#!/usr/bin/env node
import { build } from "esbuild";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";

// Step 1: esbuild bundle (TypeScript → single ESM file)
await build({
  entryPoints: ["src/cli/beam-flow.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/cli/beam-flow.bundle.mjs",
});
console.log("Built: dist/cli/beam-flow.bundle.mjs");

// Step 2: Standalone binaries via bun build --compile
// Usage:
//   node scripts/build-cli.mjs --bin              Build all platforms
//   node scripts/build-cli.mjs --bin --native      Build native platform only
//   node scripts/build-cli.mjs --bin --target=bun-linux-x64  Build specific target
if (process.argv.includes("--bin")) {
  const allTargets = [
    { target: "bun-linux-x64",    out: "beam-flow-linux-x64" },
    { target: "bun-linux-arm64",  out: "beam-flow-linux-arm64" },
    { target: "bun-darwin-x64",   out: "beam-flow-macos-x64" },
    { target: "bun-darwin-arm64", out: "beam-flow-macos-arm64" },
    { target: "bun-windows-x64",  out: "beam-flow-windows-x64.exe" },
  ];

  // Determine which targets to build
  let targets;
  const specificTarget = process.argv.find((a) => a.startsWith("--target="));
  if (process.argv.includes("--native")) {
    // Native only: no --target flag, bun compiles for current platform
    const plat = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    targets = allTargets.filter((t) => t.target.includes(plat) && t.target.includes(arch));
  } else if (specificTarget) {
    const tv = specificTarget.split("=")[1];
    targets = allTargets.filter((t) => t.target === tv);
    if (!targets.length) {
      console.error(`Unknown target: ${tv}`);
      console.error(`Available: ${allTargets.map((t) => t.target).join(", ")}`);
      process.exit(1);
    }
  } else {
    targets = allTargets;
  }

  mkdirSync("dist/cli/bin", { recursive: true });

  const failed = [];
  for (const { target, out } of targets) {
    const outfile = `dist/cli/bin/${out}`;
    console.log(`\nCompiling ${target} → ${outfile} ...`);
    try {
      execSync(
        `bun build --compile --minify --target ${target} dist/cli/beam-flow.bundle.mjs --outfile ${outfile}`,
        { stdio: "inherit", shell: true }
      );
    } catch {
      console.error(`  FAILED: ${target} (cross-compile may require bun >= 1.1.x and network access)`);
      failed.push(target);
    }
  }

  const built = targets.length - failed.length;
  console.log(`\n${built}/${targets.length} binaries built in dist/cli/bin/`);
  if (failed.length) {
    console.log(`Failed: ${failed.join(", ")}`);
    console.log("Tip: use --native to build for current platform only");
  }
}
