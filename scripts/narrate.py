#!/usr/bin/env python3
"""Generate slide narration with Kokoro-82M, locally and at no cost (COURSE_MASTER.md Task 2).

For each slide in content/course-data.json:
  media/narration/{lessonId}-{n}.mp3          mono, 44.1 kHz, 96 kbps (config/voice.json)
  media/narration/{lessonId}-{n}.timing.json  per-sentence start/end and the builds each triggers
  media/captions/{lessonId}-{n}.vtt           captions from the same timings
and copies the MP3 and timing file to site/audio/.

The script is split into sentences exactly as the app does (splitS in src/app.html).
Each sentence is synthesized on its own, so timings are exact without an alignment
service. [+] markers are removed (they become build times); [pause] becomes silence
before the sentence, as in the app's browser-speech mode.

Unchanged slides are skipped: media/narration/manifest.json stores a hash of the
prepared sentences + voice settings + engine versions.

Run through npm:  npm run audio -- --pilot   (see --help)
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "content" / "course-data.json"
VOICE_CFG = ROOT / "config" / "voice.json"
DICT = ROOT / "QA" / "pronunciation_dictionary.md"
NARR = ROOT / "media" / "narration"
CAPS = ROOT / "media" / "captions"
AUDITION = ROOT / "media" / "auditions"
SITE_AUDIO = ROOT / "site" / "audio"
MANIFEST = NARR / "manifest.json"
PIPELINE_VERSION = 1  # bump to force regeneration after changing how audio is assembled
KOKORO_RATE = 24000
PILOT = ["rules-01", "rules-02", "rules-03"]
DEFAULT_CHARS_PER_SEC = 25.0  # used for --dry-run estimates until a real run measures this machine

# ---------- Text preparation (mirrors src/app.html) ----------
SENT_RE = re.compile(r'[^.!?]+(?:[.!?]+[”’"]?|$)')


def split_s(t):
    """Same as splitS() in the app."""
    parts = [m.group(0).strip() for m in SENT_RE.finditer(t)]
    parts = [p for p in parts if p]
    return parts or [t]


def strip_markers(t):
    """Same as strip() in the app."""
    t = re.sub(r"\s*\[(\+|pause)\]\s*", " ", t)
    return re.sub(r"\s{2,}", " ", t).strip()


SYMBOLS = [("°", " degrees"), ("×", " times "), ("÷", " divided by "), ("√", " the square root of ")]


def load_dictionary():
    """Rows from QA/pronunciation_dictionary.md -> list of (term, kind, value)."""
    rows = []
    if not DICT.exists():
        return rows
    for line in DICT.read_text(encoding="utf8").splitlines():
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 3 or cells[0] in ("Term", "") or set(cells[0]) <= set("-: "):
            continue
        terms, value = cells[0], cells[2]
        if not value:
            continue
        kind = "ipa" if value.startswith("/") and value.endswith("/") and len(value) > 2 else "text"
        for term in [x.strip() for x in terms.split(",") if x.strip()]:
            rows.append((term, kind, value))
    return rows


def make_applier(rows):
    if not rows:
        return lambda s: s
    by_term = {t: (k, v) for t, k, v in rows}
    alt = "|".join(re.escape(t) for t in sorted(by_term, key=len, reverse=True))
    rx = re.compile(r"(?<![\w’'])(" + alt + r")(?![\w’'])")

    def sub(m):
        kind, value = by_term[m.group(1)]
        return f"[{m.group(1)}]({value})" if kind == "ipa" else value

    return lambda s: rx.sub(sub, s)


def prepare(script, apply_dict):
    """Script -> list of sentences ready to synthesize, plus display text and marker counts."""
    out = []
    for raw in split_s(script):
        shown = strip_markers(raw)
        text = shown
        for a, b in SYMBOLS:
            text = text.replace(a, b)
        text = re.sub(r"\s{2,}", " ", apply_dict(text)).strip()
        out.append({
            "raw": raw,
            "display": shown,
            "tts": text,
            "builds": raw.count("[+]"),
            "pause": "[pause]" in raw,
        })
    return out


# ---------- Settings, hashing, manifest ----------
def load_cfg():
    cfg = json.loads(VOICE_CFG.read_text(encoding="utf8"))
    return cfg


def engine_versions():
    from importlib.metadata import version, PackageNotFoundError
    v = {}
    for pkg in ("kokoro", "misaki"):
        try:
            v[pkg] = version(pkg)
        except PackageNotFoundError:
            v[pkg] = None
    return v


HASH_KEYS = ("model", "langCode", "voice", "speed", "pauseMs", "sentenceGapMs", "leadInMs", "tailMs", "sampleRate", "bitrate",
             "loudnessLUFS", "truePeakDb")


def slide_hash(sentences, cfg, versions):
    payload = {
        "v": PIPELINE_VERSION,
        "engine": versions,
        "cfg": {k: cfg.get(k) for k in HASH_KEYS},
        "s": [[s["tts"], s["builds"], s["pause"], s["display"]] for s in sentences],
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def load_manifest():
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text(encoding="utf8"))
    return {"slides": {}, "stats": {}}


def save_manifest(m):
    MANIFEST.write_text(json.dumps(m, indent=1, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf8")


# ---------- Engine ----------
class Engine:
    def __init__(self, cfg):
        self.cfg = cfg
        self.pipe = None

    def _ensure_offline_if_cached(self, voices):
        """Use only the local cache when everything is already downloaded (no network calls)."""
        try:
            from huggingface_hub import try_to_load_from_cache
        except ImportError:
            return
        repo = self.cfg["model"]
        need = ["config.json", "kokoro-v1_0.pth"] + [f"voices/{v}.pt" for v in voices]
        if all(isinstance(try_to_load_from_cache(repo, f), str) for f in need):
            os.environ["HF_HUB_OFFLINE"] = "1"
        else:
            print("First run for this model or voice: downloading it once from Hugging Face…", flush=True)

    def load(self, voices):
        self._ensure_offline_if_cached(voices)
        warnings.filterwarnings("ignore")
        from kokoro import KPipeline
        self.pipe = KPipeline(lang_code=self.cfg["langCode"], repo_id=self.cfg["model"])

    def synth(self, text, voice, speed):
        import numpy as np
        chunks = []
        for _, _, audio in self.pipe(text, voice=voice, speed=speed):
            if audio is None:
                continue
            chunks.append(audio.numpy() if hasattr(audio, "numpy") else np.asarray(audio))
        return np.concatenate(chunks) if chunks else np.zeros(0, dtype="float32")

    def phonemes(self, text):
        return " | ".join(ps for _, ps, _ in self.pipe(text, voice=self.cfg["voice"], model=False))


# ---------- Assembly ----------
def silence(ms):
    import numpy as np
    return np.zeros(int(KOKORO_RATE * ms / 1000), dtype="float32")


def render_slide(engine, sentences, voice, speed, cfg):
    """Returns (audio float32 @24 kHz, timing list)."""
    import numpy as np
    parts = [silence(cfg.get("leadInMs", 0))]
    t = len(parts[0]) / KOKORO_RATE
    timing = []
    for i, s in enumerate(sentences):
        start = t
        if s["pause"]:
            parts.append(silence(cfg["pauseMs"]))
            t += cfg["pauseMs"] / 1000
        speech_start = t
        a = engine.synth(s["tts"], voice, speed) if s["tts"] else np.zeros(0, dtype="float32")
        parts.append(a)
        t += len(a) / KOKORO_RATE
        timing.append({"i": i, "start": round(start, 3), "speechStart": round(speech_start, 3),
                       "end": round(t, 3), "builds": s["builds"], "text": s["display"]})
        gap = cfg.get("tailMs", 0) if i == len(sentences) - 1 else cfg["sentenceGapMs"]
        parts.append(silence(gap))
        t += gap / 1000
    return np.concatenate(parts), timing


def loudnorm_filter(wav, cfg):
    """Two-pass EBU R128 loudness normalization in linear mode (one constant gain, no compression)."""
    target, tp = cfg.get("loudnessLUFS", -16), cfg.get("truePeakDb", -1.5)
    base = f"loudnorm=I={target}:TP={tp}:LRA=11"
    r = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-i", str(wav), "-af", base + ":print_format=json",
                        "-f", "null", "-"], capture_output=True, text=True)
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", r.stderr)
    if r.returncode != 0 or not m:
        return base
    j = json.loads(m.group(0))
    if j["input_i"] in ("-inf", "inf"):
        return None  # silence: nothing to normalize
    return (f"{base}:measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}"
            f":measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true")


def encode_mp3(audio, dest, cfg):
    import soundfile as sf
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        wav = Path(td) / "in.wav"
        sf.write(str(wav), audio, KOKORO_RATE, subtype="FLOAT")
        tmp = Path(td) / "out.mp3"
        af = loudnorm_filter(wav, cfg)
        cmd = ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(wav)]
        if af:
            cmd += ["-af", af]
        cmd += ["-ac", "1", "-ar", str(cfg["sampleRate"]), "-c:a", "libmp3lame", "-b:a", cfg["bitrate"],
                "-map_metadata", "-1", str(tmp)]
        subprocess.run(cmd, check=True)
        shutil.move(str(tmp), str(dest))


def vtt_time(x):
    h, rem = divmod(x, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:06.3f}"


def write_vtt(timing, dest):
    lines = ["WEBVTT", ""]
    for c in timing:
        if not c["text"]:
            continue
        lines += [str(c["i"] + 1), f"{vtt_time(c['speechStart'])} --> {vtt_time(c['end'])}", c["text"], ""]
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text("\n".join(lines), encoding="utf8")


# ---------- Targets ----------
def select(data, a):
    lessons = data["lessons"]
    out = []
    if a.slide:
        m = re.fullmatch(r"(.+)-(\d+)", a.slide)
        if not m:
            sys.exit(f"--slide must look like rules-02-4, not {a.slide}")
        lid, n = m.group(1), int(m.group(2))
        L = next((l for l in lessons if l["id"] == lid), None)
        if not L or not (1 <= n <= len(L["slides"])):
            sys.exit(f"No slide {a.slide}")
        return [(L, L["slides"][n - 1])]
    if a.lesson:
        ids = [x.strip() for x in a.lesson.split(",")]
        unknown = [i for i in ids if i not in {l["id"] for l in lessons}]
        if unknown:
            sys.exit(f"Unknown lesson(s): {', '.join(unknown)}")
        chosen = [l for l in lessons if l["id"] in ids]
    elif a.module:
        chosen = [l for l in lessons if l["module"] == a.module.upper()]
        if not chosen:
            sys.exit(f"No lessons in module {a.module}")
    elif a.pilot:
        chosen = [l for l in lessons if l["id"] in PILOT]
    elif a.all:
        chosen = lessons
    else:
        sys.exit("Choose what to narrate: --pilot, --module R|N|D|P, --lesson ID, --slide ID-N or --all (see --help)")
    for L in chosen:
        for s in L["slides"]:
            out.append((L, s))
    return out


def fmt_dur(sec):
    sec = int(round(sec))
    return f"{sec // 3600}h {sec % 3600 // 60:02d}m" if sec >= 3600 else f"{sec // 60}m {sec % 60:02d}s"


# ---------- Main ----------
def main():
    ap = argparse.ArgumentParser(description="Generate slide narration with Kokoro-82M (local, free).")
    g = ap.add_argument_group("what to narrate (pick one)")
    g.add_argument("--pilot", action="store_true", help="rules-01 to rules-03")
    g.add_argument("--module", metavar="R|N|D|P")
    g.add_argument("--lesson", metavar="ID", help="one lesson id, or several separated by commas")
    g.add_argument("--slide", metavar="ID-N", help="one slide, e.g. rules-02-4")
    g.add_argument("--all", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="show what would be generated and an estimated time")
    ap.add_argument("--force", action="store_true", help="regenerate even if unchanged")
    ap.add_argument("--audition", metavar="VOICES",
                    help="comma-separated voice ids: render the selected slide(s) once per voice into media/auditions/")
    ap.add_argument("--phonemes", metavar="TEXT", help="print the phonemes Kokoro would use for TEXT (after the dictionary)")
    a = ap.parse_args()

    cfg = load_cfg()
    apply_dict = make_applier(load_dictionary())

    if a.phonemes:
        eng = Engine(cfg)
        eng.load([cfg["voice"]])
        txt = apply_dict(a.phonemes)
        print(f"text:     {txt}\nphonemes: {eng.phonemes(txt)}")
        return

    data = json.loads(DATA.read_text(encoding="utf8"))
    targets = select(data, a)
    versions = engine_versions()
    manifest = load_manifest()
    rate = manifest.get("stats", {}).get("charsPerSec") or DEFAULT_CHARS_PER_SEC

    if a.audition:
        voices = [v.strip() for v in a.audition.split(",") if v.strip()]
        chars = sum(len(s["tts"]) for _, sl in targets for s in prepare(sl["script"], apply_dict))
        print(f"Audition: {len(targets)} slide(s) x {len(voices)} voice(s), about {fmt_dur(chars * len(voices) / rate)}")
        if a.dry_run:
            return
        eng = Engine(cfg)
        eng.load(voices)
        for L, sl in targets:
            sents = prepare(sl["script"], apply_dict)
            for v in voices:
                audio, _ = render_slide(eng, sents, v, cfg["speed"], cfg)
                dest = AUDITION / f"{L['id']}-{sl['n']}-{v}.mp3"
                encode_mp3(audio, dest, cfg)
                print(f"  {dest.relative_to(ROOT)}  ({len(audio) / KOKORO_RATE:.1f} s)")
        return

    todo, skip = [], []
    for L, sl in targets:
        sid = f"{L['id']}-{sl['n']}"
        sents = prepare(sl["script"], apply_dict)
        h = slide_hash(sents, cfg, versions)
        prev = manifest["slides"].get(sid, {})
        # Only site/audio/*.mp3 is committed (no duplicate in git); restore the media/ copy from it.
        if prev.get("hash") == h and not (NARR / f"{sid}.mp3").exists() and (SITE_AUDIO / f"{sid}.mp3").exists():
            shutil.copyfile(SITE_AUDIO / f"{sid}.mp3", NARR / f"{sid}.mp3")
        have = all(p.exists() for p in (NARR / f"{sid}.mp3", NARR / f"{sid}.timing.json",
                                        SITE_AUDIO / f"{sid}.mp3", SITE_AUDIO / f"{sid}.timing.json",
                                        CAPS / f"{sid}.vtt"))
        if not a.force and prev.get("hash") == h and have:
            skip.append(sid)
        else:
            todo.append((L, sl, sid, sents, h))

    chars = sum(len(s["tts"]) for *_, sents, _ in todo for s in sents)
    print(f"Voice {cfg['voice']}, speed {cfg['speed']}. {len(todo)} slide(s) to generate, {len(skip)} unchanged (skipped).")
    print(f"{chars:,} characters to synthesize; estimated time on this machine: {fmt_dur(chars / rate)}"
          f" ({'measured' if manifest.get('stats', {}).get('charsPerSec') else 'rough default'} {rate:.0f} chars/s). Cost: none.")
    if a.dry_run or not todo:
        return

    eng = Engine(cfg)
    eng.load([cfg["voice"]])
    t_all = time.time()
    done_chars = 0
    for k, (L, sl, sid, sents, h) in enumerate(todo, 1):
        t0 = time.time()
        audio, timing = render_slide(eng, sents, cfg["voice"], cfg["speed"], cfg)
        mp3 = NARR / f"{sid}.mp3"
        encode_mp3(audio, mp3, cfg)
        dur = round(len(audio) / KOKORO_RATE, 3)
        tj = {
            "slide": sid, "lessonId": L["id"], "n": sl["n"], "audio": f"{sid}.mp3", "duration": dur,
            "voice": cfg["voice"], "speed": cfg["speed"],
            "buildCount": sum(s["builds"] for s in sents),
            "sentences": timing,
        }
        tpath = NARR / f"{sid}.timing.json"
        tpath.write_text(json.dumps(tj, ensure_ascii=False, indent=1) + "\n", encoding="utf8")
        write_vtt(timing, CAPS / f"{sid}.vtt")
        SITE_AUDIO.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(mp3, SITE_AUDIO / mp3.name)
        shutil.copyfile(tpath, SITE_AUDIO / tpath.name)
        n_chars = sum(len(s["tts"]) for s in sents)
        done_chars += n_chars
        manifest["slides"][sid] = {"hash": h, "duration": dur, "chars": n_chars, "voice": cfg["voice"],
                                   "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
        manifest["stats"]["charsPerSec"] = round(done_chars / max(0.001, time.time() - t_all), 1)
        save_manifest(manifest)  # save after every slide so an interrupted run resumes cleanly
        print(f"  [{k}/{len(todo)}] {sid}  {dur:5.1f} s audio in {time.time() - t0:4.1f} s", flush=True)
    print(f"Done: {len(todo)} slide(s) in {fmt_dur(time.time() - t_all)} "
          f"({manifest['stats']['charsPerSec']:.0f} chars/s).")


if __name__ == "__main__":
    main()
