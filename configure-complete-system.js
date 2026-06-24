require('dotenv').config();
const fs = require('fs');

// Pass the backend URL (e.g. an ngrok tunnel or the Fly/Render URL) as the first argument.
const BACKEND_URL = process.argv[2] || 'https://rxvoice.fly.dev';

function assistantConfig(systemPrompt) {
  return {
    name: 'RxVoice',
    firstMessage: "Rx Voice here. Which medication would you like to ask about?",
    // Patient, audio-based turn detection so a mid-sentence pause (e.g. while an
    // older caller gathers a thought) doesn't make the assistant barge in.
    startSpeakingPlan: {
      waitSeconds: 0.8,
      smartEndpointingPlan: { provider: 'livekit' },
      transcriptionEndpointingPlan: {
        onPunctuationSeconds: 0.3,
        onNoPunctuationSeconds: 2.2,
        onNumberSeconds: 1.0
      }
    },
    // Calm, clear voice with a text replacement applied right before TTS so the
    // assistant's name is spoken as two words ("Rx Voice", not "ricks voice").
    voice: {
      provider: '11labs',
      voiceId: 'dN8hviqdNrAsEcL57yFj',
      model: 'eleven_turbo_v2_5',
      chunkPlan: {
        formatPlan: {
          replacements: [
            { type: 'exact', key: 'RxVoice', value: 'Rx Voice' },
            { type: 'exact', key: 'Rx', value: 'are ex' }
          ]
        }
      }
    },
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        }
      ],
      tools: [
        {
          type: 'function',
          async: false,
          function: {
            name: 'lookup_medication',
            description: "Look up the plain-language patient information for a prescription medication and return the passage that answers the patient's question. Use this for EVERY question about a medication — what it's for, how to take it, taking it with food, a missed dose, side effects, when to get medical help, drug or food interactions, alcohol, pregnancy, allergies, or storage. Never answer a medication question from general knowledge.",
            parameters: {
              type: 'object',
              properties: {
                medication: {
                  type: 'string',
                  description: 'The medication name the patient asked about, brand or generic (e.g. "metformin", "Lipitor", "lisinopril", "amoxicillin").'
                },
                topic: {
                  type: 'string',
                  description: 'A short label for what they want to know, if clear (e.g. "with food", "missed dose", "side effects", "storage", "interactions"). Optional.'
                },
                question: {
                  type: 'string',
                  description: "The patient's question in their own words (e.g. \"can I take this with food?\", \"what do I do if I miss a dose?\"). Optional but helps pick the right passage."
                }
              },
              required: ['medication']
            }
          },
          server: {
            url: `${BACKEND_URL}/lookup-medication`,
            timeoutSeconds: 30
          }
        }
      ]
    }
  };
}

async function configureAssistant() {
  try {
    if (!process.env.VAPI_API_KEY) {
      console.error('VAPI_API_KEY is not set. Copy .env.example to .env and fill it in.');
      return;
    }

    const systemPrompt = fs.readFileSync('./system-prompt.txt', 'utf8');
    const config = assistantConfig(systemPrompt);

    const assistantId = process.env.VAPI_ASSISTANT_ID;
    const creating = !assistantId;

    const response = await fetch(
      creating ? 'https://api.vapi.ai/assistant' : `https://api.vapi.ai/assistant/${assistantId}`,
      {
        method: creating ? 'POST' : 'PATCH',
        headers: {
          'Authorization': `Bearer ${process.env.VAPI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(config)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Failed to configure assistant');
      console.error('Status:', response.status);
      console.error('Error:', JSON.stringify(data, null, 2));
      return;
    }

    if (creating) {
      console.log('RxVoice assistant CREATED.');
      console.log(`Assistant ID: ${data.id}`);
      console.log('Add this to .env as VAPI_ASSISTANT_ID so future runs update instead of creating duplicates.');
      console.log('Also paste it into index.html (APPS.rxvoice.assistantId).');
    } else {
      console.log('RxVoice assistant updated.');
    }
    console.log('Backend:', BACKEND_URL);
    console.log('Tool wired: lookup_medication');
  } catch (error) {
    console.error('Error:', error.message);
  }
}

configureAssistant();
