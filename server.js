const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

console.log('=== Server Starting ===');
console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? '✅ Loaded' : '❌ Not found');
console.log('GROQ_API_KEY:  ', process.env.GROQ_API_KEY   ? '✅ Loaded' : '❌ Not found');
console.log('PORT:', PORT);
console.log('=======================');

// ============================================================
// ✅ GEMINI HANDLER (Primary)
// ============================================================
async function callGemini(messages, systemPrompt) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');

  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  // Build contents array (Gemini format)
  const contents = [];

  for (const msg of messages) {
    if (!msg.content || !msg.content.trim()) continue;
    // Gemini dùng 'user' và 'model' (không dùng 'assistant')
    const role = msg.role === 'assistant' ? 'model' : 'user';
    if (role !== 'user' && role !== 'model') continue;
    contents.push({
      role: role,
      parts: [{ text: msg.content.trim() }]
    });
  }

  const body = {
    contents: contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
      topP: 0.9,
    }
  };

  // Thêm system prompt nếu có
  if (systemPrompt) {
    body.systemInstruction = {
      parts: [{ text: systemPrompt }]
    };
  }

  const response = await axios.post(GEMINI_URL, body, {
    timeout: 60000,
    headers: { 'Content-Type': 'application/json' },
    validateStatus: s => s < 600
  });

  if (response.status !== 200) {
    throw new Error(`Gemini error ${response.status}: ${JSON.stringify(response.data)}`);
  }

  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty response');

  return { text, provider: 'gemini' };
}

// ============================================================
// ✅ GROQ HANDLER (Fallback)
// ============================================================
async function callGroq(messages, systemPrompt) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured');

  const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
  const selectedModel = 'llama-3.3-70b-versatile';

  const groqMessages = [];

  // System prompt
  if (systemPrompt) {
    groqMessages.push({ role: 'system', content: systemPrompt });
  }

  // History
  for (const msg of messages) {
    if (!msg.content || !msg.content.trim()) continue;
    const role = msg.role === 'model' ? 'assistant' : msg.role;
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;
    groqMessages.push({ role, content: msg.content.trim() });
  }

  const response = await axios.post(
    GROQ_URL,
    {
      messages: groqMessages,
      model: selectedModel,
      temperature: 0.7,
      max_tokens: 800,
      top_p: 0.9,
      stream: false,
    },
    {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      validateStatus: s => s < 600
    }
  );

  if (response.status !== 200) {
    throw new Error(`Groq error ${response.status}: ${JSON.stringify(response.data)}`);
  }

  const text = response.data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq returned empty response');

  return { text, provider: 'groq' };
}

// ============================================================
// ✅ /api/chat — Gemini primary, Groq fallback
// ============================================================
app.post('/api/chat', async (req, res) => {
  try {
    const { message, chatHistory, financialContext } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Build history messages
    const historyMessages = [];
    if (chatHistory && Array.isArray(chatHistory)) {
      for (const msg of chatHistory) {
        if (!msg.content || typeof msg.content !== 'string' || !msg.content.trim()) continue;
        historyMessages.push({ role: msg.role, content: msg.content.trim() });
      }
    }

    // Add current user message
    historyMessages.push({ role: 'user', content: message });

    console.log(`[Chat] Message: "${message.substring(0, 60)}..."`);

    let result = null;

    // ✅ Thử Gemini trước
    try {
      console.log('[Chat] Trying Gemini...');
      result = await callGemini(historyMessages, financialContext || '');
      console.log(`[Chat] ✅ Gemini success (${result.text.length} chars)`);
    } catch (geminiErr) {
      console.warn('[Chat] ⚠️ Gemini failed:', geminiErr.message);

      // ✅ Fallback sang Groq
      try {
        console.log('[Chat] Trying Groq fallback...');
        result = await callGroq(historyMessages, financialContext || '');
        console.log(`[Chat] ✅ Groq fallback success (${result.text.length} chars)`);
      } catch (groqErr) {
        console.error('[Chat] ❌ Both providers failed');
        console.error('Gemini error:', geminiErr.message);
        console.error('Groq error:', groqErr.message);
        return res.status(500).json({
          error: 'Cả hai AI provider đều không phản hồi. Vui lòng thử lại!',
          details: {
            gemini: geminiErr.message,
            groq: groqErr.message
          }
        });
      }
    }

    return res.status(200).json({
      message: result.text,
      provider: result.provider,
    });

  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// ============================================================
// ✅ Health check
// ============================================================
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    groqConfigured: !!process.env.GROQ_API_KEY,
    nodeVersion: process.version,
    uptime: process.uptime()
  });
});

// ============================================================
// ✅ Test Gemini
// ============================================================
app.get('/api/test-gemini', async (req, res) => {
  try {
    const result = await callGemini(
      [{ role: 'user', content: 'Xin chào! Giới thiệu bản thân bằng tiếng Việt ngắn gọn.' }],
      'Bạn là BuddyAI, trợ lý tài chính thông minh.'
    );
    res.json({ success: true, message: 'Gemini hoạt động tốt!', testResponse: result.text });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// ✅ Test Groq
// ============================================================
app.get('/api/test-groq', async (req, res) => {
  try {
    const result = await callGroq(
      [{ role: 'user', content: 'Xin chào! Giới thiệu bản thân bằng tiếng Việt ngắn gọn.' }],
      'Bạn là BuddyAI, trợ lý tài chính thông minh.'
    );
    res.json({ success: true, message: 'Groq hoạt động tốt!', testResponse: result.text });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📍 Health: http://localhost:${PORT}/health`);
  console.log(`🧪 Test Gemini: http://localhost:${PORT}/api/test-gemini`);
  console.log(`🧪 Test Groq:   http://localhost:${PORT}/api/test-groq`);
  console.log(`💬 Chat: POST http://localhost:${PORT}/api/chat\n`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received: shutting down');
  process.exit(0);
});