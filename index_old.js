import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { promises as fs } from "fs";
import OpenAI from "openai";
import path from "path";
import axios from "axios"; // Need to install: npm install axios
import os from "os";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "-",
});

const app = express();
app.use(express.json());
app.use(cors());  
const port = 3000;

// Python API endpoint for database operations
const PYTHON_API_URL = process.env.PYTHON_API_URL || "https://task-agent-api.ngrok.dev";

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

const lipSyncMessage = async (fileBaseName) => {
  const time = new Date().getTime();
  console.log(`Starting conversion for ${fileBaseName}`);
  
  const mp3Path = `audios/${fileBaseName}.mp3`;
  const wavPath = `audios/${fileBaseName}.wav`;
  const jsonPath = `audios/${fileBaseName}.json`;
  
  await execCommand(
    `ffmpeg -y -i ${mp3Path} ${wavPath}`
    // -y to overwrite the file
  );
  console.log(`Conversion done in ${new Date().getTime() - time}ms`);

  const platform = os.platform();
  console.log(`Platform detected: ${platform}`);

  if (platform === 'win32') {
    // For Windows
    const currentDir = process.cwd();
    const rhubarbPath = path.join(currentDir, 'rhubarb', 'rhubarb.exe');
    await execCommand(
      `"${rhubarbPath}" -f json -o ${jsonPath} ${wavPath} -r phonetic`
    );
  } else if (platform === 'darwin') {
    // For MacOS with arm64 - need to install softwareupdate --install-rosetta
    await execCommand(
      `arch -x86_64 ./bin/rhubarb -f json -o ${jsonPath} ${wavPath} -r phonetic`
    );
  } else {
    // For Linux or other platforms, try the Linux version
    await execCommand(
      `./bin/rhubarb -f json -o ${jsonPath} ${wavPath} -r phonetic`
    );
  }

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
        job.sessionId,
        job.userId
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

// Intent Classification Function
const classifyUserIntent = async (userInput, userId) => {
  const prompt = `
Bạn là một AI classifier chuyên phân tích intent của user trong hệ thống quản lý task.

INPUT: "${userInput}"

Hãy phân tích và trả về JSON với format sau:

{
  "intentType": "conversation|simple_task|scheduling|task_query|task_update|task_delete|task_stats|task_priority|task_reminder",
  "confidence": 0.0-1.0,
  "action": "create|update|delete|query|stats|chat|prioritize|remind",
  "taskIdentifier": "task_title_or_keyword_or_null",
  "reasoning": "explanation_of_classification"
}

CLASSIFICATION RULES:

1. **conversation**: 
   - Chào hỏi, chia sẻ cảm xúc, câu hỏi chung
   - VD: "Chào bạn", "Hôm nay tôi thế nào", "Cảm ơn bạn"

2. **simple_task**: 
   - Tạo task đơn giản, reminder
   - VD: "Nhắc tôi gọi khách hàng", "Tạo task mua sữa", "Thêm việc họp team"

3. **scheduling**: 
   - Sắp xếp nhiều task, lên lịch phức tạp
   - VD: "Sắp xếp lịch hôm nay", "Plan cho tuần này", "Lên schedule meeting"

4. **task_query**: 
   - Truy vấn, tìm kiếm, xem task
   - VD: "Task hôm nay có gì", "Cho tôi xem task pending", "Danh sách công việc"

5. **task_update**: 
   - Cập nhật task cụ thể (status, thông tin)
   - VD: "Đánh dấu task X completed", "Update task gọi khách hàng thành urgent", "Hoàn thành việc mua sữa"
   - taskIdentifier: tên hoặc từ khóa nhận diện task

6. **task_delete**: 
   - Xóa task cụ thể  
   - VD: "Xóa task mua sữa", "Delete task meeting", "Bỏ việc gọi khách hàng"
   - taskIdentifier: tên hoặc từ khóa nhận diện task

7. **task_stats**: 
   - Thống kê, báo cáo task
   - VD: "Thống kê task tuần này", "Báo cáo công việc", "Progress hôm nay", "Hiệu suất làm việc"

8. **task_priority**: 
   - Thay đổi độ ưu tiên task
   - VD: "Task gọi khách hàng ưu tiên cao", "Đặt task X làm urgent", "Priority thấp cho task Y"
   - taskIdentifier: tên task cần thay đổi priority

9. **task_reminder**: 
   - Thiết lập reminder cho task
   - VD: "Nhắc tôi 30 phút trước meeting", "Set reminder cho task X", "Báo thức trước 1 giờ"
   - taskIdentifier: tên task cần set reminder

Chú ý:
- Nếu có nhắc đến tên task cụ thể -> taskIdentifier
- Confidence cao khi intent rõ ràng
- Ưu tiên task operations nếu có keyword liên quan task
- Nếu không chắc chắn, default về conversation với confidence thấp
`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 500,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: userInput }
      ],
    });

    const result = JSON.parse(completion.choices[0].message.content);
    
    console.log(`🎯 Intent Classification:`, {
      input: userInput.substring(0, 50) + "...",
      intentType: result.intentType,
      action: result.action,
      confidence: result.confidence,
      taskIdentifier: result.taskIdentifier
    });

    return result;

  } catch (error) {
    console.error("❌ Error in intent classification:", error);
    
    // Fallback classification
    return {
      intentType: "conversation",
      confidence: 0.5,
      action: "chat",
      taskIdentifier: null,
      reasoning: "Classification failed, defaulting to conversation"
    };
  }
};

// Route request based on intent classification
const routeRequestByIntent = async (classification, userInput, userId, sessionId) => {
  const { intentType, action, taskIdentifier, confidence } = classification;

  console.log(`🚀 Routing request:`, {
    intentType,
    action,
    confidence,
    hasTaskIdentifier: !!taskIdentifier
  });

  // Nếu confidence thấp, default về conversation
  if (confidence < 0.6) {
    console.log(`⚠️ Low confidence (${confidence}), routing to conversation`);
    return {
      route: 'process-conversation',
      intentType: 'conversation'
    };
  }

  // Conversation, simple_task, scheduling -> gọi process-conversation
  if (['conversation', 'simple_task', 'scheduling'].includes(intentType)) {
    return {
      route: 'process-conversation',
      intentType: intentType
    };
  }

  // Task operations - hiện tại để trống, sẽ implement sau
  if (['task_query', 'task_update', 'task_delete', 'task_stats', 'task_priority', 'task_reminder'].includes(intentType)) {
    console.log(`📋 Task operation detected: ${intentType} - Will implement later`);
    
    // Tạm thời trả về conversation response
    return {
      route: 'task-operation-placeholder',
      intentType: intentType,
      taskIdentifier: taskIdentifier,
      action: action,
      message: `Tính năng ${intentType} đang được phát triển. Hiện tại tôi chỉ có thể giúp bạn tạo task mới, lên lịch và trò chuyện.`
    };
  }

  // Default fallback
  return {
    route: 'process-conversation',
    intentType: 'conversation'
  };
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
      "animation": "Thinking_0"
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
      "animation": "Thinking_0"
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
  const userId = req.body.user_id || 'anonymous';
  
  console.log(`💬 New chat request from user: ${userId}, session: ${sessionId}`);
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
        facialExpression: "smile",
        animation: "Talking_1",
      },
      {
        text: "Tôi có thể giúp bạn quản lý tasks, lên schedule, hay chỉ đơn giản là trò chuyện thôi!",
        facialExpression: "excited",
        animation: "Celebrating",
      },
    ];

    // Try to use existing audio files first, generate if not found
    try {
      introMessages[0].audio = await audioFileToBase64("audios/intro_0.wav");
      introMessages[0].lipsync = await readJsonTranscript("audios/intro_0.json");
      introMessages[1].audio = await audioFileToBase64("audios/intro_1.wav");
      introMessages[1].lipsync = await readJsonTranscript("audios/intro_1.json");
    } catch (error) {
      console.log("📢 Generating intro audio...");
      await generateMessagesAudio(introMessages, "intro");
    }

    res.send({ messages: introMessages });
    return;
  }
  
  if (openai.apiKey === "-") {
    await sendErrorResponse(res, "Oops! OpenAI API key bị thiếu. Vui lòng thêm API key để tiếp tục!", 401, "Missing API key");
    return;
  }

  // ===== INTENT CLASSIFICATION =====
  console.log(`🎯 Starting intent classification...`);
  
  let classification = null;
  let routing = null;
  
  try {
    // Phân loại intent từ user input
    classification = await classifyUserIntent(userMessage, userId);
    
    // Route request dựa trên classification
    routing = await routeRequestByIntent(classification, userMessage, userId, sessionId);
    
    console.log(`📍 Routing decision:`, routing);
    
    // Xử lý các route khác nhau
    if (routing.route === 'task-operation-placeholder') {
      const response = await createPlaceholderResponse(routing, classification);
      res.send(response);
      return;
    }
    
    // Nếu route là process-conversation, tiếp tục với logic hiện tại
    if (routing.route === 'process-conversation') {
      console.log(`💬 Processing as conversation/task creation with mode: ${routing.intentType}`);
      
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
      
      // Tiếp tục với logic OpenAI call hiện tại...

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

        // Generate audio and lipsync for all messages
        await generateMessagesAudio(messages, "message");

        // Add to background queue for database processing
        addToBackgroundQueue({
          type: 'conversation_processing',
          userInput: userMessage,
          aiResponse: parsedResponse,
          sessionId: sessionId,
          userId: userId,
          messageCount: messages.length
        });

        console.log(`🚀 Sending response with ${messages.length} messages`);
        const response = createResponse(messages, {
          mode: parsedResponse.mode,
          intent: parsedResponse.intent,
          confidence: parsedResponse.confidence,
          sessionId: sessionId,
          processing: "background_job_queued",
          classification: classification,
          routing: routing
        });
        
        res.send(response);

      } catch (error) {
        console.error("❌ Error in chat processing:", error);
        await sendErrorResponse(res, undefined, 500, error.message);
      }
    }
    
  } catch (classificationError) {
    console.error("❌ Error in intent classification:", classificationError);
    await sendErrorResponse(res, "Xin lỗi, tôi đang gặp vấn đề trong việc hiểu yêu cầu của bạn. Vui lòng thử lại!", 500, "Classification error");
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

// ===== UTILITY FUNCTIONS =====

/**
 * Generate audio and lipsync for a single message
 * @param {Object} message - Message object with text
 * @param {string} filePrefix - Prefix for audio files (e.g., "message", "error", "placeholder")
 * @param {number} index - Index for multiple messages
 * @returns {Object} - Message with audio and lipsync data
 */
const generateMessageAudio = async (message, filePrefix = "message", index = 0) => {
  try {
    // Ensure audios directory exists
    await fs.mkdir('audios', { recursive: true });
    
    const fileBaseName = `${filePrefix}_${index}`;
    const fileName = `audios/${fileBaseName}.mp3`;
    const textInput = message.text;
    
    console.log(`🎵 Generating audio for ${fileBaseName}: "${textInput.substring(0, 50)}..."`);
    
    // Generate voice with OpenAI TTS
    await generateSpeech(textInput, fileName, "nova");
    
    // Generate lipsync - need to pass just the base name without 'audios/' prefix
    await lipSyncMessage(fileBaseName);
    
    // Add audio and lipsync data to message
    message.audio = await audioFileToBase64(fileName);
    message.lipsync = await readJsonTranscript(`audios/${fileBaseName}.json`);
    
    console.log(`✅ Audio generated for ${fileBaseName}`);
    return message;
    
  } catch (error) {
    console.error(`Error generating audio for ${filePrefix}_${index}:`, error);
    return message; // Return message without audio on error
  }
};

/**
 * Generate audio for multiple messages
 * @param {Array} messages - Array of message objects
 * @param {string} filePrefix - Prefix for audio files
 * @returns {Array} - Messages with audio and lipsync data
 */
const generateMessagesAudio = async (messages, filePrefix = "message") => {
  for (let i = 0; i < messages.length; i++) {
    await generateMessageAudio(messages[i], filePrefix, i);
  }
  return messages;
};

/**
 * Create standardized response with metadata
 * @param {Array} messages - Array of message objects
 * @param {Object} options - Additional options
 * @returns {Object} - Standardized response object
 */
const createResponse = (messages, options = {}) => {
  const {
    mode = null,
    intent = null,
    confidence = null,
    sessionId = null,
    classification = null,
    routing = null,
    processing = null,
    error = null
  } = options;

  const response = { messages };
  
  if (mode || intent || confidence || sessionId || classification || routing || processing) {
    response.metadata = {};
    
    if (mode) response.metadata.mode = mode;
    if (intent) response.metadata.intent = intent;
    if (confidence) response.metadata.confidence = confidence;
    if (sessionId) response.metadata.sessionId = sessionId;
    if (processing) response.metadata.processing = processing;
    
    if (classification) {
      response.metadata.classification = {
        intentType: classification.intentType,
        action: classification.action,
        taskIdentifier: classification.taskIdentifier,
        classificationConfidence: classification.confidence
      };
    }
    
    if (routing) {
      response.metadata.routing = {
        route: routing.route,
        intentType: routing.intentType
      };
    }
  }
  
  if (error) {
    response.error = error.message || "Internal server error";
    response.details = error.details || error.message;
  }
  
  return response;
};

/**
 * Create and send error response with audio
 * @param {Object} res - Express response object
 * @param {string} errorText - Error message text
 * @param {number} statusCode - HTTP status code
 * @param {string} errorDetails - Additional error details
 */
const sendErrorResponse = async (res, errorText = "Sorry, tôi đang gặp một chút vấn đề technical. Bạn có thể thử lại không?", statusCode = 500, errorDetails = "Internal server error") => {
  try {
    const errorMessages = [{
      text: errorText,
      facialExpression: "concerned",
      animation: "Thinking_0",
    }];

    // Generate audio for error message
    await generateMessagesAudio(errorMessages, "error");

    res.status(statusCode).send(createResponse(errorMessages, {
      error: { message: errorDetails }
    }));
    
  } catch (audioError) {
    console.error("Error generating error message audio:", audioError);
    // Send response without audio if audio generation fails
    res.status(statusCode).send({
      messages: [{
        text: errorText,
        facialExpression: "concerned",
        animation: "Thinking_0",
      }],
      error: errorDetails
    });
  }
};

/**
 * Create placeholder response for unimplemented features
 * @param {Object} routing - Routing information
 * @param {Object} classification - Classification information
 * @returns {Object} - Response object
 */
const createPlaceholderResponse = async (routing, classification) => {
  const placeholderMessages = [{
    text: routing.message,
    facialExpression: "concerned",
    animation: "Thinking_0",
  }];

  await generateMessagesAudio(placeholderMessages, "placeholder");

  return createResponse(placeholderMessages, {
    intentType: routing.intentType,
    classification: classification,
    routing: routing
  });
};

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