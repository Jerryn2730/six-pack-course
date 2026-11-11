# Six-Pack Captain Course: start here

This folder is ready to open in Claude Code. **Budget rule: zero cost except your Claude subscription.** Every tool in the plan is free.

| File | What it is |
| --- | --- |
| `CLAUDE.md` | Standing rules Claude Code reads automatically, including the zero-cost rule |
| `COURSE_MASTER.md` | Current work product, production guide, free toolchain, Claude Code task playbook (Tasks 0–8), and the full course blueprint |
| `site/index.html` | The working study app (open it in a browser). Built by `npm run build`; don't edit by hand |
| `content/course-data.json` | Every lesson, slide script and question: the source of truth. Edit this, then run `npm run build` |
| `.env.example` | Local voice settings (no paid keys) |

## The free toolchain

| Job | Tool |
| --- | --- |
| Narration | Kokoro-82M voice, run on your own computer (Apache 2.0) |
| Audio and video | FFmpeg and Playwright |
| Website | Netlify free tier or GitHub Pages |
| Video hosting | YouTube |
| Progress across devices | Backup and restore file, in place of paid accounts |

## First steps

1. Open this folder in Claude Code (desktop app Code tab, or run `claude` in a terminal inside the folder).
2. Paste this first prompt:

   > Read CLAUDE.md and COURSE_MASTER.md. Follow the zero-cost rule. Do Task 0 (project setup). When I accept it, do Task 1 (validation), then Task 2 (free local narration with Kokoro): install it, generate one test slide in three or four voices for me to choose from, then generate the pilot lessons. Then do Task 4 (free hosting).

3. Generate audio for the 3 pilot lessons first and listen in the app. Adjust the voice, speed and pronunciations, then generate the whole course one module at a time.
4. Then do Task 3 (lesson videos for YouTube) and pick the free features you want from Task 5.

Narrating the whole course costs nothing but computer time. Expect generation to take a while on a laptop; the scripts only regenerate slides you change.

All content is AI-drafted and must be fact-checked against official sources before you rely on it. See COURSE_MASTER.md, Task 7.

## Folder layout (Task 0)

| Path | Purpose |
| --- | --- |
| `site/` | Deployable static site (`site/index.html`, `site/audio/` for MP3s) |
| `content/` | `course-data.json` (source of truth) and `archive/` (superseded drafts) |
| `src/app.html` | App code template; the build inserts the content at `/*@@CONTENT@@*/` |
| `scripts/` | Node tooling: `npm run validate` and `npm run build` work; `audio`, `video`, `deploy` are stubs |
| `config/` | Voice settings (Task 2) |
| `media/` | Generated narration, captions, diagrams, thumbnails; `media/video/` is gitignored |
| `QA/`, `SOURCES/` | Pronunciation dictionary, fact-check logs, source register, asset licenses |
| `CURRICULUM/`, `MODULES/`, `TEMPLATES/`, `RELEASES/` | Blueprint structure (Appendix A.10), empty until later tasks |

## Narration (Task 2)

Free, local text-to-speech with Kokoro-82M. One-time setup on a new computer:
1. Install espeak-ng (macOS `brew install espeak-ng`, Ubuntu `sudo apt install espeak-ng`, Windows: the `.msi` from the espeak-ng releases page) and Python 3.10–3.12.
2. `npm run audio:setup` (creates `.venv` and installs `requirements-narration.txt`; the model downloads once on first use).

Then:

| Command | Does |
| --- | --- |
| `npm run audio -- --pilot --dry-run` | Shows what would be generated and how long it will take |
| `npm run audio -- --pilot` | Narrates `rules-01` to `rules-03` |
| `npm run audio -- --module R` | One module (`R`, `N`, `D`, `P`) |
| `npm run audio -- --lesson rules-02` / `--slide rules-02-4` / `--all` | Smaller or larger targets |
| `npm run audio -- --slide rules-01-2 --audition af_heart,am_michael` | Same slide in several voices, into `media/auditions/` |
| `npm run audio -- --phonemes "COLREGS"` | How Kokoro will pronounce something, after the dictionary |

Unchanged slides are skipped; add `--force` to regenerate. Voice, speed, pauses and loudness are in `config/voice.json`. Fix mispronunciations in `QA/pronunciation_dictionary.md`, not in the lesson text. Output: `media/narration/` (MP3 + timing), `media/captions/` (VTT), copied to `site/audio/`. The app uses the timing files for exact transcript and build sync when served over http (for example `npx serve site`); opened straight from disk, it still plays the audio with approximate sync.
