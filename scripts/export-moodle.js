#!/usr/bin/env node
// npm run export:moodle — writes media/export/questions.gift, the question bank in Moodle's GIFT format.
// Only useful if someone gives you access to a free Moodle site; the course itself doesn't need it.
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const data = JSON.parse(fs.readFileSync(path.join(root, "content", "course-data.json"), "utf8"));
const esc = (s) => String(s).replace(/[~=#{}:\\]/g, (c) => "\\" + c).replace(/\n/g, " ");
let out = "// Six-Pack Prep question bank. Practice material, not official Coast Guard questions.\n";
let cat = null;
for (const q of data.questions) {
  const c = `$CATEGORY: Six-Pack Prep/${data.modules[q.module].name}${q.lessonTag ? "/" + q.lessonTag : ""}`;
  if (c !== cat) { out += `\n${c}\n\n`; cat = c; }
  out += `::${q.id}::${esc(q.text)} {\n` +
    q.options.map((o, i) => `\t${i === q.correctIndex ? "=" : "~"}${esc(o)}`).join("\n") +
    `\n\t####${esc(q.explanation)}\n}\n\n`;
}
const dir = path.join(root, "media", "export");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "questions.gift"), out);
console.log(`Wrote media/export/questions.gift (${data.questions.length} questions).`);
