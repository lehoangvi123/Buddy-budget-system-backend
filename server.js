const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// ✅ Log khi server khởi động
console.log('=== Server Starting ===');
console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? '✅ Loaded' : '❌ Not found');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', PORT);
console.log('=======================');

// Endpoint để xử lý chat request với Gemini
app.post('/api/chat', async (req, res) => {
  try {
    const { message, chatHistory, financialContext, model } = req.body;

    // Validate request
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // ✅ GEMINI API KEY
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    
    if (!GEMINI_API_KEY) { 
      console.error('❌ GEMINI_API_KEY not configured!');
      return res.status(500).json({ error: 'Gemini API key not configured' });
    }

    // ✅ Chọn model (mặc định dùng flash-latest vì miễn phí + nhanh)
    const selectedModel = model || 'gemini-1.5-flash-latest';
    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${GEMINI_API_KEY}`;

    console.log(`[Chat] Using model: ${selectedModel}`);
    console.log(`[Chat] User message: ${message.substring(0, 50)}...`);

    // ✅ Build contents array cho Gemini
    const contents = [];
    
    // Thêm system prompt + financial context vào đầu
    if (financialContext) {
      contents.push({
        role: 'user',
        parts: [{ text: financialContext }]
      });
      // Gemini yêu cầu phải có response từ model sau mỗi user message
      contents.push({
        role: 'model',
        parts: [{ text: 'Tôi hiểu rồi! Tôi sẽ giúp bạn phân tích tài chính dựa trên dữ liệu này. Bạn muốn hỏi gì?' }]
      });
    }

    // Thêm chat history
    if (chatHistory && Array.isArray(chatHistory)) {
      for (const msg of chatHistory) {
        // Validate message
        if (!msg.content || typeof msg.content !== 'string' || !msg.content.trim()) {
          continue;
        }
        
        // Chuyển role 'assistant' thành 'model' cho Gemini
        const role = msg.role === 'assistant' ? 'model' : msg.role;
        
        // Gemini chỉ chấp nhận role 'user' hoặc 'model'
        if (role !== 'user' && role !== 'model') {
          continue;
        }

        contents.push({
          role: role,
          parts: [{ text: msg.content }]
        });
      }
    }

    // Thêm tin nhắn hiện tại của user
    contents.push({
      role: 'user',
      parts: [{ text: message }]
    });

    console.log(`[Chat] Sending ${contents.length} messages to Gemini...`);

    // ✅ Gọi Gemini API
    const response = await axios.post(
      GEMINI_URL, 
      {
        contents: contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 800,  // Tăng lên để response đầy đủ hơn
          topP: 0.9,
          topK: 40
        },
        safetySettings: [
          {
            category: 'HARM_CATEGORY_HARASSMENT',
            threshold: 'BLOCK_ONLY_HIGH'
          },
          {
            category: 'HARM_CATEGORY_HATE_SPEECH',
            threshold: 'BLOCK_ONLY_HIGH'
          },
          {
            category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
            threshold: 'BLOCK_ONLY_HIGH'
          },
          {
            category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
            threshold: 'BLOCK_ONLY_HIGH'
          }
        ]
      },
      {
        timeout: 30000,  // 30 seconds timeout
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    // ✅ Kiểm tra response từ Gemini
    if (!response.data || !response.data.candidates || response.data.candidates.length === 0) {
      console.error('❌ No candidates in Gemini response:', response.data);
      return res.status(500).json({ 
        error: 'Gemini không trả về phản hồi hợp lệ',
        details: response.data
      });
    }

    const candidate = response.data.candidates[0];
    
    // Kiểm tra finishReason
    if (candidate.finishReason && candidate.finishReason !== 'STOP') {
      console.warn('⚠️ Unusual finish reason:', candidate.finishReason);
    }

    // Trích xuất text từ response
    const aiMessage = candidate.content?.parts?.[0]?.text;
    
    if (!aiMessage) {
      console.error('❌ No text in Gemini response:', candidate);
      return res.status(500).json({ 
        error: 'Gemini không trả về nội dung text',
        details: candidate
      });
    }

    console.log(`[Chat] ✅ Response received (${aiMessage.length} chars)`);
    
    res.json({
      message: aiMessage,
      model: selectedModel,
      usage: {
        promptTokens: response.data.usageMetadata?.promptTokenCount || 0,
        completionTokens: response.data.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: response.data.usageMetadata?.totalTokenCount || 0
      }
    });

  } catch (error) {
    console.error('❌ Gemini Error:', error.response?.data || error.message);
    
    // Xử lý các lỗi phổ biến
    let errorMessage = 'Internal server error';
    let statusCode = 500;

    if (error.code === 'ECONNABORTED') {
      errorMessage = 'Request timeout - Gemini API mất quá nhiều thời gian';
      statusCode = 504;
    } else if (error.response) {
      // Lỗi từ Gemini API
      errorMessage = error.response.data?.error?.message || 'Gemini API error';
      statusCode = error.response.status;
      
      // Log chi tiết lỗi
      console.error('Gemini API Error Details:', {
        status: error.response.status,
        data: error.response.data
      });
    } else if (error.request) {
      errorMessage = 'Không thể kết nối với Gemini API';
      statusCode = 503;
    }

    res.status(statusCode).json({ 
      error: errorMessage,
      details: error.response?.data || error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    nodeVersion: process.version,
    uptime: process.uptime()
  });
});

// Test Gemini connection endpoint
app.get('/api/test-gemini', async (req, res) => {
  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ 
        success: false, 
        error: 'GEMINI_API_KEY not configured' 
      });
    }

    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

    const response = await axios.post(GEMINI_URL, {
      contents: [{
        role: 'user',
        parts: [{ text: 'Xin chào! Hãy trả lời bằng tiếng Việt.' }]
      }],
      generationConfig: {
        maxOutputTokens: 100
      }
    });

    const aiMessage = response.data.candidates[0].content.parts[0].text;

    res.json({
      success: true,
      message: 'Gemini API hoạt động tốt!',
      testResponse: aiMessage
    });

  } catch (error) {
    console.error('Test Gemini Error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.error?.message || error.message
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`🧪 Test Gemini: http://localhost:${PORT}/api/test-gemini`);
  console.log(`💬 Chat endpoint: POST http://localhost:${PORT}/api/chat\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  process.exit(0);
});