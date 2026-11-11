# Pronunciation dictionary

`npm run audio` reads the table below and applies it to every script before synthesis (Task 2).
Starting list from COURSE_MASTER.md Part 2.4.

How the **Kokoro** column works:
- `/…/`: phonemes, in the IPA-style notation Kokoro’s English G2P (misaki) uses. The term is sent as `[Term](/phonemes/)`.
- Any other text: replaces the term word for word before synthesis (a respelling).
- Blank: Kokoro already says it correctly; nothing is changed.

Matching is case-sensitive and whole-word. Separate several spellings of one term with commas in the Term column.
To check what Kokoro would say, run `npm run audio -- --phonemes "word or phrase"`.
Changing a row regenerates only the slides that contain that term.

| Term | Say it | Kokoro | Notes |
| --- | --- | --- | --- |
| COLREGS | COLE-regs | /kˈOlɹɛɡz/ | Kokoro spells the letters by default |
| Egmont | EGG-mont | | Default is correct (ˈɛɡmɔnt) |
| Atchafalaya | uh-CHAF-uh-LIE-uh | /əʧˌæfəlˈIə/ | Default stresses the first syllable |
| Boca Grande | BOH-kuh GRAN-dee | /bˈOkə ɡɹˈændi/ | Default says “Grand” |
| EPIRB | EE-perb | /ˈipəɹb/ | Kokoro spells the letters by default |
| EPIRBs | EE-perbs | /ˈipəɹbz/ | |
| AIS, MMSI, DSC, VHF, GPS | Spell the letters | | Default spells the letters |
| ARPA | AR-puh | /ˈɑɹpə/ | |
| MARPA | MAR-puh | /mˈɑɹpə/ | |
| Securité, Sécurité | say-CURE-ee-tay | /sˌAkjˈʊɹitˌA/ | |
| Vibrio | VIB-ree-oh | | Default is correct |
| 1210-Tr | twelve-ten T R | twelve-ten T R | |
