#!/usr/bin/env node
// npm run audio:setup — one-time install of the free local narration engine (Kokoro-82M).
// Creates .venv with Python 3.10–3.12 (Kokoro doesn't support 3.13 yet) and installs
// requirements-narration.txt. Needs espeak-ng installed separately (see README).
// Nothing here costs money; the model weights (~330 MB) download once on first use.
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const venv = path.join(root, ".venv");
const run = (cmd, args) => spawnSync(cmd, args, { stdio: "inherit", cwd: root }).status === 0;
const ok = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: "utf8" }); return r.status === 0 ? (r.stdout + r.stderr).trim() : null; };

const espeak = ok("espeak-ng", ["--version"]);
console.log(espeak ? `espeak-ng found: ${espeak.split("\n")[0]}` :
  "WARNING: espeak-ng not found. Install it (macOS: brew install espeak-ng; Ubuntu: sudo apt install espeak-ng; Windows: the .msi from github.com/espeak-ng/espeak-ng/releases).");

if (!fs.existsSync(venv)) {
  const candidates = process.platform === "win32"
    ? [["py", ["-3.12"]], ["py", ["-3.11"]], ["py", ["-3.10"]]]
    : [["python3.12", []], ["python3.11", []], ["python3.10", []], ["python3", []]];
  const found = candidates.find(([c, a]) => { const v = ok(c, [...a, "--version"]); return v && /Python 3\.1[0-2]\./.test(v); });
  if (!found) { console.error("Need Python 3.10, 3.11 or 3.12 (free from python.org). Kokoro doesn't support 3.13 yet."); process.exit(1); }
  console.log(`Creating .venv with ${found[0]} ${found[1].join(" ")}`);
  if (!run(found[0], [...found[1], "-m", "venv", venv])) process.exit(1);
}
const py = [path.join(venv, "bin", "python"), path.join(venv, "Scripts", "python.exe")].find((p) => fs.existsSync(p));
// CPU-only PyTorch is much smaller than the default build and is all Kokoro needs.
if (!run(py, ["-m", "pip", "install", "--upgrade", "pip"])) process.exit(1);
if (process.platform !== "darwin" && !run(py, ["-m", "pip", "install", "torch", "--index-url", "https://download.pytorch.org/whl/cpu"])) process.exit(1);
if (!run(py, ["-m", "pip", "install", "-r", path.join(root, "requirements-narration.txt")])) process.exit(1);
console.log("\nNarration engine installed. Try: npm run audio -- --slide rules-01-1 --dry-run");
