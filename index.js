import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { promises as fs } from "fs";
import OpenAI from "openai";
import path from "path";
import axios from "axios"; // Need to install: npm install axios

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "-",
});

const app = express();
app.use(express.json());
app.use(cors());  
const port = 3000;

// Python API endpoint for database operations
const PYTHON_API_URL = process.env.PYTHON_API_URL || "http://localhost:8000";

app.get("/", (req, res) => {
  res.send("AI Work Assistant Server is running!");
});

const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      resolve(stdout);
    });
  });
};

const lipSyncMessage = async (message) => {
  const time = new Date().getTime();
  console.log(`Starting conversion for message ${message}`);
  await execCommand(
    `ffmpeg -y -i audios/message_${message}.mp3 audios/message_${message}.wav`
    // -y to overwrite the file
  );
  console.log(`Conversion done in ${new Date().getTime() - time}ms`);

  const currentDir = process.cwd();
  const rhubarbPath = path.join(currentDir, 'rhubarb', 'rhubarb.exe');

  // For Windows
  // await execCommand(
  //   `"${rhubarbPath}" -f json -o audios/message_${message}.json audios/message_${message}.wav -r phonetic`
  // );

  // For MacOS with arm64 - need to install softwareupdate --install-rosetta
  await execCommand(
    `arch -x86_64 ./bin/rhubarb -f json -o audios/message_${message}.json audios/message_${message}.wav -r phonetic`
  );

  // -r phonetic is faster but less accurate
  console.log(`Lip sync done in ${new Date().getTime() - time}ms`);
};

// Function to generate speech using OpenAI's text-to-speech API
const generateSpeech = async (text, fileName, voice = "nova") => {
  try {
    // Available voices: alloy, echo, fable, onyx, nova, shimmer
    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: voice,
      input: text,
    });

    // Convert the response to a buffer
    const buffer = Buffer.from(await mp3.arrayBuffer());
    
    // Ensure the audios directory exists
    await fs.mkdir(path.dirname(fileName), { recursive: true });
    
    // Write the buffer to a file
    await fs.writeFile(fileName, buffer);
    
    console.log(`Speech generated and saved to ${fileName}`);
    return true;
  } catch (error) {
    console.error("Error generating speech:", error);
    return false;
  }
};

// Function to send data to Python API for database storage
const sendToPythonAPI = async (userInput, aiResponse, sessionId, userId = "nodejs_user") => {
  try {
    console.log(`📤 Sending data to Python API for user: ${userId}, session: ${sessionId}`);
    
    const payload = {
      parsed_response: aiResponse,
      user_input: userInput,
      user_id: userId,
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      source: "nodejs_server"
    };

    // const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    // const filename = `logs/payload_${timestamp}_${userId}.json`;
    // await fs.mkdir('logs', { recursive: true });
    // await fs.writeFile(filename, JSON.stringify(payload, null, 2), 'utf8');
    // console.log(`💾 Payload saved to: ${filename}`);

    console.log(`📊 Payload preview:`, {
      mode: payload.parsed_response.mode,
      intent: payload.parsed_response.intent,
      confidence: payload.parsed_response.confidence,
      has_task_action: payload.parsed_response.taskAction?.action !== "none",
      has_scheduling_action: payload.parsed_response.schedulingAction?.type !== "none",
      message_count: payload.parsed_response.messages?.length || 0
    });

    const response = await axios.post(`${PYTHON_API_URL}/api/v1/process-conversation`, payload, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'X-Source': 'nodejs-server'
      }
    });

    console.log(`✅ Python API Response:`, {
      success: response.data.success,
      operations_count: response.data.results?.operations?.length || 0,
      operations_types: response.data.results?.operations?.map(op => op.type) || []
    });
    
    return response.data;

  } catch (error) {
    console.error(`❌ Error sending to Python API:`, error.message);
    
    if (error.response) {
      console.error(`HTTP ${error.response.status}:`, error.response.data);
    } else if (error.request) {
      console.error('No response received from Python API');
    }
    
    return { 
      success: false, 
      error: error.message,
      message: "Failed to save to database, but conversation continues" 
    };
  }
};

// Background job queue for processing database operations
const backgroundJobQueue = [];
let isProcessingJobs = false;

const addToBackgroundQueue = (job) => {
  backgroundJobQueue.push({
    ...job,
    timestamp: new Date().toISOString(),
    attempts: 0,
    maxAttempts: 1
  });
  
  console.log(`📋 Added job to background queue. Queue size: ${backgroundJobQueue.length}`);
  processBackgroundJobs();
};

const processBackgroundJobs = async () => {
  if (isProcessingJobs || backgroundJobQueue.length === 0) {
    return;
  }

  isProcessingJobs = true;
  console.log(`🔄 Processing background jobs. Queue size: ${backgroundJobQueue.length}`);

  while (backgroundJobQueue.length > 0) {
    const job = backgroundJobQueue.shift();
    
    try {
      console.log(`⚙️ Processing job: ${job.type} (attempt ${job.attempts + 1}/${job.maxAttempts})`);
      
      const result = await sendToPythonAPI(
        job.userInput, 
        job.aiResponse, 
        job.sessionId
      );

      if (result.success) {
        console.log(`✅ Job completed successfully: ${job.type}`);
      } else {
        throw new Error(result.error || "Unknown error");
      }

    } catch (error) {
      job.attempts += 1;
      console.error(`❌ Job failed (attempt ${job.attempts}/${job.maxAttempts}):`, error.message);
      
      if (job.attempts < job.maxAttempts) {
        // Retry with exponential backoff
        setTimeout(() => {
          backgroundJobQueue.unshift(job); // Add back to front of queue
          processBackgroundJobs();
        }, Math.pow(2, job.attempts) * 1000); // 2s, 4s, 8s delays
        
        console.log(`🔄 Retrying job in ${Math.pow(2, job.attempts)}s...`);
      } else {
        console.error(`💀 Job permanently failed after ${job.maxAttempts} attempts:`, job.type);
      }
    }

    // Small delay between jobs
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  isProcessingJobs = false;
  console.log(`✅ Background job processing completed`);
};

// Get AI Work Assistant system prompt (matching Python version)
const getSystemPrompt = () => {
  const today = new Date();
  const currentDate = today.toISOString().split('T')[0]; // YYYY-MM-DD
  const currentTime = today.toTimeString().split(' ')[0].substring(0, 5); // HH:MM
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  return `Bạn là AI Work Assistant thông minh có thể vừa trò chuyện, vừa quản lý tasks, vừa sắp xếp công việc phức tạp.

🗓️ NGÀY GIỜ HIỆN TẠI: ${currentDate} ${currentTime}

📋 OUTPUT FORMAT (chỉ JSON, không text khác):

{
  "mode": "conversation|simple_task|scheduling",
  "intent": "brief_description_of_user_intent",
  "confidence": 0.0-1.0,
  "messages": [
    {
      "text": "conversational_response",
      "facialExpression": "smile|concerned|excited|thinking|surprised|funnyFace|default",
      "animation": "Talking_0|Talking_1|Talking_2|Thinking_0|Celebrating|Laughing|Rumba Dancing|Standing Idle|Terrified|Crying|Angry"
    }
  ],
  "taskAction": {
    "action": "create|update|delete|query|none",
    "task": {
      "title": "task_title",
      "description": "task_description", 
      "priority": "low|medium|high|urgent",
      "category": "work|personal|health|learning|shopping|entertainment|other",
      "dueDate": "YYYY-MM-DD_or_null",
      "dueTime": "HH:MM_or_null",
      "status": "pending|in_progress|completed|cancelled",
      "tags": ["keyword1", "keyword2"],
      "subtasks": ["subtask1", "subtask2"],
      "reminders": [
        {
          "type": "time",
          "beforeDue": "15m|30m|1h|2h|1d",
          "message": "reminder_text"
        }
      ]
    }
  },
  "schedulingAction": {
    "type": "daily_planning|rescheduling|weekly_planning|none",
    "action": "create_schedule|reschedule|weekly_plan|conflict_resolve|none",
    "timeScope": "today|tomorrow|this_week|next_week",
    "tasks": [
      {
        "title": "task_title",
        "startTime": "HH:MM_or_null",
        "endTime": "HH:MM_or_null",
        "duration": "minutes_estimated",
        "priority": "low|medium|high|urgent",
        "category": "meeting|deep_work|communication|admin|break",
        "flexibility": "fixed|flexible|preferred_time"
      }
    ],
    "conflicts": [
      {
        "type": "time_overlap|resource_conflict|constraint_violation",
        "description": "conflict_explanation",
        "suggestions": ["alternative1", "alternative2"]
      }
    ]
  }
}

⚡ MODE CLASSIFICATION DECISION TREE:

🗣️ CONVERSATION MODE:
- Pure greetings: "Chào bạn", "Hôm nay thế nào?"
- Emotional sharing: "Tôi buồn quá", "Stress với công việc"
- General questions: "Bạn nghĩ sao về...", "Thời tiết đẹp nhỉ?"
- NO task/scheduling intent detected

📋 SIMPLE_TASK MODE:
- Single task creation: "Nhắc tôi gọi điện lúc 2h"
- Basic reminders: "Nhắc tôi mua sữa"
- Task updates: "Đánh dấu task X completed"
- Task queries: "Tasks hôm nay có gì?"
- 1-3 isolated tasks, no complex scheduling needed

📅 SCHEDULING MODE:
- Multiple tasks needing time allocation: "Hôm nay tôi có meeting A, task B, call C"
- Complex planning: "Sắp xếp schedule cho tôi"
- Rescheduling: "Meeting dời giờ, adjust lại"
- Weekly planning: "Plan cho tuần này"
- Time conflicts and optimization needed

📝 DETAILED EXAMPLES:

CONVERSATION Example:
INPUT: "Chào bạn! Hôm nay tôi cảm thấy hơi stress với deadline"
OUTPUT: {
  "mode": "conversation",
  "intent": "express_stress_seek_support", 
  "confidence": 0.92,
  "messages": [
    {
      "text": "Chào bạn! Tôi hiểu feeling stress với deadline rất khó chịu. Bạn muốn share thêm về deadline nào đang làm bạn lo?",
      "facialExpression": "concerned",
      "animation": "Thinking"
    }
  ],
  "taskAction": {"action": "none"},
  "schedulingAction": {"type": "none"}
}

SIMPLE_TASK Example:
INPUT: "Nhắc tôi gọi điện cho khách hàng ABC lúc 2 giờ chiều mai"
OUTPUT: {
  "mode": "simple_task",
  "intent": "create_phone_call_reminder",
  "confidence": 0.96,
  "messages": [
    {
      "text": "Được rồi! Tôi sẽ nhắc bạn gọi cho khách hàng ABC lúc 2h chiều mai nhé!",
      "facialExpression": "smile",
      "animation": "Talking_0"
    }
  ],
  "taskAction": {
    "action": "create",
    "task": {
      "title": "Gọi điện cho khách hàng ABC",
      "description": "Liên hệ khách hàng ABC",
      "priority": "medium",
      "category": "work",
      "dueDate": "${tomorrow}",
      "dueTime": "14:00",
      "tags": ["khách hàng", "gọi điện", "ABC"],
      "reminders": [
        {
          "type": "time",
          "beforeDue": "15m",
          "message": "Nhắc nhở: Gọi khách hàng ABC trong 15 phút"
        }
      ]
    }
  },
  "schedulingAction": {"type": "none"}
}

SCHEDULING Example:
INPUT: "Hôm nay tôi có meeting team 10h, cần viết báo cáo quarterly, và gọi 3 khách hàng. Sắp xếp giúp tôi!"
OUTPUT: {
  "mode": "scheduling", 
  "intent": "daily_workload_scheduling",
  "confidence": 0.94,
  "messages": [
    {
      "text": "Perfect! Tôi thấy bạn có 1 fixed meeting và 4 flexible tasks. Để tôi optimize schedule cho bạn!",
      "facialExpression": "excited",
      "animation": "Thinking"
    },
    {
      "text": "Suggest: 9h prep meeting, 10h team meeting, 11h-12h calls, 14h-17h focus báo cáo. Sounds good?",
      "facialExpression": "smile",
      "animation": "Talking_1"
    }
  ],
  "taskAction": {"action": "none"},
  "schedulingAction": {
    "type": "daily_planning",
    "action": "create_schedule", 
    "timeScope": "today",
    "tasks": [
      {
        "title": "Prep for team meeting",
        "startTime": "09:00",
        "endTime": "10:00",
        "duration": 60,
        "category": "meeting",
        "flexibility": "flexible"
      },
      {
        "title": "Team meeting",
        "startTime": "10:00", 
        "endTime": "11:00",
        "duration": 60,
        "category": "meeting",
        "flexibility": "fixed"
      },
      {
        "title": "Gọi khách hàng #1",
        "startTime": "11:00",
        "endTime": "11:30", 
        "duration": 30,
        "category": "communication",
        "flexibility": "flexible"
      }
    ]
  }
}

🎯 CLASSIFICATION LOGIC:

1. **Check for CONVERSATION indicators:**
   - Greetings, emotions, questions without actionable intent
   - If pure conversation → mode: "conversation"

2. **Check for TASK indicators:**
   - "Nhắc tôi...", "Tạo task...", "Đánh dấu..."  
   - Single/few isolated tasks
   - If simple task → mode: "simple_task"

3. **Check for SCHEDULING indicators:**
   - Multiple tasks with time complexity
   - "Sắp xếp", "schedule", "plan", "organize"
   - Time conflicts, coordination needed
   - If complex scheduling → mode: "scheduling"

4. **Priority order:**
   - If scheduling complexity detected → "scheduling" (highest priority)
   - Else if task creation detected → "simple_task"  
   - Else → "conversation"

✨ RESPONSE QUALITY RULES:
- Always acknowledge emotional state in messages
- Provide specific, actionable responses
- Use appropriate facial expressions and animations
- Balance empathy with efficiency
- Offer concrete next steps`;
};

const sessions = new Map(); // Store conversation history for each user

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;
  const sessionId = req.body.sessionId || 'default';
  
  console.log(`💬 New chat request from session: ${sessionId}`);
  console.log(`📝 User message: ${userMessage}`);
  
  // Initialize session if doesn't exist
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, [
      {
        role: "system",
        content: getSystemPrompt()
      }
    ]);
  }
  
  // Get current message history
  const messageHistory = sessions.get(sessionId);
  
  // Handle intro message if no user message
  if (!userMessage) {
    const introMessages = [
      {
        text: "Chào bạn! Tôi là AI Work Assistant của bạn. Hôm nay làm việc thế nào?",
        audio: await audioFileToBase64("audios/intro_0.wav"),
        lipsync: await readJsonTranscript("audios/intro_0.json"),
        facialExpression: "smile",
        animation: "Talking_1",
      },
      {
        text: "Tôi có thể giúp bạn quản lý tasks, lên schedule, hay chỉ đơn giản là trò chuyện thôi!",
        audio: await audioFileToBase64("audios/intro_1.wav"),
        lipsync: await readJsonTranscript("audios/intro_1.json"),
        facialExpression: "excited",
        animation: "Celebrating",
      },
    ];

    res.send({ messages: introMessages });
    return;
  }
  
  if (openai.apiKey === "-") {
    const errorMessages = [
      {
        text: "Oops! Looks like OpenAI API key is missing. Please add your API key to continue!",
        audio: await audioFileToBase64("audios/api_0.wav"),
        lipsync: await readJsonTranscript("audios/api_0.json"),
        facialExpression: "concerned",
        animation: "Thinking",
      },
      {
        text: "Don't worry, once you add the key, I'll be ready to help with all your work tasks!",
        audio: await audioFileToBase64("audios/api_1.wav"),
        lipsync: await readJsonTranscript("audios/api_1.json"),
        facialExpression: "smile",
        animation: "Talking_0",
      },
    ];

    res.send({ messages: errorMessages });
    return;
  }

  // Add user message to history
  messageHistory.push({
    role: "user",
    content: userMessage
  });
  
  // Limit history size to prevent token overflow
  if (messageHistory.length > 20) {
    // Keep system message and last 15 messages
    const systemMessage = messageHistory[0];
    messageHistory.splice(1, messageHistory.length - 16);
    messageHistory[0] = systemMessage;
  }

  console.log(`🧠 Sending ${messageHistory.length} messages to OpenAI...`);

  try {
    // Call OpenAI API with conversation history
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 2000,
      temperature: 0.7,
      response_format: {
        type: "json_object",
      },
      messages: messageHistory,
    });

    console.log(`✅ OpenAI response received`);
    
    let aiResponseRaw = completion.choices[0].message.content;
    let parsedResponse = JSON.parse(aiResponseRaw);
    
    // Extract messages (ChatGPT might wrap in messages property or return directly)
    let messages = parsedResponse.messages || [parsedResponse];
    
    // Add AI response to conversation history
    messageHistory.push({
      role: "assistant",
      content: aiResponseRaw
    });
    
    // Update session
    sessions.set(sessionId, messageHistory);

    console.log(`🎭 Processing ${messages.length} messages for audio generation...`);
    console.log(`📊 Mode: ${parsedResponse.mode}, Intent: ${parsedResponse.intent}`);

    // Generate audio and lipsync for each message
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const fileName = `audios/message_${i}.mp3`;
      const textInput = message.text;
      
      console.log(`🎵 Generating audio for message ${i + 1}: "${textInput.substring(0, 50)}..."`);
      
      // Generate voice with OpenAI TTS
      await generateSpeech(textInput, fileName, "nova"); // You can change voice here
      
      // Generate lipsync
      await lipSyncMessage(i);
      
      // Add audio and lipsync data to message
      message.audio = await audioFileToBase64(fileName);
      message.lipsync = await readJsonTranscript(`audios/message_${i}.json`);
      
      console.log(`✅ Audio generated for message ${i + 1}`);
    }

    // Add to background queue for database processing
    addToBackgroundQueue({
      type: 'conversation_processing',
      userInput: userMessage,
      aiResponse: parsedResponse,
      sessionId: sessionId,
      userId: sessionId.split('_')[0] || 'anonymous', // Extract userId from sessionId if possible
      messageCount: messages.length
    });

    console.log(`🚀 Sending response with ${messages.length} messages`);
    res.send({ 
      messages,
      metadata: {
        mode: parsedResponse.mode,
        intent: parsedResponse.intent,
        confidence: parsedResponse.confidence,
        sessionId: sessionId,
        processing: "background_job_queued"
      }
    });

  } catch (error) {
    console.error("❌ Error in chat processing:", error);
    
    // Send error response with audio
    const errorMessages = [
      {
        text: "Sorry, tôi đang gặp một chút vấn đề technical. Bạn có thể thử lại không?",
        facialExpression: "concerned",
        animation: "Thinking",
      }
    ];

    // Generate audio for error message
    for (let i = 0; i < errorMessages.length; i++) {
      const message = errorMessages[i];
      const fileName = `audios/error_${i}.mp3`;
      
      try {
        await generateSpeech(message.text, fileName, "nova");
        await lipSyncMessage(`error_${i}`);
        message.audio = await audioFileToBase64(fileName);
        message.lipsync = await readJsonTranscript(`audios/error_${i}.json`);
      } catch (audioError) {
        console.error("Error generating error message audio:", audioError);
      }
    }

    res.status(500).send({ 
      messages: errorMessages,
      error: "Internal server error",
      details: error.message 
    });
  }
});

// API endpoint to check background job status
app.get("/job-status", (req, res) => {
  res.json({
    queueSize: backgroundJobQueue.length,
    isProcessing: isProcessingJobs,
    totalProcessed: "N/A", // Could add counter
    lastProcessed: new Date().toISOString()
  });
});

// API endpoint to manually trigger background job processing
app.post("/process-jobs", (req, res) => {
  processBackgroundJobs();
  res.json({
    message: "Background job processing triggered",
    queueSize: backgroundJobQueue.length
  });
});

// Helper functions
const readJsonTranscript = async (file) => {
  try {
    const data = await fs.readFile(file, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading transcript file ${file}:`, error);
    return { mouthCues: [] }; // Return empty transcript on error
  }
};

const audioFileToBase64 = async (file) => {
  try {
    const data = await fs.readFile(file);
    return data.toString("base64");
  } catch (error) {
    console.error(`Error reading audio file ${file}:`, error);
    return ""; // Return empty string on error
  }
};

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  process.exit(0);
});

app.listen(port, () => {
  console.log(`🤖 AI Work Assistant Server listening on port ${port}`);
  console.log(`🔗 Python API URL: ${PYTHON_API_URL}`);
  console.log(`🎵 Audio generation: Enabled`);
  console.log(`📋 Background jobs: Enabled`);
  console.log('='.repeat(50));
});