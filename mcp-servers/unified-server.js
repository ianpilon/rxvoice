require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Vapi sends tool calls in a few shapes; pull a named argument out of any of them.
function extractArg(body, name) {
  return body[name]
    || body.parameters?.[name]
    || body.message?.toolCalls?.[0]?.function?.arguments?.[name]
    || body.message?.toolCallList?.[0]?.function?.arguments?.[name];
}

function extractToolCallId(body) {
  return body.message?.toolCallList?.[0]?.id || 'unknown';
}

function vapiResult(res, toolCallId, result, status = 200) {
  return res.status(status).json({ results: [{ toolCallId, result }] });
}

// ============================================
// MEDICATION INFORMATION (voice-as-read)
// Patient-facing answers drawn verbatim from a PMI-shaped corpus.
// ============================================

const MED_DB_PATH = path.join(__dirname, 'med-context/medications.json');

function loadMedDB() {
  if (fs.existsSync(MED_DB_PATH)) {
    const data = JSON.parse(fs.readFileSync(MED_DB_PATH, 'utf8'));
    return data.medications || [];
  }
  return [];
}

let medications = loadMedDB();

// ---- Resolve which medication the patient means (brand or generic) ----
function findMedication(name) {
  const q = String(name || '').toLowerCase().trim();
  if (!q) return null;

  // Exact-ish match on id, generic, or any brand name.
  for (const m of medications) {
    const names = [m.id, m.generic_name, m.spoken_name, ...(m.brand_names || [])]
      .map(n => String(n).toLowerCase());
    if (names.some(n => q.includes(n) || n.includes(q))) return m;
  }

  // Keyword fallback: best overlap with name tokens.
  const tokens = q.split(/\s+/).filter(t => t.length > 2);
  let best = null, bestScore = 0;
  for (const m of medications) {
    const hay = [m.id, m.generic_name, ...(m.brand_names || [])].join(' ').toLowerCase();
    let score = 0;
    tokens.forEach(t => { if (hay.includes(t)) score += 3; });
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}

// ---- Match a free-text topic/question to a PMI section ----
// Each section key has a set of keywords; the question is scored against them
// and the best-matching section the drug actually has is returned. This is what
// turns "can I take this with food?" or "what if I miss a dose?" into the exact
// approved passage, instead of the model improvising an answer.
const TOPIC_KEYWORDS = {
  what_its_for: ['what is it for', 'what does it do', 'what is this', 'why do i take', 'what is it used for', 'purpose', 'used for', 'treat'],
  how_to_take: ['how do i take', 'how to take', 'how should i take', 'directions', 'instructions', 'when do i take', 'how often'],
  with_food: ['with food', 'with a meal', 'before eating', 'after eating', 'empty stomach', 'food', 'meal', 'eat'],
  missed_dose: ['miss a dose', 'missed dose', 'forgot', 'forget', 'skip a dose', 'double dose', 'late', 'missed'],
  common_side_effects: ['side effect', 'side effects', 'common side', 'what are the side', 'reactions', 'make me feel'],
  serious_side_effects: ['serious', 'when should i call', 'when to call', 'emergency', 'dangerous', 'severe', 'allergic reaction', 'worried', 'hospital'],
  interactions: ['interaction', 'other medicines', 'other drugs', 'take with other', 'mix with', 'together with', 'safe with'],
  alcohol: ['alcohol', 'drink', 'drinking', 'wine', 'beer', 'liquor'],
  grapefruit: ['grapefruit'],
  storage: ['store', 'storage', 'keep it', 'fridge', 'refrigerate', 'room temperature', 'where do i keep'],
  low_blood_sugar: ['low blood sugar', 'hypoglycemia', 'hypo', 'blood sugar drops', 'shaky'],
  pregnancy: ['pregnant', 'pregnancy', 'breastfeed', 'breast feeding', 'baby', 'trying to conceive'],
  allergy: ['allergy', 'allergic', 'penicillin allergy', 'am i allergic']
};

function matchTopic(med, topic, question) {
  const text = `${topic || ''} ${question || ''}`.toLowerCase();
  if (!text.trim()) return null;

  // Score each section by its BEST-matching phrase (not the sum), so a longer,
  // more specific intent like "when should i call" outranks generic words like
  // "side effects" stacking. This matters for safety: an urgent question must
  // route to the "serious side effects / when to get help" passage, not the
  // everyday one.
  let best = null, bestScore = 0;
  for (const key of Object.keys(med.sections || {})) {
    const phrases = TOPIC_KEYWORDS[key] || [key.replace(/_/g, ' ')];
    let score = 0;
    phrases.forEach(p => { if (text.includes(p)) score = Math.max(score, p.split(' ').length * 2); });
    if (score > bestScore) { bestScore = score; best = key; }
  }
  return bestScore > 0 ? best : null;
}

function topicLabel(key) {
  return String(key).replace(/_/g, ' ');
}

function answerMedication(med, topic, question) {
  const key = matchTopic(med, topic, question);
  const named = med.spoken_name || med.generic_name;

  if (!key) {
    // No clear topic: give the overview and offer the kinds of things on record.
    const have = Object.keys(med.sections || {}).map(topicLabel).join(', ');
    return {
      sectionKey: 'what_its_for',
      text: `${med.what_its_for} I can read what's on the patient information for ${named} about: ${have}. What would you like to know?`
    };
  }

  if (key === 'what_its_for') {
    return { sectionKey: 'what_its_for', text: med.what_its_for };
  }

  return { sectionKey: key, text: med.sections[key] };
}

app.post('/lookup-medication', (req, res) => {
  const toolCallId = extractToolCallId(req.body);
  const medName = extractArg(req.body, 'medication');
  const topic = extractArg(req.body, 'topic');
  const question = extractArg(req.body, 'question');

  console.log(`\nMedication lookup: med="${medName}" topic="${topic}" question="${question}"`);

  if (!medName) {
    const list = medications.map(m => m.spoken_name).join(', ');
    return vapiResult(res, toolCallId,
      `I need to know which medication you're asking about. This demo covers ${list}. Which one?`);
  }

  const med = findMedication(medName);
  if (!med) {
    const list = medications.map(m => m.spoken_name).join(', ');
    return vapiResult(res, toolCallId,
      `I don't have ${medName} in this demo. It covers ${list}. A full version would have the patient information for every approved medication. Always check with your pharmacist for anything not here.`);
  }

  const { sectionKey, text } = answerMedication(med, topic, question);
  console.log(`   Found: ${med.spoken_name} / section "${sectionKey}"`);
  return vapiResult(res, toolCallId, text);
});

// Structured lookup for the UI "source" pill: returns which medication and
// section answered, sourced from the same matcher (never from the spoken text).
app.get('/med-section', (req, res) => {
  const medName = (req.query.medication || '').toString();
  const topic = (req.query.topic || '').toString();
  const question = (req.query.question || '').toString();
  const med = findMedication(medName);
  if (!med) return res.json({ found: false });
  const { sectionKey } = answerMedication(med, topic, question);
  res.json({
    found: true,
    medication: med.spoken_name,
    brand: (med.brand_names || [])[0] || null,
    section: topicLabel(sectionKey)
  });
});

// ============================================
// UTILITY + DATA ENDPOINTS
// ============================================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    medications: medications.length,
    message: 'RxVoice backend is running'
  });
});

app.get('/data/medications', (req, res) => {
  // Read-only view of what the assistant sees.
  res.json({
    count: medications.length,
    medications: medications.map(m => ({
      generic_name: m.generic_name,
      brand_names: m.brand_names,
      drug_class: m.drug_class,
      what_its_for: m.what_its_for,
      topics: Object.keys(m.sections || {}).map(topicLabel)
    }))
  });
});

app.post('/reload', (req, res) => {
  medications = loadMedDB();
  res.json({ success: true, medications: medications.length, message: 'Medication data reloaded' });
});

// ============================================
// STATIC FRONTEND (serve the demo page + assets)
// Scoped to index.html and /assets so .env, configure scripts, and the
// system prompt are never exposed by the static server.
// ============================================

const SITE_ROOT = path.join(__dirname, '..');
app.use('/assets', express.static(path.join(SITE_ROOT, 'assets')));
app.get(['/', '/index.html'], (req, res) => {
  res.sendFile(path.join(SITE_ROOT, 'index.html'));
});

// ============================================
// SERVER STARTUP
// ============================================

app.listen(port, () => {
  console.log('\nRxVoice - Backend');
  console.log('----------------------------------------');
  console.log(`Server URL: http://localhost:${port}`);
  console.log('');
  console.log('Endpoints:');
  console.log('  POST /lookup-medication  - Patient medication info lookup (verbatim)');
  console.log('  GET  /med-section        - Structured section match (UI source pill)');
  console.log('  GET  /health             - Health check');
  console.log('  GET  /data/medications   - Read-only view of the corpus');
  console.log('  POST /reload             - Reload medication data');
  console.log('----------------------------------------');
  console.log(`Medications loaded: ${medications.length} (${medications.map(m => m.spoken_name).join(', ')})`);
  console.log('Ready for Vapi integration.\n');

  // Keep-warm: on a free tier the instance can spin down after idle; ping our
  // own /health every 10 min so an already-awake instance never goes idle.
  // No-op locally (var unset). RENDER_EXTERNAL_URL is set on Render; on Fly the
  // machine is always-on so this is not needed.
  const selfUrl = process.env.RENDER_EXTERNAL_URL;
  if (selfUrl) {
    const KEEP_WARM_MS = 10 * 60 * 1000;
    setInterval(() => {
      fetch(`${selfUrl}/health`)
        .then(() => console.log('keep-warm ping ok'))
        .catch(e => console.log('keep-warm ping failed:', e.message));
    }, KEEP_WARM_MS);
    console.log(`keep-warm enabled: pinging ${selfUrl}/health every 10 min\n`);
  }
});
