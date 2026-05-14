// ==========================
// 📌 Import & Config
// ==========================
const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================
// 📌 Middleware
// ==========================
app.use(cors({
  origin: '*', // hoặc thay bằng domain web của bạn: 'https://yourdomain.com'
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// ==========================
// 📌 Startup Logs
// ==========================
console.log('=== Server Starting ===');
console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? '✅ Loaded' : '❌ Not found');
console.log('GROQ_API_KEY:  ', process.env.GROQ_API_KEY   ? '✅ Loaded' : '❌ Not found');
console.log('PORT:', PORT);
console.log('=======================');

// ==========================
// 📌 Gemini Handler
// ==========================
async function callGemini(messages, systemPrompt) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');

  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  const contents = messages.map(msg => {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    return { role, parts: [{ text: msg.content.trim() }] };
  });

  const body = {
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048, topP: 0.9 }
  };

  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  const response = await axios.post(GEMINI_URL, body, {
    timeout: 60000,
    headers: { 'Content-Type': 'application/json' }
  });

  if (response.status !== 200) throw new Error(`Gemini error ${response.status}: ${JSON.stringify(response.data)}`);

  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty response');

  return { text, provider: 'gemini' };
}

// ==========================
// 📌 Groq Handler
// ==========================
async function callGroq(messages, systemPrompt) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured');

  const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
  const selectedModel = 'llama-3.3-70b-versatile';

  const groqMessages = [];
  if (systemPrompt) groqMessages.push({ role: 'system', content: systemPrompt });
  messages.forEach(msg => groqMessages.push({ role: msg.role, content: msg.content.trim() }));

  const response = await axios.post(GROQ_URL, {
    messages: groqMessages,
    model: selectedModel,
    temperature: 0.7,
    max_tokens: 800,
    top_p: 0.9,
    stream: false
  }, {
    timeout: 30000,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` }
  });

  if (response.status !== 200) throw new Error(`Groq error ${response.status}: ${JSON.stringify(response.data)}`);

  const text = response.data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq returned empty response');

  return { text, provider: 'groq' };
}

// ==========================
// 📌 Chat Endpoint
// ==========================
app.post('/api/chat', async (req, res) => {
  try {
    const { message, chatHistory, financialContext } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const historyMessages = (chatHistory || []).map(msg => ({ role: msg.role, content: msg.content.trim() }));
    historyMessages.push({ role: 'user', content: message });

    let result;
    try {
      result = await callGroq(historyMessages, financialContext || '');
    } catch (groqErr) {
      try {
        result = await callGemini(historyMessages, financialContext || '');
      } catch (geminiErr) {
        return res.status(500).json({ error: 'Both providers failed', details: { groq: groqErr.message, gemini: geminiErr.message } });
      }
    }

    res.json({ message: result.text, provider: result.provider });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// ==========================
// 📌 Health & Test Endpoints
// ==========================
app.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString() }));
app.get('/api/test-gemini', async (req, res) => {
  try {
    const result = await callGemini([{ role: 'user', content: 'Xin chào!' }], 'Bạn là BuddyAI');
    res.json({ success: true, testResponse: result.text });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});
app.get('/api/test-groq', async (req, res) => {
  try {
    const result = await callGroq([{ role: 'user', content: 'Xin chào!' }], 'Bạn là BuddyAI');
    res.json({ success: true, testResponse: result.text });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ==========================
// 📌 Error Handling
// ==========================
app.use((req, res) => res.status(404).json({ error: 'Endpoint not found' }));
app.use((err, req, res, next) => res.status(500).json({ error: 'Internal server error', details: err.message }));

// ==========================
// 📌 Start Server
// ==========================
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
