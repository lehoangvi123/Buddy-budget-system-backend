const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Endpoint để xử lý chat request với Gemini
app.post('/api/chat', async (req, res) => {
  try {
    const { message, chatHistory, financialContext } = req.body;

    // Validate request
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // ✅ GEMINI API KEY
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Gemini API key not configured' });
    }

    // ✅ Chọn model (mặc định dùng flash vì rẻ + nhanh)
    const model = req.body.model || 'gemini-1.5-flash';
    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

    // ✅ Build contents array cho Gemini
    const contents = [];
    
    // Thêm system prompt + financial context vào đầu (như một user message)
    if (financialContext) {
      contents.push({
        role: 'user',
        parts: [{ text: financialContext }]
      });
      // Gemini cần response từ model sau system prompt
      contents.push({
        role: 'model',
        parts: [{ text: 'Tôi hiểu. Tôi sẽ giúp bạn với vai trò trợ lý tài chính dựa trên thông tin này.' }]
      });
    }

    // Thêm chat history (chuyển role 'assistant' thành 'model')
    if (chatHistory && Array.isArray(chatHistory)) {
      for (const msg of chatHistory) {
        if (msg.role && msg.content && typeof msg.content === 'string' && msg.content.trim()) {
          contents.push({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          });
        }
      }
    }

    // Thêm tin nhắn hiện tại của user
    contents.push({
      role: 'user',
      parts: [{ text: message }]
    });

    // ✅ Gọi Gemini API
    const response = await axios.post(GEMINI_URL, {
      contents: contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 500,
        topP: 0.8,
        topK: 40
      },
      safetySettings: [
        {
          category: 'HARM_CATEGORY_HARASSMENT',
          threshold: 'BLOCK_NONE'
        },
        {
          category: 'HARM_CATEGORY_HATE_SPEECH',
          threshold: 'BLOCK_NONE'
        },
        {
          category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          threshold: 'BLOCK_NONE'
        },
        {
          category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
          threshold: 'BLOCK_NONE'
        }
      ]
    });

    // ✅ Trích xuất response từ Gemini
    const aiMessage = response.data.candidates[0].content.parts[0].text;
    
    res.json({
      message: aiMessage,
      usage: {
        promptTokens: response.data.usageMetadata?.promptTokenCount || 0,
        completionTokens: response.data.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: response.data.usageMetadata?.totalTokenCount || 0
      }
    });

  } catch (error) {
    console.error('❌ Gemini Error:', error.response?.data || error.message);
    
    // Trả về lỗi chi tiết hơn
    const errorMessage = error.response?.data?.error?.message || error.message || 'Internal server error';
    res.status(500).json({ 
      error: errorMessage,
      details: error.response?.data
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    geminiConfigured: !!process.env.GEMINI_API_KEY
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ Gemini API: ${process.env.GEMINI_API_KEY ? 'Configured' : '❌ Missing'}`);
});