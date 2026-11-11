#!/usr/bin/env node
// npm run build — writes site/index.html from src/app.html + content/course-data.json.
//
// content/course-data.json is the single source of truth for lessons, slide
// scripts and questions. The build validates it first and refuses to write
// the site if validation fails. The output is a single self-contained HTML
// file, so it still opens straight from disk (file://) with no server.
//
// Usage: node scripts/build.js [--check]
//   --check  don't write; exit 1 if site/index.html is out of date

"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TEMPLATE = path.join(ROOT, "src", "app.html");
const DATA = path.join(ROOT, "content", "course-data.json");
const OUT = path.join(ROOT, "site", "index.html");
const MARKER = "/*@@CONTENT@@*/";
const check = process.argv.includes("--check");

// 1. Validate the content.
const v = spawnSync(process.execPath, [path.join(__dirname, "validate.js"), DATA, "--quiet"], { encoding: "utf8" });
if (v.status !== 0) {
  process.stdout.write(v.stdout || "");
  process.stderr.write(v.stderr || "");
  console.error("Build stopped: content failed validation. Run `npm run validate` for details.");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(DATA, "utf8"));
const template = fs.readFileSync(TEMPLATE, "utf8");
if (template.split(MARKER).length !== 2) {
  console.error(`src/app.html must contain the marker ${MARKER} exactly once.`);
  process.exit(1);
}

// 2. Every diagram a slide names must exist in the app's DG object.
const dgBlock = template.slice(template.indexOf("const DG={"), template.indexOf("\n};", template.indexOf("const DG={")));
const diagrams = new Set([...dgBlock.matchAll(/^\s*([A-Za-z0-9_]+)\(\)\s*\{/gm)].map((m) => m[1]));
const figBlock = template.slice(template.indexOf("const FIG={"), template.indexOf("\n};", template.indexOf("const FIG={")));
const figures = new Set([...figBlock.matchAll(/^\s*([A-Za-z0-9_]+)\([^)]*\)\s*\{/gm)].map((m) => m[1]));
const missing = [];
for (const L of data.lessons)
  for (const s of L.slides)
    if (s.visual && s.visual.k === "dg" && !diagrams.has(s.visual.f)) missing.push(`${L.id}-${s.n}: "${s.visual.f}"`);
for (const L of data.lessons)
  for (const s of L.slides)
    if (s.visual && s.visual.fig && !figures.has(s.visual.fig)) missing.push(`${L.id}-${s.n}: figure "${s.visual.fig}"`);
if (missing.length) {
  console.error(`Build stopped: unknown diagram or figure name(s): ${missing.join(", ")}`);
  process.exit(1);
}

// 3. Embed only what the app uses (scripts keep their [+] and [pause] markers).
const content = {
  modules: data.modules,
  lessons: data.lessons.map((L) => ({
    id: L.id, module: L.module, title: L.title, status: L.status,
    slides: L.slides.map((s) => {
      const o = { heading: s.heading, visual: s.visual, script: s.script };
      if (s.video != null) o.video = s.video;
      return o;
    }),
  })),
  questions: data.questions.map((x) => {
    const o = { id: x.id, module: x.module, text: x.text, options: x.options, explanation: x.explanation };
    if (x.lessonTag != null) o.lessonTag = x.lessonTag;
    return o;
  }),
};
// Escape "<" so no string can close the <script> element; also escape line separators.
const LS = new RegExp(String.fromCharCode(0x2028), "g"), PS = new RegExp(String.fromCharCode(0x2029), "g");
const json = JSON.stringify(content).replace(/</g, "\\u003c").replace(LS, "\\u2028").replace(PS, "\\u2029");

const block =
  `const COURSE=${json};\n` +
  // Map the JSON to the shapes the app code uses. Question ids come from the
  // JSON, so saved progress (localStorage "oupv-v1") keeps matching.
  `const MODS=COURSE.modules;\n` +
  `const BANK=COURSE.questions.map(x=>({id:x.id,m:x.module,text:x.text,opts:x.options,exp:x.explanation,tag:x.lessonTag}));\n` +
  `const LESSONS=COURSE.lessons.map(l=>({id:l.id,m:l.module,t:l.title,status:l.status,slides:l.slides.map(s=>({h:s.heading,v:s.visual,vid:s.video,say:s.script}))}));`;

const html = template.replace(MARKER, () => block);

if (check) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (current !== html) {
    console.error("site/index.html is out of date. Run `npm run build`.");
    process.exit(1);
  }
  console.log("site/index.html is up to date.");
  process.exit(0);
}

fs.writeFileSync(OUT, html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`Built site/index.html (${kb} KB): ${data.lessons.length} lessons, ` +
  `${data.questions.length} questions, ${diagrams.size} diagrams and ${figures.size} figures available.`);
