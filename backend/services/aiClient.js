const config = require('../config');

// Provider-agnostic text/JSON generation. Supports Google Gemini and Groq
// (OpenAI-compatible). Select with AI_PROVIDER; both fall back gracefully.

const DEFAULT_MODELS = {
  gemini: 'gemini-2.0-flash',
  groq: 'llama-3.3-70b-versatile',
};

const provider = () => config.ai.provider;
const model = () => config.ai.model || DEFAULT_MODELS[provider()] || 'gemini-2.0-flash';

const apiKey = () => (provider() === 'groq' ? config.ai.groqApiKey : config.ai.geminiApiKey);

const isConfigured = () => Boolean(apiKey());

function withTimeout() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

// ---- Gemini -------------------------------------------------------------- //
async function geminiGenerate({ system, prompt, json }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model()}:generateContent`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 2048,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const t = withTimeout();
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.ai.geminiApiKey },
      body: JSON.stringify(body),
      signal: t.signal,
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`Gemini API ${resp.status}: ${detail.slice(0, 200)}`);
    }
    const data = await resp.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
    if (!text) throw new Error('Gemini returned an empty response');
    return text;
  } finally {
    t.clear();
  }
}

// ---- Groq (OpenAI-compatible) -------------------------------------------- //
async function groqGenerate({ system, prompt, json }) {
  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const body = {
    model: model(),
    messages,
    temperature: 0.4,
    max_tokens: 2048,
    ...(json ? { response_format: { type: 'json_object' } } : {}),
  };

  const t = withTimeout();
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.groqApiKey}`,
      },
      body: JSON.stringify(body),
      signal: t.signal,
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`Groq API ${resp.status}: ${detail.slice(0, 200)}`);
    }
    const data = await resp.json();
    const text = (data.choices?.[0]?.message?.content || '').trim();
    if (!text) throw new Error('Groq returned an empty response');
    return text;
  } finally {
    t.clear();
  }
}

function generate(opts) {
  return provider() === 'groq' ? groqGenerate(opts) : geminiGenerate(opts);
}

async function generateText({ system, prompt }) {
  if (!isConfigured()) throw new Error('AI provider not configured');
  return generate({ system, prompt, json: false });
}

async function generateJson({ system, prompt }) {
  if (!isConfigured()) throw new Error('AI provider not configured');
  const raw = await generate({ system, prompt, json: true });
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('AI response was not valid JSON');
  }
}

module.exports = { isConfigured, generateText, generateJson, provider, model };
