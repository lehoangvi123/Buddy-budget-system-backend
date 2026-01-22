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
console.log('GROQ_API_KEY:', process.env.GROQ_API_KEY ? '✅ Loaded' : '❌ Not found');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', PORT);
console.log('=======================');

// Endpoint để xử lý chat request với Groq
app.post('/api/chat', async (req, res) => {
  try {
    const { message, chatHistory, financialContext, model } = req.body;

    // Validate request
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // ✅ GROQ API KEY
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    
    if (!GROQ_API_KEY) { 
      console.error('❌ GROQ_API_KEY not configured!');
      return res.status(500).json({ error: 'Groq API key not configured' });
    }

    // ✅ Chọn model Groq (mặc định llama-3.3-70b - MIỄN PHÍ & MẠNH)
    const selectedModel = model || 'llama-3.3-70b-versatile';
    const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

    console.log(`[Chat] Using model: ${selectedModel}`);
    console.log(`[Chat] User message: ${message.substring(0, 50)}...`);

    // ✅ Build messages array cho Groq (OpenAI-compatible format)
    const messages = [];
    
    // Thêm system prompt + financial context
    if (financialContext) {
      messages.push({
        role: 'system',
        content: financialContext
      });
    }

    // Thêm chat history
    if (chatHistory && Array.isArray(chatHistory)) {
      for (const msg of chatHistory) {
        // Validate message
        if (!msg.content || typeof msg.content !== 'string' || !msg.content.trim()) {
          continue;
        }
        
        // Groq dùng format OpenAI: 'user', 'assistant', 'system'
        const role = msg.role === 'model' ? 'assistant' : msg.role;
        
        // Chỉ chấp nhận role hợp lệ
        if (role !== 'user' && role !== 'assistant' && role !== 'system') {
          continue;
        }

        messages.push({
          role: role,
          content: msg.content.trim()
        });
      }
    }

    // Thêm tin nhắn hiện tại của user
    messages.push({
      role: 'user',
      content: message
    });

    console.log(`[Chat] Sending ${messages.length} messages to Groq...`);

    // ✅ Gọi Groq API
    const response = await axios.post(
      GROQ_URL,
      {
        messages: messages,
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
        validateStatus: function (status) {
          return status >= 200 && status < 500;
        }
      }
    );

    // ✅ Kiểm tra response type
    const contentType = response.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      console.error('❌ Groq returned non-JSON response:', response.data);
      return res.status(500).json({ 
        error: 'Groq API returned invalid response format',
        details: 'Expected JSON but got ' + contentType
      });
    }

    // Kiểm tra HTTP status
    if (response.status !== 200) {
      console.error('❌ Groq API error:', response.status, response.data);
      return res.status(response.status).json({ 
        error: response.data?.error?.message || 'Groq API error',
        details: response.data
      });
    }

    // ✅ Kiểm tra response từ Groq
    if (!response.data || !response.data.choices || response.data.choices.length === 0) {
      console.error('❌ No choices in Groq response:', response.data);
      return res.status(500).json({ 
        error: 'Groq không trả về phản hồi hợp lệ',
        details: response.data
      });
    }

    const choice = response.data.choices[0];
    const aiMessage = choice.message?.content;
    
    if (!aiMessage) {
      console.error('❌ No content in Groq response:', choice);
      return res.status(500).json({ 
        error: 'Groq không trả về nội dung text',
        details: choice
      });
    }

    console.log(`[Chat] ✅ Response received (${aiMessage.length} chars)`);
    
    // ✅ ALWAYS return JSON
    return res.status(200).json({
      message: aiMessage,
      model: selectedModel,
      usage: {
        promptTokens: response.data.usage?.prompt_tokens || 0,
        completionTokens: response.data.usage?.completion_tokens || 0,
        totalTokens: response.data.usage?.total_tokens || 0
      }
    });

  } catch (error) {
    console.error('❌ Groq Error:', error.response?.data || error.message);
    
    // Xử lý các lỗi phổ biến
    let errorMessage = 'Internal server error';
    let statusCode = 500;
    let errorDetails = null;

    if (error.code === 'ECONNABORTED') {
      errorMessage = 'Request timeout - Groq API mất quá nhiều thời gian';
      statusCode = 504;
    } else if (error.response) {
      statusCode = error.response.status;
      errorDetails = error.response.data;
      
      // Xử lý các lỗi phổ biến của Groq
      if (statusCode === 400) {
        errorMessage = 'Invalid request to Groq API';
        if (errorDetails?.error?.message) {
          errorMessage = errorDetails.error.message;
        }
      } else if (statusCode === 401) {
        errorMessage = 'API key không hợp lệ';
      } else if (statusCode === 403) {
        errorMessage = 'API key không có quyền truy cập';
      } else if (statusCode === 429) {
        errorMessage = 'Đã vượt quá giới hạn request. Vui lòng thử lại sau';
      } else if (statusCode === 500) {
        errorMessage = 'Groq API đang gặp sự cố';
      } else {
        errorMessage = errorDetails?.error?.message || 'Groq API error';
      }
      
      console.error('Groq API Error Details:', {
        status: statusCode,
        data: errorDetails
      });
    } else if (error.request) {
      errorMessage = 'Không thể kết nối với Groq API';
      statusCode = 503;
    } else {
      errorMessage = error.message || 'Unknown error';
    }

    // ✅ ALWAYS return JSON even on error
    return res.status(statusCode).json({ 
      error: errorMessage,
      details: errorDetails || error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    groqConfigured: !!process.env.GROQ_API_KEY,
    nodeVersion: process.version,
    uptime: process.uptime()
  });
});

// Test Groq connection endpoint
app.get('/api/test-groq', async (req, res) => {
  try {
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    
    if (!GROQ_API_KEY) {
      return res.status(500).json({ 
        success: false, 
        error: 'GROQ_API_KEY not configured' 
      });
    }

    const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

    const response = await axios.post(
      GROQ_URL,
      {
        messages: [
          {
            role: 'system',
            content: 'You are a helpful AI assistant. Always respond in Vietnamese.'
          },
          {
            role: 'user',
            content: 'Xin chào! Hãy giới thiệu về bản thân bằng tiếng Việt.'
          }
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0,
        max_tokens: 100,
        stream: false
      },
      {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        validateStatus: function (status) {
          return status >= 200 && status < 500;
        }
      }
    );

    if (response.status !== 200) {
      return res.status(response.status).json({
        success: false,
        error: response.data?.error?.message || 'Groq API error',
        details: response.data
      });
    }

    const aiMessage = response.data.choices[0].message.content;

    res.json({
      success: true,
      message: 'Groq API hoạt động tốt!',
      testResponse: aiMessage,
      model: 'llama-3.3-70b-versatile'
    });

  } catch (error) {
    console.error('Test Groq Error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.error?.message || error.message,
      details: error.response?.data
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    details: err.message
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`🧪 Test Groq: http://localhost:${PORT}/api/test-groq`);
  console.log(`💬 Chat endpoint: POST http://localhost:${PORT}/api/chat\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  process.exit(0);
});