#!/usr/bin/env node
// npm run audio -- [flags]  → runs scripts/narrate.py with the project's Python environment (.venv).
// First time on a new computer: npm run audio:setup   (see README, "Narration").
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const py = [
  path.join(root, ".venv", "bin", "python"),
  path.join(root, ".venv", "Scripts", "python.exe"),
].find((p) => fs.existsSync(p));
if (!py) {
  console.error("No Python environment for narration yet. Run: npm run audio:setup");
  process.exit(1);
}
const r = spawnSync(py, [path.join(__dirname, "narrate.py"), ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status === null ? 1 : r.status);
