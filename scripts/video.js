#!/usr/bin/env node
// npm run video -- --lesson rules-01 | --module R | --all   [--no-captions] [--force]
//
// Turns narrated lessons into MP4s (COURSE_MASTER.md Task 3). Deterministic, not a screen recording:
//   1. the app's render mode (site/index.html?render=1#render-<lesson>-<slide>-<builds>) draws one slide state
//      at 1920x1080; Playwright screenshots each state once;
//   2. each slide's timing.json (written by `npm run audio`) says when every build appears;
//   3. FFmpeg makes one segment per slide (stills with durations + the slide's MP3 + 1 s of silence),
//      then joins the segments without re-encoding.
// Output: media/video/<lesson>.mp4 and .chapters.txt (YouTube chapter list), media/captions/<lesson>.vtt and .srt.
// Lessons whose inputs haven't changed are skipped. Everything used is free: Playwright (Apache-2.0), FFmpeg.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const site = path.join(root, "site");
const audioDir = path.join(site, "audio");
const outDir = path.join(root, "media", "video");
const capDir = path.join(root, "media", "captions");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : null);
const TAIL = 1.0, CARD = 3.0, FPS = 30;

const data = JSON.parse(fs.readFileSync(path.join(root, "content", "course-data.json"), "utf8"));
let lessons = data.lessons;
if (val("--lesson")) lessons = lessons.filter((l) => l.id === val("--lesson"));
else if (val("--module")) lessons = lessons.filter((l) => l.module === val("--module"));
else if (!flag("--all")) { console.error("Say which lessons: --lesson <id>, --module <R|N|D|P> or --all"); process.exit(1); }
if (!lessons.length) { console.error("No matching lessons."); process.exit(1); }

function ff(a, what) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...a], { encoding: "utf8" });
  if (r.status !== 0) { console.error(`FFmpeg failed (${what}):\n${r.stderr}`); process.exit(1); }
}
const stamp = (t, sep) => {
  const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(ms % 1000).padStart(3, "0")}`;
};
const chap = (t) => { const s = Math.floor(t); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

(async () => {
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch (e) { console.error("Playwright isn't installed. Run: npm install --no-save playwright && npx playwright install chromium"); process.exit(1); }
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(capDir, { recursive: true });
  const appHash = crypto.createHash("sha1").update(fs.readFileSync(path.join(site, "index.html"))).digest("hex");
  let browser = null, page = null, made = 0, skipped = 0, missing = 0;

  for (const L of lessons) {
    // Inputs: every slide needs its MP3 and timing file.
    const T = [];
    let ok = true;
    for (const s of L.slides) {
      const mp3 = path.join(audioDir, `${L.id}-${s.n}.mp3`), tj = path.join(audioDir, `${L.id}-${s.n}.timing.json`);
      if (!fs.existsSync(mp3) || !fs.existsSync(tj)) { ok = false; break; }
      T.push({ mp3, t: JSON.parse(fs.readFileSync(tj, "utf8")) });
    }
    if (!ok) { console.log(`${L.id}: no narration yet (run npm run audio -- --lesson ${L.id}); skipped`); missing++; continue; }
    const h = crypto.createHash("sha1").update(appHash).update(String(!flag("--no-captions")));
    T.forEach((x) => h.update(fs.readFileSync(x.mp3)));
    const hash = h.digest("hex"), meta = path.join(outDir, `${L.id}.json`), mp4 = path.join(outDir, `${L.id}.mp4`);
    if (!flag("--force") && fs.existsSync(mp4) && fs.existsSync(meta) && JSON.parse(fs.readFileSync(meta, "utf8")).hash === hash) { skipped++; continue; }

    if (!browser) {
      browser = await chromium.launch();
      page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: "light" });
      await page.goto("file://" + path.join(site, "index.html") + "?render=1#render-wait");
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `video-${L.id}-`));
    const shot = async (spec, file) => {
      await page.evaluate((s) => { location.hash = "render-" + s; }, spec);
      await page.waitForFunction((s) => document.body.dataset.frame === s, spec);
      await page.screenshot({ path: file });
    };
    const segs = [], cues = [], chapters = [];
    let clock = 0;
    const card = async (kind) => {
      const png = path.join(tmp, `${kind}.png`), seg = path.join(tmp, `${kind}.mp4`);
      await shot(`card-${kind}-${L.id}`, png);
      ff(["-loop", "1", "-framerate", String(FPS), "-t", String(CARD), "-i", png, "-f", "lavfi", "-t", String(CARD), "-i", "anullsrc=r=44100:cl=mono",
        "-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", String(FPS), "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "1", "-shortest", seg], kind);
      segs.push(seg); clock += CARD;
    };
    chapters.push([0, "Introduction"]);
    await card("intro");
    for (let i = 0; i < L.slides.length; i++) {
      const s = L.slides[i], t = T[i].t, dur = t.duration + TAIL;
      // Build states: (number of items revealed, start time).
      const states = [{ k: t.sentences.length ? t.sentences[0].builds : 0, at: 0 }];
      for (const q of t.sentences) if (q.builds !== states[states.length - 1].k) states.push({ k: q.builds, at: q.start });
      let list = "";
      for (let j = 0; j < states.length; j++) {
        const png = path.join(tmp, `${s.n}-${j}.png`);
        await shot(`${L.id}-${s.n}-${states[j].k}`, png);
        const d = (j + 1 < states.length ? states[j + 1].at : dur) - states[j].at;
        list += `file '${png}'\nduration ${d.toFixed(3)}\n`;
        if (j === states.length - 1) list += `file '${png}'\n`;
      }
      const lf = path.join(tmp, `${s.n}.txt`), seg = path.join(tmp, `${s.n}.mp4`);
      fs.writeFileSync(lf, list);
      ff(["-f", "concat", "-safe", "0", "-i", lf, "-i", T[i].mp3, "-af", `apad=pad_dur=${TAIL}`, "-t", dur.toFixed(3),
        "-vf", `fps=${FPS},format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "1", seg], `${L.id}-${s.n}`);
      segs.push(seg);
      chapters.push([clock, s.heading]);
      for (const q of t.sentences) cues.push([clock + q.speechStart, clock + q.end, q.text]);
      clock += dur;
    }
    await card("outro");
    const cf = path.join(tmp, "all.txt");
    fs.writeFileSync(cf, segs.map((f) => `file '${f}'`).join("\n") + "\n");
    ff(["-f", "concat", "-safe", "0", "-i", cf, "-c", "copy", "-movflags", "+faststart", mp4], `${L.id} join`);
    fs.writeFileSync(path.join(outDir, `${L.id}.chapters.txt`), chapters.map(([t, n]) => `${chap(t)} ${n}`).join("\n") + "\n");
    if (!flag("--no-captions")) {
      fs.writeFileSync(path.join(capDir, `${L.id}.vtt`), "WEBVTT\n\n" + cues.map(([a, b, x], i) => `${i + 1}\n${stamp(a, ".")} --> ${stamp(b, ".")}\n${x}\n`).join("\n"));
      fs.writeFileSync(path.join(capDir, `${L.id}.srt`), cues.map(([a, b, x], i) => `${i + 1}\n${stamp(a, ",")} --> ${stamp(b, ",")}\n${x}\n`).join("\n"));
    }
    fs.writeFileSync(meta, JSON.stringify({ lesson: L.id, title: L.title, hash, seconds: Math.round(clock), made: new Date().toISOString() }, null, 2) + "\n");
    fs.rmSync(tmp, { recursive: true, force: true });
    made++;
    console.log(`${L.id}: ${chap(clock)} → media/video/${L.id}.mp4`);
  }
  if (browser) await browser.close();
  console.log(`Done: ${made} made, ${skipped} unchanged, ${missing} without narration. Cost: none.`);
})();
