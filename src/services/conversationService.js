import OpenAI from "openai";
import axios from "axios";
import config from "../config/index.js";

export class ConversationService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openai.apiKey,
    });
    this.sessions = new Map(); // Store conversation history for each user
    this.backgroundJobQueue = [];
    this.isProcessingJobs = false;
  }

  /**
   * Get AI Work Assistant system prompt
   * @returns {string} - System prompt
   */
  getSystemPrompt() {
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

✨ RESPONSE QUALITY RULES:
- Always acknowledge emotional state in messages
- Provide specific, actionable responses
- Use appropriate facial expressions and animations
- Balance empathy with efficiency
- Offer concrete next steps`;
  }

  /**
   * Initialize or get session
   * @param {string} sessionId - Session ID
   * @returns {Array} - Message history
   */
  getSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, [
        {
          role: "system",
          content: this.getSystemPrompt()
        }
      ]);
    }
    return this.sessions.get(sessionId);
  }

  /**
   * Add message to session and limit history size
   * @param {string} sessionId - Session ID
   * @param {Object} message - Message object
   */
  addMessageToSession(sessionId, message) {
    const messageHistory = this.getSession(sessionId);
    
    messageHistory.push(message);
    
    // Limit history size to prevent token overflow
    if (messageHistory.length > config.session.maxHistorySize) {
      const systemMessage = messageHistory[0];
      messageHistory.splice(1, messageHistory.length - (config.session.keepRecentMessages + 1));
      messageHistory[0] = systemMessage;
    }
    
    this.sessions.set(sessionId, messageHistory);
  }

  /**
   * Process conversation with OpenAI
   * @param {string} userMessage - User message
   * @param {string} sessionId - Session ID
   * @returns {Object} - AI response
   */
  async processConversation(userMessage, sessionId) {
    const messageHistory = this.getSession(sessionId);
    
    // Add user message to history
    this.addMessageToSession(sessionId, {
      role: "user",
      content: userMessage
    });

    console.log(`🧠 Sending ${messageHistory.length} messages to OpenAI...`);

    try {
      const completion = await this.openai.chat.completions.create({
        model: config.openai.model,
        max_tokens: config.openai.maxTokens,
        temperature: config.openai.temperature,
        response_format: {
          type: "json_object",
        },
        messages: messageHistory,
      });

      console.log(`✅ OpenAI response received`);
      
      const aiResponseRaw = completion.choices[0].message.content;
      const parsedResponse = JSON.parse(aiResponseRaw);
      
      // Add AI response to conversation history
      this.addMessageToSession(sessionId, {
        role: "assistant",
        content: aiResponseRaw
      });

      return parsedResponse;

    } catch (error) {
      console.error("❌ Error in OpenAI processing:", error);
      throw error;
    }
  }

  /**
   * Send data to Python API for database storage
   * @param {string} userInput - User input
   * @param {Object} aiResponse - AI response
   * @param {string} sessionId - Session ID
   * @param {string} userId - User ID
   * @returns {Object} - API response
   */
  async sendToPythonAPI(userInput, aiResponse, sessionId, userId = "nodejs_user") {
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

      console.log(`📊 Payload preview:`, {
        mode: payload.parsed_response.mode,
        intent: payload.parsed_response.intent,
        confidence: payload.parsed_response.confidence,
        has_task_action: payload.parsed_response.taskAction?.action !== "none",
        has_scheduling_action: payload.parsed_response.schedulingAction?.type !== "none",
        message_count: payload.parsed_response.messages?.length || 0
      });

      const response = await axios.post(`${config.pythonApi.url}/api/v1/process-conversation`, payload, {
        timeout: config.pythonApi.timeout,
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
  }

  /**
   * Add job to background queue
   * @param {Object} job - Job object
   */
  addToBackgroundQueue(job) {
    this.backgroundJobQueue.push({
      ...job,
      timestamp: new Date().toISOString(),
      attempts: 0,
      maxAttempts: config.backgroundJobs.maxAttempts
    });
    
    console.log(`📋 Added job to background queue. Queue size: ${this.backgroundJobQueue.length}`);
    this.processBackgroundJobs();
  }

  /**
   * Process background jobs
   */
  async processBackgroundJobs() {
    if (this.isProcessingJobs || this.backgroundJobQueue.length === 0) {
      return;
    }

    this.isProcessingJobs = true;
    console.log(`🔄 Processing background jobs. Queue size: ${this.backgroundJobQueue.length}`);

    while (this.backgroundJobQueue.length > 0) {
      const job = this.backgroundJobQueue.shift();
      
      try {
        console.log(`⚙️ Processing job: ${job.type} (attempt ${job.attempts + 1}/${job.maxAttempts})`);
        
        const result = await this.sendToPythonAPI(
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
            this.backgroundJobQueue.unshift(job); // Add back to front of queue
            this.processBackgroundJobs();
          }, Math.pow(2, job.attempts) * config.backgroundJobs.retryDelay);
          
          console.log(`🔄 Retrying job in ${Math.pow(2, job.attempts) * config.backgroundJobs.retryDelay / 1000}s...`);
        } else {
          console.error(`💀 Job permanently failed after ${job.maxAttempts} attempts:`, job.type);
        }
      }

      // Small delay between jobs
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.isProcessingJobs = false;
    console.log(`✅ Background job processing completed`);
  }

  /**
   * Get background job status
   * @returns {Object} - Job status
   */
  getJobStatus() {
    return {
      queueSize: this.backgroundJobQueue.length,
      isProcessing: this.isProcessingJobs,
      totalProcessed: "N/A",
      lastProcessed: new Date().toISOString()
    };
  }
}