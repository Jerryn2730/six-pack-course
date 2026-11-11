# Asset and tool licenses

Record every tool, library, model, voice, font, image, footage or service before adding it (CLAUDE.md, zero-cost rule).
Verify each license against its official source; mark anything not yet checked `[VERIFY]`.

| Asset / tool | Used for | Cost | License | Source URL | Checked (date) | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Node.js | Tooling scripts | Free | MIT `[VERIFY]` | https://nodejs.org | — | Already installed; no npm dependencies yet |
| Google Fonts: Barlow Semi Condensed, Source Serif 4 | Typography in `site/index.html` (pre-existing) | Free | SIL Open Font License `[VERIFY]` | https://fonts.google.com | — | Loaded from Google's CDN at runtime |
| Kokoro-82M model weights (`hexgrad/Kokoro-82M`) | Narration voice model | Free | Apache-2.0 (model card) | https://huggingface.co/hexgrad/Kokoro-82M | 2026-11-11 | Downloaded once to the local Hugging Face cache; runs offline after that |
| Kokoro American English voices (`af_heart`, `af_bella`, `am_michael`, `am_fenrir` auditioned) | Narration | Free | Covered by the model’s Apache-2.0; VOICES.md marks none of the American voices as CC BY | https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md | 2026-11-11 | Only some Japanese and French voices carry CC BY attribution terms; none are used |
| `kokoro` Python package 0.9.4 | Runs the model | Free | Apache-2.0 (PyPI metadata) | https://pypi.org/project/kokoro/ | 2026-11-11 | Needs Python 3.10–3.12 |
| `misaki[en]` 0.9.4 | English text-to-phoneme conversion | Free | Apache-2.0 (package metadata) | https://pypi.org/project/misaki/ | 2026-11-11 | |
| espeak-ng 1.51 | Fallback phonemizer for unknown words | Free | GPL-3.0-or-later (Debian copyright file) | https://github.com/espeak-ng/espeak-ng | 2026-11-11 | Separate program/library used as a tool; the generated audio isn’t covered by its license `[VERIFY]` if the course is ever sold |
| `phonemizer-fork` 3.3.2 | espeak-ng bridge used by misaki | Free | GPL-3.0-or-later (package metadata) | https://pypi.org/project/phonemizer-fork/ | 2026-11-11 | Same note as espeak-ng |
| `num2words` 0.5.14 | Number-to-words in misaki | Free | LGPL (package metadata) | https://pypi.org/project/num2words/ | 2026-11-11 | |
| PyTorch 2.15 (CPU build) | Kokoro runtime | Free | Apache-2.0 per package metadata (historically BSD-style) `[VERIFY]` | https://pytorch.org | 2026-11-11 | CPU-only wheel from download.pytorch.org |
| spaCy 3.8 and `en_core_web_sm` 3.8.0 | Part-of-speech tagging inside misaki | Free | MIT (package metadata) | https://spacy.io | 2026-11-11 | Downloaded automatically on first run |
| `transformers`, `huggingface_hub`, `soundfile`, `numpy`, `loguru` | Supporting libraries | Free | Apache-2.0, Apache-2.0, BSD-3-Clause, BSD-3-Clause (+ others), MIT (package metadata) | PyPI | 2026-11-11 | |
| FFmpeg 6.1 (with libmp3lame) | MP3 encoding and loudness normalization | Free | LGPL-2.1+/GPL depending on build; LAME is LGPL `[VERIFY]` | https://ffmpeg.org | 2026-11-11 | Used as a command-line tool |
