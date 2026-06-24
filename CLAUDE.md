# CLAUDE.md — project memory for RxVoice

A voice-AI demo that reads patients their plain-language prescription medication
information out loud. Architecture and endpoints live in `README.md`; this file
is the "what you need to know to work on it" layer.

Remixed from the Snap-on VoiceAI / ShopVoice demo (Vapi + Express + flat-file
corpus). The reusable pattern is **voice-as-read / verbatim-extraction**: the
assistant answers ONLY from a tool, reads the approved passage back, and never
improvises. For a medication this is a safety property, not just a nicety.

## What this is

A single static `index.html` (one product, dark/light theme, teal accent) on one
Express backend (`mcp-servers/unified-server.js`) + a flat-file corpus, driven by
one Vapi assistant.

- **Corpus:** `mcp-servers/med-context/medications.json` — PMI-shaped, plain-language
  info for four common medicines (metformin, atorvastatin, lisinopril, amoxicillin).
  Each drug has `what_its_for` + a `sections` map (how_to_take, with_food,
  missed_dose, common_side_effects, serious_side_effects, interactions, alcohol,
  storage, plus drug-specific ones like grapefruit / pregnancy / allergy).
- **Tool:** `lookup_medication(medication, topic?, question?)` → resolves the drug
  (brand or generic), matches the question to a section via a keyword table
  (`TOPIC_KEYWORDS` in `unified-server.js`), and returns that passage verbatim.
- **Demo interaction:** tapping a "Try asking" question plays a scripted text
  simulation in the phone mockup (no Vapi key needed). Tapping the mic is the live
  voice path. The first question auto-plays on load so the page self-explains.

## Safety posture (the load-bearing part)

This is a medical-information demo, so the guardrails ARE the product:
- The assistant never answers a medication question from general knowledge — always
  the tool. A confident wrong answer about a medicine can hurt someone.
- It gives information, not advice: no diagnosing, no dose changes, no start/stop.
  Anything about changing treatment → "talk to your pharmacist or doctor."
- Emergencies / serious reactions → tell the patient to call 911 or poison control
  now, not read a leaflet section.
- The corpus is illustrative DEMO content, not a verified monograph. Every surface
  (page footer, system prompt, README, corpus `_note`) says so and defers to the
  pharmacist. Keep that framing in any edit.

## The source pill (proof it came from the leaflet)

Under each live answer, a pill names the PMI section it was read from
(e.g. "metformin patient info · missed dose"). It is built from the backend's
structured match (`GET /med-section`), NEVER by parsing the spoken transcript
(noisy ASR). Timing is driven off Vapi's `speech-start` / `speech-end` events, not
a timer — on `speech-end` the pill drops under the latest bot bubble; on
`speech-start` it's pulled back and re-drops at the next `speech-end`. This is the
same mechanism the Snap-on demo used for its catalog-page pill; the lesson carried
over: a timer can't tell a mid-turn pause from end-of-turn.

## Run / configure recipes

```bash
npm start                                          # page + API on :3001 (PORT overrides)
node configure-complete-system.js <backend-url>    # create/update the RxVoice assistant
curl -s localhost:3001/health                      # sanity check
curl -s -X POST localhost:3001/lookup-medication -H 'content-type: application/json' \
  -d '{"medication":"metformin","question":"can I take this with food?"}'
```

- Editing `system-prompt.txt` or `configure-complete-system.js` requires re-running
  the configure script to push to Vapi — separate from a deploy.
- Editing the corpus: `POST /reload` or restart.
- After first create, paste the assistant ID into BOTH `.env` (`VAPI_ASSISTANT_ID`)
  and `index.html` (`APPS.rxvoice.assistantId`, currently `PLACEHOLDER_ASSISTANT_ID`).

## Vapi assistant

One GPT-4o assistant, tool `lookup_medication`, pointed at the backend. Config in
`configure-complete-system.js`:
- Patient turn detection (`startSpeakingPlan`, audio-based via livekit, 2.2s
  no-punctuation window) so an older caller's mid-sentence pause doesn't get cut off.
- Pinned 11labs Turbo voice with a TTS replacement so the name is spoken "Rx Voice"
  ("are-ex voice"), not "ricks voice".
- The Vapi PUBLIC key is in `index.html` (client-side, safe). The PRIVATE key lives
  only in `.env` (gitignored) and is used only by the configure script.

## Deployment

One service serves both the page and the API. `fly.toml` (app `rxvoice`, always-on)
or `render.yaml` (`rxvoice-backend`, free tier). After deploy, re-run the configure
script with the live URL so the tool points at the live backend. The in-code
self-ping keep-warm only fires when `RENDER_EXTERNAL_URL` is set (no-op on Fly /
local).

## Secrets

`.env` is gitignored and holds the Vapi private key + assistant ID. Never commit it;
the static server is scoped to `index.html` + `/assets` so it can't serve `.env`,
the configure script, or the system prompt.
