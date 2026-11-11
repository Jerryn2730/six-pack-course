#!/usr/bin/env node
// npm run validate — checks content/course-data.json against the content
// conventions in CLAUDE.md and COURSE_MASTER.md Task 1.
// Errors make the run fail (exit 1). Warnings are reported but don't fail it.
//
// Usage: node scripts/validate.js [path/to/course-data.json] [--quiet] [--verify]
//   --quiet   print the summary only, not each problem
//   --verify  list every [VERIFY] flag (default: count per lesson)

"use strict";
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const file = args.find((a) => !a.startsWith("--")) ||
  path.join(__dirname, "..", "content", "course-data.json");

const t0 = Date.now();
const errors = [];
const warnings = [];
const err = (where, msg) => errors.push({ where, msg });
const warn = (where, msg) => warnings.push({ where, msg });

let data;
try {
  data = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (e) {
  console.error(`Cannot read ${file}: ${e.message}`);
  process.exit(2);
}

const STATUSES = ["draft-unverified", "fact-checked", "approved"];
const modules = data.modules || {};
const lessons = Array.isArray(data.lessons) ? data.lessons : [];
const questions = Array.isArray(data.questions) ? data.questions : [];
if (!lessons.length) err("file", "no lessons array");
if (!questions.length) err("file", "no questions array");

// Same sentence splitter and marker stripper as site/index.html (splitS, strip).
const strip = (t) =>
  t.replace(/\s*\[(\+|pause)\]\s*/g, " ").replace(/\s{2,}/g, " ").trim();

// Number of .rv-item elements the app renders for a visual (index.html slide renderer).
function revealable(v) {
  if (!v || typeof v !== "object") return null;
  switch (v.k) {
    case "points": return (v.items || []).length;
    case "callout": return (v.lines || []).length;
    case "script": return (v.lines || []).length;
    case "table": return (v.rows || []).length;
    case "lights": case "shapes": case "sounds": return (v.items || []).length;
    case "dg": case "formula": return 0;
    default: return null;
  }
}

// Every string in an object, for [VERIFY] and quote checks.
function strings(x, out = []) {
  if (typeof x === "string") out.push(x);
  else if (Array.isArray(x)) x.forEach((y) => strings(y, out));
  else if (x && typeof x === "object") Object.values(x).forEach((y) => strings(y, out));
  return out;
}

// Abbreviations with internal or trailing periods break sentence splitting (CLAUDE.md).
const ABBREV = /\b(?:a\.m|p\.m|e\.g|i\.e|etc|vs|Mr|Mrs|Dr|St|approx|Capt|Lt)\.(?=\s|$|[A-Za-z])/;

const verifyFlags = [];
const findVerify = (where, obj) =>
  strings(obj).forEach((s) => {
    const m = s.match(/\[VERIFY[^\]]*\]/g);
    if (m) m.forEach((f) => verifyFlags.push({ where, flag: f }));
  });

// ---------- Lessons and slides ----------
const lessonIds = new Map();
const slideIds = new Set();
let slideCount = 0;
let charCount = 0;

for (const [li, L] of lessons.entries()) {
  const lw = L.id || `lessons[${li}]`;
  if (!L.id) err(lw, "lesson has no id");
  else if (lessonIds.has(L.id)) err(lw, "duplicate lesson id");
  else lessonIds.set(L.id, L);
  if (!modules[L.module]) err(lw, `unknown module "${L.module}"`);
  if (!L.title) err(lw, "lesson has no title");
  if (!STATUSES.includes(L.status)) err(lw, `status "${L.status}" is not one of ${STATUSES.join(", ")}`);
  if (!Array.isArray(L.slides) || !L.slides.length) { err(lw, "lesson has no slides"); continue; }
  findVerify(lw, { title: L.title });

  L.slides.forEach((s, si) => {
    slideCount++;
    const n = si + 1;
    const sw = `${lw} slide ${n}`;
    const sid = `${L.id}-${s.n}`;
    if (s.n !== n) err(sw, `slide number is ${s.n}, expected ${n}`);
    if (slideIds.has(sid)) err(sw, `duplicate slide id ${sid}`);
    slideIds.add(sid);
    if (s.audioFile !== `${L.id}-${n}.mp3`) err(sw, `audioFile "${s.audioFile}" should be "${L.id}-${n}.mp3"`);
    if (!s.heading) err(sw, "slide has no heading");

    const say = typeof s.script === "string" ? s.script : "";
    if (!say.trim()) { err(sw, "empty script"); return; }
    charCount += strip(say).length;

    // [+] count must equal the revealable items, or be zero.
    const plus = (say.match(/\[\+\]/g) || []).length;
    const items = revealable(s.visual);
    if (items === null) err(sw, `unknown visual type "${s.visual && s.visual.k}"`);
    else if (plus !== 0 && plus !== items)
      err(sw, `${plus} [+] marker(s) but the ${s.visual.k} visual has ${items} revealable item(s); use ${items} or 0`);

    // Decimal numbers, "U.S." and other dotted abbreviations break sentence splitting.
    const dec = say.match(/\d+\.\d+/g);
    if (dec) err(sw, `decimal number(s) in script: ${[...new Set(dec)].join(", ")} (write them as words)`);
    if (/\bU\.S\./.test(say)) err(sw, `"U.S." in script (say "American" or "United States")`);
    const ab = say.match(ABBREV);
    if (ab) err(sw, `abbreviation with a period in script: "${ab[0]}"`);
    const digits = say.match(/\d+/g);
    if (digits && !dec) warn(sw, `digits in script: ${[...new Set(digits)].slice(0, 5).join(", ")} (numbers should be words)`);

    // Brackets: only [+] and [pause] are markers; every bracket must balance.
    const bad = say.match(/\[(?!\+\]|pause\])[^\]]*\]?/g);
    if (bad) err(sw, `unknown or malformed marker(s): ${bad.join(" ")}`);
    for (const [o, c] of [["[", "]"], ["(", ")"], ["“", "”"]]) {
      const a = say.split(o).length - 1, b = say.split(c).length - 1;
      if (a !== b) err(sw, `unbalanced ${o}${c} in script (${a} open, ${b} close)`);
    }

    // The exported "spoken" text should match the script with markers removed.
    if (typeof s.spoken === "string" && s.spoken !== strip(say))
      warn(sw, `"spoken" text differs from the script with markers removed (re-export the snapshot)`);

    // Straight quotes in learner-facing text (typographic quotes are the convention).
    // Figure specs may hold SVG markup, which needs straight quotes; check their visible labels only.
    const vis = Object.assign({}, s.visual, { fig: s.visual && s.visual.fig && typeof s.visual.fig === "object" && Array.isArray(s.visual.fig.els) ? s.visual.fig.els.filter((e) => e[0] !== "raw") : s.visual && s.visual.fig });
    const straight = strings({ h: s.heading, v: vis, say }).filter((x) => /['"]/.test(x));
    if (straight.length) warn(sw, `straight quote(s) in: “${straight[0].slice(0, 60)}”`);

    findVerify(sw, { h: s.heading, v: s.visual, say });
  });
}

// ---------- Questions ----------
const questionIds = new Set();
const perLessonQ = new Map();
for (const [qi, Q] of questions.entries()) {
  const qw = `question ${Q.id || `[${qi}]`}`;
  if (!Q.id) err(qw, "question has no id");
  else if (questionIds.has(Q.id)) err(qw, "duplicate question id");
  else questionIds.add(Q.id);
  if (!modules[Q.module]) err(qw, `unknown module "${Q.module}"`);
  if (!Q.text || !String(Q.text).trim()) err(qw, "empty question text");
  const opts = Array.isArray(Q.options) ? Q.options : [];
  if (opts.length < 2 || opts.length > 4) err(qw, `has ${opts.length} options; needs 2 to 4`);
  if (opts.some((o) => typeof o !== "string" || !o.trim())) err(qw, "has an empty option");
  const norm = opts.map((o) => String(o).trim().toLowerCase());
  const dup = norm.filter((o, i) => norm.indexOf(o) !== i);
  if (dup.length) err(qw, `identical options: "${dup[0]}"`);
  if (Q.correctIndex !== 0) err(qw, `correctIndex is ${Q.correctIndex}; the correct answer must be options[0]`);
  if (!Q.explanation || !String(Q.explanation).trim()) err(qw, "no explanation");
  if (Q.lessonTag != null) {
    const L = lessonIds.get(Q.lessonTag);
    if (!L) err(qw, `lesson tag "${Q.lessonTag}" doesn't match any lesson`);
    else {
      if (L.module !== Q.module) warn(qw, `module ${Q.module} but tagged to ${L.id} (module ${L.module})`);
      perLessonQ.set(L.id, (perLessonQ.get(L.id) || 0) + 1);
    }
  }
  if (Q.status && !STATUSES.includes(Q.status)) err(qw, `status "${Q.status}" is not one of ${STATUSES.join(", ")}`);
  const straight = strings({ t: Q.text, o: opts, e: Q.explanation }).filter((x) => /['"]/.test(x));
  if (straight.length) warn(qw, `straight quote(s) in: “${straight[0].slice(0, 60)}”`);
  findVerify(qw, { t: Q.text, o: opts, e: Q.explanation });
}
for (const L of lessons) {
  const n = perLessonQ.get(L.id) || 0;
  if (n < 7 || n > 10) warn(L.id, `${n} lesson-check question(s); the app design is 7 to 10`);
}

// ---------- Report ----------
const quiet = flags.has("--quiet");
const keyOf = (w) => (w.startsWith("question ") ? "questions" : w.split(" ")[0]);
const print = (title, list) => {
  if (!list.length || quiet) return;
  console.log(`\n${title} (${list.length})`);
  const m = new Map();
  for (const p of list) {
    const k = keyOf(p.where);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(p);
  }
  for (const [k, ps] of m) {
    console.log(`  ${k}`);
    for (const p of ps) {
      const sub = p.where === k ? "" : (k === "questions" ? p.where.slice(9) : p.where.slice(k.length + 1)) + ": ";
      console.log(`    - ${sub}${p.msg}`);
    }
  }
};

console.log(`Validating ${path.relative(process.cwd(), file) || file}`);
console.log(`Snapshot: schema ${data.schemaVersion}, exported ${data.exported}`);
print("ERRORS", errors);
print("WARNINGS", warnings);

console.log("\nLesson status");
const byStatus = {};
for (const L of lessons) (byStatus[L.status] = byStatus[L.status] || []).push(L.id);
for (const s of STATUSES) console.log(`  ${s.padEnd(17)} ${(byStatus[s] || []).length}`);
const qStatus = {};
for (const Q of questions) qStatus[Q.status] = (qStatus[Q.status] || 0) + 1;
console.log(`  questions: ${Object.entries(qStatus).map(([k, v]) => `${v} ${k}`).join(", ")}`);

console.log(`\n[VERIFY] flags: ${verifyFlags.length}`);
if (flags.has("--verify")) verifyFlags.forEach((f) => console.log(`  ${f.where}: ${f.flag}`));
else if (verifyFlags.length) {
  const c = {};
  verifyFlags.forEach((f) => { const k = keyOf(f.where); c[k] = (c[k] || 0) + 1; });
  console.log("  " + Object.entries(c).map(([k, v]) => `${k} ${v}`).join(", ") + "  (use --verify to list)");
}

const secs = ((Date.now() - t0) / 1000).toFixed(2);
console.log(`\nSummary: ${lessons.length} lessons, ${slideCount} slides, ${questions.length} questions, ` +
  `${charCount.toLocaleString("en-US")} narration characters`);
console.log(`${errors.length} error(s), ${warnings.length} warning(s) in ${secs} s`);
console.log(errors.length ? "FAIL" : "PASS");
process.exit(errors.length ? 1 : 0);
