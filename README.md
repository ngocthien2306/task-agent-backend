# 🤖 AI Work Assistant Backend

An intelligent Node.js backend service that provides conversational AI capabilities, task management, and audio generation with lip-sync for 3D avatar interactions.

## ✨ Features

- 🎯 **Intent Classification**: Automatically classifies user input into conversation, task creation, scheduling, or task operations
- 🎵 **Audio Generation**: Text-to-speech with OpenAI TTS and lip-sync generation using Rhubarb
- 💬 **Conversational AI**: Smart conversation handling with context awareness
- 📋 **Task Management**: Integration with Python API for task operations
- 🔄 **Background Jobs**: Asynchronous processing of database operations
- 🌍 **Cross-Platform**: Supports Windows, macOS, and Linux
- 📊 **Session Management**: Maintains conversation history and context

## 🏗️ Architecture

### Clean Modular Structure
```
src/
├── config/           # Centralized configuration
├── controllers/      # HTTP request handlers
├── services/         # Business logic (Audio, AI, Classification)
├── utils/           # Reusable utility functions
├── middleware/      # Express middleware
└── routes/          # API route definitions
```

### Core Services
- **AudioService**: TTS generation and lip-sync processing
- **IntentClassifier**: AI-powered intent detection and routing
- **ConversationService**: OpenAI integration and session management

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- FFmpeg (for audio processing)
- Rhubarb lip-sync (platform-specific binary)
- OpenAI API key

### Installation
```bash
# Clone and install dependencies
cd task-agent-backend
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys
```

### Environment Variables
```bash
# Required
OPENAI_API_KEY=your_openai_api_key_here
PYTHON_API_URL=http://localhost:8000

# Optional
PORT=3000
NODE_ENV=development
```

### Running the Server
```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

## 📡 API Endpoints

### Main Chat Endpoint
```http
POST /chat
Content-Type: application/json

{
  "message": "Nhắc tôi họp team lúc 2 giờ chiều mai",
  "sessionId": "user_session_123",
  "user_id": "user_456"
}
```

**Response:**
```json
{
  "messages": [
    {
      "text": "Được rồi! Tôi sẽ nhắc bạn họp team lúc 2h chiều mai nhé!",
      "audio": "base64_encoded_audio",
      "lipsync": { "mouthCues": [...] },
      "facialExpression": "smile",
      "animation": "Talking_0"
    }
  ],
  "metadata": {
    "mode": "simple_task",
    "intent": "create_reminder",
    "confidence": 0.94,
    "classification": {
      "intentType": "simple_task",
      "action": "create",
      "taskIdentifier": null,
      "classificationConfidence": 0.94
    },
    "routing": {
      "route": "process-conversation",
      "intentType": "simple_task"
    }
  }
}
```

### Background Jobs
```http
# Check job queue status
GET /job-status

# Manually trigger job processing
POST /process-jobs
```

## 🎯 Intent Classification

The system automatically classifies user input into these categories:

### Core Intents
- **`conversation`**: General chat, greetings, emotional sharing
- **`simple_task`**: Create simple tasks or reminders
- **`scheduling`**: Complex scheduling with multiple tasks

### Task Operations (Coming Soon)
- **`task_query`**: View/search existing tasks
- **`task_update`**: Update task status or details
- **`task_delete`**: Delete specific tasks
- **`task_stats`**: Get task statistics and reports
- **`task_priority`**: Change task priorities
- **`task_reminder`**: Set up task reminders

### Example Classifications
```bash
"Chào bạn!"                    → conversation
"Nhắc tôi gọi khách hàng"       → simple_task
"Sắp xếp lịch hôm nay"         → scheduling
"Task hôm nay có gì?"           → task_query
"Hoàn thành task mua sữa"       → task_update
```

## 🔄 Confirmation Flow System

### Problem Solved
Previously, when users provided incomplete information (like "Meeting 10h, báo cáo quarterly, gọi 3 khách hàng"), the system would immediately send incomplete data to Python API, creating tasks without full details.

### Solution: Smart Confirmation Flow

The system now detects when additional information is needed and holds the API call until confirmed:

#### Flow Example:
```
1. User: "Hôm nay tôi có meeting team 10h, cần viết báo cáo quarterly, và gọi 3 khách hàng. Sắp xếp giúp tôi!"

2. AI Response: 
   - needsConfirmation: true
   - confirmationType: "scheduling_details"
   - Message: "Tôi thấy bạn có 3 việc cần làm! Meeting team 10h đã rõ. 
             Còn báo cáo quarterly deadline khi nào? Và 3 khách hàng cần gọi là ai?"
   - Status: HELD (not sent to Python API)

3. User: "Báo cáo deadline thứ 6, khách hàng là ABC Corp, XYZ Ltd, và John Doe"

4. System: 
   - Detects confirmation response
   - Merges with pending data
   - Sends complete information to Python API
   - Creates tasks with full details
```

#### Confirmation Types:
- **`scheduling_details`**: Missing time information
- **`task_clarification`**: Task lacks important details  
- **`time_conflicts`**: Detected scheduling conflicts

#### Response Metadata:
```json
{
  "metadata": {
    "processing": "awaiting_confirmation",
    "needsConfirmation": true,
    "confirmationType": "scheduling_details"
  }
}
```

#### Benefits:
- ✅ No incomplete tasks created
- ✅ Better user experience with guided information gathering
- ✅ Complete data sent to Python API only once
- ✅ 30-minute expiry for pending confirmations

## 🎵 Audio System

### Supported Features
- **Text-to-Speech**: OpenAI TTS API with multiple voices
- **Format Conversion**: MP3 → WAV using FFmpeg
- **Lip-Sync Generation**: Rhubarb phonetic analysis
- **Platform Detection**: Automatic binary selection

### Audio Processing Flow
```
User Text → OpenAI TTS → MP3 File → FFmpeg → WAV File → Rhubarb → Lip-sync JSON
```

### Platform Support
- **Windows**: Uses `rhubarb.exe`
- **macOS**: Uses `arch -x86_64 ./bin/rhubarb` (Rosetta)
- **Linux**: Uses `./bin/rhubarb`

## 🔧 Configuration

All configuration is centralized in `src/config/index.js`:

```javascript
export const config = {
  port: process.env.PORT || 3000,
  
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-4o-mini",
    maxTokens: 2000,
    temperature: 0.7,
    ttsVoice: "nova"
  },
  
  pythonApi: {
    url: process.env.PYTHON_API_URL || "https://task-agent-api.ngrok.dev",
    timeout: 10000
  },
  
  audio: {
    outputDir: "audios",
    formats: {
      input: "mp3",
      processing: "wav", 
      metadata: "json"
    }
  }
  // ...
};
```

## 🔄 Integration with Python API

The Node.js backend integrates with a Python FastAPI service for:
- Task persistence and management
- Advanced scheduling algorithms
- Database operations
- Analytics and reporting

### API Communication
```javascript
// Background job processing
POST {pythonApiUrl}/api/v1/process-conversation
{
  "parsed_response": { /* AI response */ },
  "user_input": "user message",
  "user_id": "user_123",
  "session_id": "session_456"
}
```

## 🛠️ Development

### Project Structure
```
task-agent-backend/
├── src/
│   ├── config/index.js              # Configuration management
│   ├── controllers/
│   │   └── chatController.js        # Chat endpoint logic
│   ├── services/
│   │   ├── audioService.js          # Audio & TTS generation
│   │   ├── conversationService.js   # OpenAI & background jobs
│   │   └── intentClassifier.js      # Intent classification
│   ├── utils/
│   │   ├── fileHelper.js           # File operations & platform utils
│   │   └── responseHelper.js       # Response formatting
│   ├── middleware/
│   │   └── errorHandler.js         # Global error handling
│   └── routes/
│       └── chatRoutes.js           # Route definitions
├── index.js                        # Main server file
├── package.json                    # Dependencies & scripts
├── audios/                         # Generated audio files
└── bin/                           # Platform-specific binaries
```

### Key Design Principles
- **Separation of Concerns**: Clear separation between HTTP, business logic, and utilities
- **Configuration Management**: Centralized config with environment variables
- **Error Handling**: Comprehensive error handling with audio feedback
- **Async Processing**: Background jobs for non-blocking operations
- **Platform Agnostic**: Cross-platform audio processing

### Adding New Features
1. **New Intent**: Add to `IntentClassifier` classification rules
2. **New Service**: Create in `src/services/` with proper class structure
3. **New Route**: Add to `src/routes/` and register in main file
4. **New Config**: Add to `src/config/index.js`

## 🧪 Testing

```bash
# Test with curl
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!", "sessionId": "test", "user_id": "test_user"}'

# Check server status
curl http://localhost:3000/

# Monitor background jobs
curl http://localhost:3000/job-status
```

## 📋 TODO / Roadmap

### Immediate
- [ ] Implement task operation handlers (query, update, delete, stats)
- [ ] Add request validation middleware
- [ ] Add comprehensive logging
- [ ] Unit tests for services

### Future
- [ ] WebSocket support for real-time updates
- [ ] Multiple TTS voice options
- [ ] Audio caching and optimization
- [ ] Rate limiting and security middleware
- [ ] Docker containerization
- [ ] API documentation with Swagger

## 🐛 Troubleshooting

### Common Issues

**Audio Generation Fails**
```bash
# Check FFmpeg installation
ffmpeg -version

# Check Rhubarb binary
./bin/rhubarb --help
```

**OpenAI API Errors**
- Verify API key in `.env`
- Check API rate limits
- Ensure sufficient credits

**Python API Connection**
- Verify Python service is running
- Check `PYTHON_API_URL` configuration
- Review network connectivity

### Debug Mode
```bash
# Enable detailed logging
DEBUG=* npm run dev

# Check background job processing
curl http://localhost:3000/job-status
```

## 📄 License

[Your License Here]

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

---

**Built with ❤️ for intelligent task management and 3D avatar interactions**