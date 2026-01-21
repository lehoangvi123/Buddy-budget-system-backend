const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Endpoint để xử lý chat request
app.post('/api/chat', async (req, res) => {
  try {
    const { message, chatHistory, financialContext } = req.body;

    // Validate request
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Call OpenAI API
    // Build messages array with system prompt
    const messages = [];
    
    // Add system prompt with financial context if provided
    if (financialContext) {
      messages.push({
        role: 'system',
        content: financialContext
      });
    } else {
      messages.push({
        role: 'system',
        content: 'You are a helpful financial assistant.'
      });
    }
    
    // Add chat history - validate each message
    if (chatHistory && Array.isArray(chatHistory)) {
      for (const msg of chatHistory) {
        // Only add valid messages with both role and content
        if (msg.role && msg.content && typeof msg.content === 'string' && msg.content.trim()) {
          messages.push({
            role: msg.role,
            content: msg.content
          });
        }
      }
    }
    
    // Add current user message
    messages.push({
      role: 'user',
      content: message
    });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: req.body.model || 'gpt-4o-mini',  // Support model selection from client
        messages: messages,
        max_tokens: 500,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const error = await response.json();
      return res.status(response.status).json({ error: error.error?.message || 'OpenAI API error' });
    }

    const data = await response.json();
    res.json({
      message: data.choices[0].message.content,
      usage: data.usage
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});