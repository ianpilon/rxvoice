# RxVoice

A forwardable "your medication information, read aloud" voice demo. A patient opens one link, taps to talk, and asks a real question out loud — *"Can I take this with food?"*, *"What do I do if I miss a dose?"*, *"What are the side effects?"* — and hears the answer read back from the plain-language patient information. The page is designed to explain itself without anyone presenting it, and ends with a "why this matters" section on the prescription-information opportunity.

Remixed from the Snap-on VoiceAI / ShopVoice architecture (Vapi + Express + flat-file corpus). The core pattern is unchanged: **voice in, verified data out** — the assistant reads back an authoritative answer and never improvises.

## The problem it speaks to

Prescription medication information is fragmented across a dense clinician-facing monograph, a regulator-mandated plain-language Patient Medication Information (PMI) leaflet, and the bottle label. At each handoff, legibility or understanding can break down: small fonts and all-capital labels defeat older adults and people with vision loss; the PMI exists but arrives as a static leaflet that is easy to lose and hard to search. RxVoice is a digital delivery layer that serves the same authoritative content on the patient's terms — spoken, searchable, plain-language, on demand.

## Architecture

```
Browser (index.html, Vapi Web SDK tap-to-talk)
  → Vapi (STT/TTS + GPT-4o function calling)
    → Express server (mcp-servers/unified-server.js)
      → flat-file PMI corpus (mcp-servers/med-context/medications.json)
```

### Backend endpoints

| Endpoint | Purpose |
|---|---|
| `POST /lookup-medication` | The one tool. Resolves a medication (brand or generic), matches the question to a PMI section (with food, missed dose, side effects, interactions, storage, …), and returns that passage verbatim. |
| `GET /med-section` | Structured section match for the UI source pill — returns which medication + section answered, from the same matcher (never parsed from the spoken transcript). |
| `GET /health` | Status + count of medications loaded. |
| `GET /data/medications` | Read-only view of the corpus the assistant sees. |
| `POST /reload` | Reload the corpus without restarting. |

### Demo corpus (stand-in, illustrative only)

`mcp-servers/med-context/medications.json` holds PMI-shaped, plain-language information for four common medicines (metformin, atorvastatin, lisinopril, amoxicillin). Each has an overview plus sections like *how to take, with food, missed dose, common side effects, serious side effects, interactions, alcohol, storage*.

**This is demo content, not medical advice and not a verified product monograph.** The point is the pattern, not the specific text. A real build would ingest the authoritative structured monograph / PMI for each drug. The assistant always defers to the patient's pharmacist or doctor and routes anything urgent to emergency help.

## Setup

```bash
npm install
npm start          # page + API on PORT (default 3001)
```

### Wire up Vapi (one time)

1. Copy `.env.example` to `.env`, set `VAPI_API_KEY`, leave `VAPI_ASSISTANT_ID` blank.
2. `node configure-complete-system.js <backend-url>` — creates a NEW RxVoice assistant and prints its ID.
3. Put that ID in `.env` (`VAPI_ASSISTANT_ID=...`) so future runs update instead of creating duplicates.
4. Put the same ID in `index.html` (`APPS.rxvoice.assistantId`).

For local testing, tunnel the backend and pass the tunnel URL:

```bash
ngrok http 3001
node configure-complete-system.js https://your-tunnel.ngrok-free.app
```

The scripted text simulation (tap a "Try asking" question) works without any of this — it needs no Vapi key. Live voice (tap to talk) needs the assistant wired up.

## Deployment

- **Backend + page:** one service serves both. Fly via `fly.toml` (app `rxvoice`, always-on single machine) or Render via `render.yaml` (service `rxvoice-backend`, free tier, `/health` health check).
- After deploying, re-run `node configure-complete-system.js <live-url>` so the Vapi tool points at the live backend.

## Updating data

Edit `mcp-servers/med-context/medications.json`, then `POST /reload` (or restart). Editing `system-prompt.txt` requires re-running `configure-complete-system.js` to push it to Vapi.
