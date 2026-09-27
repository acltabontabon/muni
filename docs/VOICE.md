# Voice: speak a thought, get editable text

Tap **Speak** beside the writing field, talk, tap **Stop**. The words are added to your draft,
where you can edit them. That's all it does: it transcribes. It doesn't translate, summarise,
correct grammar, or rewrite. Treat the result as recognition output to read over, not a verbatim
record.

Nothing is ever submitted by voice. Dictated words become part of the **draft** (private, not
sent), exactly as if you had typed them. Only **Save thought** contributes to a retro.

## How it works

| Step | Where | What |
| --- | --- | --- |
| Microphone | Your browser | Opened only after you tap Speak (and allow it). Raw audio samples are captured with an AudioWorklet and held in memory. Released the moment you stop or cancel |
| Speech check | Page | An energy check against the recording's own noise floor: silence, hiss and hum don't go to the model, so it can't invent text from them |
| Recognition | A Web Worker on your device | Whisper *small* (multilingual, 8-bit) run by Transformers.js on ONNX Runtime's WebAssembly backend, several threads where the page is cross-origin isolated |
| Result | Page | Cleaned only of Whisper's known artefacts (bracketed "[Music]" tags, a repeated-phrase decoding loop, a lone "Thank you for watching" from near-silence), then added to the draft |
| Draft | Your browser | Saved the way every draft is: in this tab, or on this device if you chose "Keep drafts on this device". Drafts are never sent until you save the thought |

**Audio is never uploaded, stored, or logged.** It exists in memory while you record and while
it's transcribed, and is kept a little longer only so a failed transcription can be retried. It's
released once the words are in a saved draft, when you cancel or discard, or when the page closes.
There's no audio library.

**Model files are downloads, not uploads.** The first time you choose Speak, Muni explains and
asks before downloading the speech model (252 MB) from Muni's own server. That request carries
nothing about you or your writing. After that, the model is kept in your browser's cache and
recognition works without a connection. Account → Voice shows whether it's on this device and can
remove it.

## Where the words go

- If the draft hasn't changed since you started recording, the words go where your cursor was
  (the end, if you hadn't clicked into the field). A selection is never replaced.
- If you kept typing while Muni listened or transcribed, the words go at the end, so nothing you
  typed is moved or split.
- A recording's words are inserted once. Retrying a failed transcription can't duplicate them.
- **Undo** (shown briefly) takes them back out, only while the draft is exactly as it left it.
- If they wouldn't fit in one thought (2,000 characters), nothing is added and the text is shown
  so you can copy it.

A result is applied only to the account, draft (sprint) and local-data generation it was
recorded in: switching sprint, signing out, or clearing local data drops it unseen
(`web/src/lib/voice/session.ts`, tested in `session.test.ts`).

## Languages

English, Tagalog, and Taglish (both in the same sentence). There's no language setting.

Transformers.js has no language detection (an unset language silently becomes English), so
Muni always transcribes with the language token set to Tagalog. Measured below: with Tagalog set,
English speech still comes back in English and mixed recordings keep both languages; with English
set, **Tagalog speech is translated into English**, which Muni must never do. An "English" option
would add that risk without improving English in our tests, so it isn't offered.

Other Philippine languages haven't been evaluated and aren't claimed.

## Limits

- **2 minutes per recording.** That's about as many words as fit in one thought; recording stops
  and transcribes on its own at the limit.
- Recording stops (and never restarts on its own) when the page is hidden or the phone locks, a
  call takes the microphone, or the microphone disappears. What was captured can be transcribed or
  discarded.
- One transcription at a time; the worker is stopped after 90 seconds unused, returning its
  memory, and on sign-out or account change.

## Evaluation (2026-09-27)

Synthetic and public data only: FLEURS (Google, CC BY 4.0) read-speech clips, spliced
Tagalog→English recordings, generated silence and noise. No one's real voice. FLEURS Tagalog is
read, formal speech from Philippine speakers; it isn't conversational Taglish with technical
terms (see *Not yet validated*).

**Accuracy** — word error rate (lower is better), same pinned ONNX weights the browser loads, run
with onnxruntime-node on an Apple M2 Pro. 14 Tagalog clips (5–38 s), 8 English clips.

| Model (8-bit) | Download | Tagalog (tl) | Tagalog audio, English set | English (en) | English audio, Tagalog set | Spliced tl→en, Tagalog set |
| --- | --- | --- | --- | --- | --- | --- |
| tiny | 41 MB | 200% (loops) | 342% | 25.5% | — | 80% |
| base | 77 MB | 116% (one loop; median 55%) | 464% | 11.3% | — | 62% |
| **small** | **252 MB** | **29.0%** (median 28.6%) | 105% (translated) | 14.9% | **12.8%** | **40%** |
| small, 4-bit | 299 MB | 28.7% | 106% | 12.8% | 12.8% | 40% |

- Whisper's published FLEURS Tagalog WER is 65.6% (tiny), 45.8% (base), 27.7% (small). Our numbers
  agree. Tiny and base aren't usable for Tagalog; small is the smallest model that is.
- 4-bit small is bigger (its decoder doesn't shrink) and slower, with no accuracy gain.
- "English set" on Tagalog audio produced fluent English that wasn't said, e.g. *"There is no big
  problem in the soil of Canaan…"* for a sentence about forests. This is why the language is fixed.
- Spliced recordings: 2 of 3 kept both halves in their own language; 1 of 3 lost its short English
  tail. Code-switching is not guaranteed.
- ~29% WER means roughly one word in four needs a fix on formal read Tagalog. Place names and
  loanwords are the usual misses (*Kenan* for *Canaan*, *hayok* for *hayop*).

**Silence and noise.** Without the speech check, Whisper small returned "I'm sorry." for pure
silence, hiss, noise and hum (base once returned a whole invented sentence). With the check, none
of these reach the model; all 22 speech clips still pass it, clean and with white noise at 10 dB
SNR. Speech at 0 dB SNR (as loud as the noise) is reported as "no speech caught".

**Speed** — whisper-small, 8-bit, in Chromium 153 (headless), Apple M2 Pro:

| Setup | Load + first run | 16 s English | 19.5 s Tagalog | 37.6 s Tagalog |
| --- | --- | --- | --- | --- |
| WebAssembly, 1 thread | 11 s + 10 s | 12.0 s (0.73×) | 13.0 s (0.67×) | 25.3 s (0.67×) |
| WebAssembly, 4 threads (cross-origin isolated) | 11 s + 2.7 s | 3.5 s (0.22×) | 3.9 s (0.20×) | 7.1 s (0.19×) |
| WebGPU (headless: software adapter) | 21 s + 80 s | 121 s | 146 s | 261 s |

Muni ships WebAssembly with threads (the app is cross-origin isolated). In the app, end to end
(`web/e2e/voice.mjs`, Chromium fake microphone playing a 19.5 s Tagalog clip): 5.0 s from Stop to
text on first use (the model downloaded from localhost while recording), 4.7 s once loaded. Model
download over a real connection takes as long as 252 MB takes. WebGPU wasn't measured on real GPU
hardware and isn't used.

## Browser support

| Environment | Status |
| --- | --- |
| Desktop Chromium (Chrome, Edge) | **Tested** (Playwright Chromium 153, fake microphone): recording, transcription, offline cache, cancel, undo, silence |
| Desktop Safari, Firefox | **Untested.** Should work (AudioWorklet, WebAssembly threads with COOP/COEP are supported); not run |
| Android Chrome | **Untested** on a device. Expect several seconds per 20 s on recent phones; memory is the risk on low-end devices |
| iPhone Safari / home-screen app | **Untested** on a device. The known risk is memory: Safari may reload a tab that uses several hundred MB. Muni reports "ran out of memory" and keeps the recording for a retry, but can't prevent the reload |
| Browsers without AudioWorklet or WebAssembly, or non-HTTPS | Voice says it's unavailable; typing is unaffected |

Muni never falls back to the browser's own speech recognition (which sends audio to Google or
Apple) or to any server.

## Not yet validated (release blockers)

1. **Real phones.** iPhone Safari (and the home-screen app) and a mid-range Android: memory,
   time per recording, heat, and that interruptions (lock, call) behave as described.
2. **Real Taglish speech.** Conversational code-switching with technical terms ("na-deploy na
   yung hotfix pero nag-fail yung CI"), Filipino accents in English, fillers and pauses, recorded
   with consent. Measure word error rate and check for translation and paraphrase.
3. **Desktop Safari and Firefox**, with a real microphone.

Until those pass, voice is a working feature, not a validated one.

## Costs

| | Cost |
| --- | --- |
| Transformers.js, ONNX Runtime Web | Free, Apache-2.0 / MIT |
| Whisper small weights | Free, MIT (OpenAI); ONNX conversion by onnx-community, pinned by revision |
| Hosting the model | Cloudflare Workers static assets: 13 parts of ≤ 20 MiB. Static asset requests aren't billed; no bandwidth charge |
| Recognition | On each person's device: CPU, battery, ~250 MB of storage, several hundred MB of memory while transcribing |
| Servers, APIs, quotas | None |

## Maintaining it

- The model is pinned in `web/src/lib/voice/model.json` (repo, revision, every file's size and
  SHA-256). `node web/scripts/voice-assets.mjs` fetches it from Hugging Face once, verifies it,
  and splits it into `web/public/voice/` (gitignored). Run it before `npm run build` when
  deploying; `--check` re-verifies.
- The browser reassembles the parts and checks each file's SHA-256 before caching it
  (`web/src/lib/voice/assets.ts`); an interrupted download resumes part by part.
- Changing the model means a new folder name (the revision is in it), so old caches never mix
  with new files.
- Tests: `web/src/lib/voice/*.test.ts` (states, cancellation, retry, duplicates, stale results,
  account isolation, insertion, speech check, downloads) and `web/e2e/voice.mjs` (the real path
  in a browser, against a production build).
