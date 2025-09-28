import OpenAI from "openai";
import axios from "axios";
import config from "../config/index.js";

export class ConversationService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openai.apiKey,
    });
    this.sessions = new Map(); // Store conversation history for each user
    this.pendingConfirmations = new Map(); // Store pending confirmations by sessionId
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
  "needsConfirmation": true|false,
  "confirmationType": "scheduling_details|task_clarification|time_conflicts|none",
  "pendingData": {
    "tasks": [...],
    "timeSlots": [...],
    "missingInfo": ["start_time", "duration", "priority"]
  },
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
    "timeScope": "today|tomorrow|this_week|next_week|null",
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

🚨 REQUIRED FIELDS:
**ALWAYS include these fields in EVERY response:**
- taskAction: Required (use "action": "none" if no task action)
- schedulingAction: Required (use "type": "none", "action": "none" if no scheduling)

📝 CONFIRMATION LOGIC:

**🔍 LUÔN KIỂM TRA THÔNG TIN CHƯA RÕ RÀNG:**
Khi process-conversation, nếu user input có thông tin mơ hồ, PHẢI hỏi lại để làm rõ:

- **Thời gian không cụ thể**: "hôm nay", "mai", "tuần sau" → Hỏi giờ cụ thể
- **Địa điểm không rõ**: "meeting" → Hỏi địa điểm, online hay offline
- **Người liên quan không rõ**: "gọi khách hàng" → Hỏi tên khách hàng cụ thể  
- **Mục đích không rõ**: "làm báo cáo" → Hỏi loại báo cáo, deadline
- **Độ ưu tiên không rõ**: Task quan trọng hay thường → Hỏi mức độ ưu tiên

**Khi nào cần confirmation (needsConfirmation: true):**
1. **scheduling_details**: Cần thông tin thời gian cụ thể
   - VD: "Meeting hôm nay lúc mấy giờ? Ở đâu? Với ai?"
   - missingInfo: ["start_time", "duration", "meeting_location", "participants"]

2. **task_clarification**: Task thiếu chi tiết quan trọng
   - VD: "Gọi khách hàng nào? Về vấn đề gì? Deadline khi nào?"
   - missingInfo: ["contact_person", "call_purpose", "priority", "deadline"]

3. **time_conflicts**: Phát hiện xung đột thời gian với existing tasks
   - VD: "Meeting 10h trùng với task 'Báo cáo tuần'. Reschedule task nào?"
   - missingInfo: ["preferred_time", "flexible_tasks"]

**Khi không cần confirmation (needsConfirmation: false):**
- Thông tin đầy đủ để tạo task/schedule
- Conversation đơn giản
- Simple task với thời gian rõ ràng

**📋 VÍ DỤ CẦN HỎI LẠI:**

❌ Input mơ hồ: "Nhắc tôi meeting hôm nay"  
✅ Cần hỏi: "Meeting hôm nay lúc mấy giờ? Ở đâu? Meeting với ai về chủ đề gì?"

❌ Input mơ hồ: "Tôi cần gọi khách hàng"
✅ Cần hỏi: "Gọi khách hàng nào? Về vấn đề gì? Cần gọi lúc mấy giờ?"

❌ Input mơ hồ: "Làm báo cáo tuần sau"  
✅ Cần hỏi: "Báo cáo gì? Deadline cụ thể ngày nào? Báo cáo cho ai?"

❌ Input mơ hồ: "Meeting team và viết document"
✅ Cần hỏi: "Meeting team lúc mấy giờ? Document gì, deadline khi nào? Thứ tự ưu tiên như thế nào?"

**🔍 PHÂN TÍCH EXISTING TASKS:**
Khi có existing tasks trong context, PHẢI kiểm tra:

1. **Time conflicts**: Tasks cùng thời gian → Hỏi reschedule
2. **Duplicate tasks**: Tasks tương tự đã tồn tại → Hỏi có muốn update hay tạo mới
3. **Priority conflicts**: Nhiều tasks urgent cùng deadline → Hỏi ưu tiên
4. **Resource conflicts**: Cùng category/người thực hiện → Hỏi phân bổ thời gian

**Ví dụ phân tích conflict:**
- Existing: "Meeting team - 10:00 AM"  
- New request: "Gọi khách hàng hôm nay"
- Response: "Bạn đã có meeting team lúc 10h. Muốn gọi khách hàng lúc mấy giờ để không trùng?"

**pendingData format:**
- Lưu trữ thông tin đã có
- Chỉ rõ missingInfo để hỏi user
- Chuẩn bị sẵn để process khi confirmed

**Example needsConfirmation response:**
{
  "needsConfirmation": true,
  "confirmationType": "scheduling_details",
  "pendingData": {
    "tasks": [
      {"title": "Meeting team", "startTime": "10:00", "confirmed": true},
      {"title": "Viết báo cáo quarterly", "estimated_duration": 120, "confirmed": false},
      {"title": "Gọi khách hàng", "quantity": 3, "confirmed": false}
    ],
    "missingInfo": ["bao_cao_deadline", "khach_hang_names", "call_priority"]
  },
  "messages": [{
    "text": "Tôi thấy bạn có 3 việc cần làm! Meeting team 10h đã rõ. Còn báo cáo quarterly deadline khi nào? Và 3 khách hàng cần gọi là ai, priority thế nào?",
    "facialExpression": "thinking",
    "animation": "Thinking_0"
  }]
}

✨ RESPONSE QUALITY RULES:
- Always acknowledge emotional state in messages
- Provide specific, actionable responses
- Use appropriate facial expressions and animations
- Balance empathy with efficiency
- Offer concrete next steps
- Use needsConfirmation để avoid incomplete task creation

🔧 REQUIRED JSON RESPONSE FORMAT:
{
  "mode": "conversation|simple_task|scheduling",
  "intent": "descriptive intent text",
  "confidence": 0.8,
  "needsConfirmation": false,
  "taskAction": {
    "action": "create|update|delete|none",
    "tasks": [
      {
        "title": "Task title",
        "description": "Detailed description", 
        "priority": "high|medium|low",
        "category": "meeting|work|personal|health|shopping|social",
        "status": "pending|in_progress|completed",
        "tags": ["tag1", "tag2"],
        "due_date": "2024-01-15",
        "due_time": "14:30",
        "estimated_duration": 60
      }
    ]
  },
  "schedulingAction": {
    "type": "none|daily|weekly|optimization",
    "action": "none|create|update|reschedule"
  },
  "messages": [
    {
      "text": "Response text",
      "facialExpression": "smile|thinking|concerned|excited|default", 
      "animation": "Talking_1|Thinking_0|Idle|default"
    }
  ]
}

⚠️ CRITICAL: ALWAYS include both taskAction and schedulingAction in response, even if action is "none"`;
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
   * Fetch and optimize existing user tasks
   * @param {string} userId - User ID
   * @returns {Object} - Optimized tasks data
   */
  async fetchUserTasks(userId) {
    try {
      console.log(`📋 Fetching existing tasks for user: ${userId}`);
      
      const response = await axios.get(`${config.pythonApi.url}/api/v1/tasks-user/${userId}`, {
        timeout: config.pythonApi.timeout,
        headers: {
          'Content-Type': 'application/json',
          'X-Source': 'nodejs-server'
        }
      });

      const tasks = response.data || [];
      console.log(`✅ Fetched ${tasks.length} tasks for user ${userId}`);
      
      // Optimize for token efficiency - keep only essential fields
      const optimizedTasks = tasks.map(task => ({
        id: task.id, // Needed for update/delete operations
        title: task.title,
        status: task.status,
        priority: task.priority,
        category: task.category,
        due_date: task.due_date ? task.due_date.split('T')[0] : null, // YYYY-MM-DD only
        due_time: task.due_time, // HH:MM
        duration: task.estimated_duration // minutes
      }));

      return {
        tasks: optimizedTasks,
        count: tasks.length
      };

    } catch (error) {
      console.error(`❌ Error fetching tasks for user ${userId}:`, error.message);
      return {
        tasks: [],
        count: 0
      };
    }
  }

  /**
   * Process conversation with OpenAI
   * @param {string} userMessage - User message
   * @param {string} sessionId - Session ID
   * @param {string} userId - User ID for task fetching
   * @returns {Object} - AI response
   */
  async processConversation(userMessage, sessionId, userId = null) {
    const messageHistory = this.getSession(sessionId);
    
    // Fetch existing tasks if userId provided and it's a task/scheduling related intent
    let existingTasksContext = "";
    if (userId && (userMessage.includes('task') || userMessage.includes('lịch') || userMessage.includes('meeting') || userMessage.includes('sắp xếp'))) {
      const taskData = await this.fetchUserTasks(userId);
      if (taskData.tasks.length > 0) {
        existingTasksContext = `\n\n📋 EXISTING TASKS (${taskData.count} total):\n${JSON.stringify(taskData.tasks, null, 2)}\n\n⚠️ IMPORTANT: Check for time conflicts and duplicate tasks before creating new ones!`;
      } else {
        existingTasksContext = "\n\n📋 EXISTING TASKS: No existing tasks found.";
      }
    }
    
    // Add user message with existing tasks context to history
    this.addMessageToSession(sessionId, {
      role: "user", 
      content: userMessage + existingTasksContext
    });

    console.log(`🧠 Sending ${messageHistory.length} messages to OpenAI...`);
    if (existingTasksContext) {
      console.log(`📋 Including existing tasks context for conflict detection`);
    }

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
        message_count: payload.parsed_response.messages?.length || 0,
        task_action: payload.parsed_response.taskAction,
        scheduling_action: payload.parsed_response.schedulingAction
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
   * Store pending confirmation data
   * @param {string} sessionId - Session ID
   * @param {Object} confirmationData - Confirmation data
   */
  storePendingConfirmation(sessionId, confirmationData) {
    this.pendingConfirmations.set(sessionId, {
      ...confirmationData,
      timestamp: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 minutes expiry
    });
    
    console.log(`📋 Stored pending confirmation for session ${sessionId}:`, {
      confirmationType: confirmationData.confirmationType,
      missingInfo: confirmationData.pendingData?.missingInfo
    });
  }

  /**
   * Get pending confirmation data
   * @param {string} sessionId - Session ID
   * @returns {Object|null} - Pending confirmation data
   */
  getPendingConfirmation(sessionId) {
    const pending = this.pendingConfirmations.get(sessionId);
    
    if (!pending) return null;
    
    // Check expiry
    if (new Date() > new Date(pending.expiresAt)) {
      console.log(`⏰ Pending confirmation expired for session ${sessionId}`);
      this.pendingConfirmations.delete(sessionId);
      return null;
    }
    
    return pending;
  }

  /**
   * Clear pending confirmation
   * @param {string} sessionId - Session ID
   */
  clearPendingConfirmation(sessionId) {
    const cleared = this.pendingConfirmations.delete(sessionId);
    if (cleared) {
      console.log(`✅ Cleared pending confirmation for session ${sessionId}`);
    }
  }

  /**
   * Check if response needs confirmation and should not be sent to Python API
   * @param {Object} aiResponse - AI response
   * @returns {boolean} - True if needs confirmation
   */
  needsConfirmation(aiResponse) {
    return aiResponse.needsConfirmation === true && 
           aiResponse.confirmationType && 
           aiResponse.confirmationType !== "none";
  }

  /**
   * Detect if user input is a confirmation response
   * @param {string} userInput - User input
   * @param {Object} pendingData - Pending confirmation data
   * @returns {boolean} - True if it's a confirmation
   */
  isConfirmationResponse(userInput, pendingData) {
    if (!pendingData) return false;
    
    // Simple confirmation keywords
    const confirmationKeywords = [
      'ok', 'được', 'đồng ý', 'yes', 'có', 'vâng', 
      'xác nhận', 'proceed', 'continue', 'tiếp tục',
      'muốn xoá', 'xoá', 'delete', 'làm cho tôi', 'làm luôn',
      'chắc chắn', 'confirm', 'đồng ý xoá'
    ];
    
    // Check if user is providing missing information
    const missingInfo = pendingData.pendingData?.missingInfo || [];
    const hasInfoKeywords = missingInfo.some(info => 
      userInput.toLowerCase().includes(info.toLowerCase()) ||
      userInput.includes('giờ') || userInput.includes('ngày') ||
      userInput.includes('deadline') || userInput.includes('khách hàng')
    );
    
    const hasConfirmationKeyword = confirmationKeywords.some(keyword => 
      userInput.toLowerCase().includes(keyword)
    );
    
    return hasConfirmationKeyword || hasInfoKeywords;
  }

  /**
   * Merge user confirmation with pending data
   * @param {string} userInput - User confirmation input
   * @param {Object} pendingData - Pending confirmation data
   * @returns {Object} - Merged response for Python API
   */
  mergeConfirmationData(userInput, pendingData) {
    // Create a merged response with original pending data plus user confirmation
    const mergedResponse = {
      ...pendingData,
      needsConfirmation: false, // Now confirmed
      confirmationType: "completed",
      userConfirmation: userInput,
      confirmed: true,
      timestamp: new Date().toISOString()
    };
    
    // Ensure required fields are present for Python API
    if (!mergedResponse.taskAction) {
      mergedResponse.taskAction = {
        action: "create",
        task: {
          title: "Confirmed task from scheduling",
          description: `Task confirmed: ${userInput}`,
          priority: "medium",
          category: "work", 
          dueDate: new Date().toISOString().split('T')[0],
          dueTime: null,
          status: "pending",
          tags: ["confirmed"],
          subtasks: [],
          reminders: []
        }
      };
    }
    
    if (!mergedResponse.schedulingAction) {
      mergedResponse.schedulingAction = {
        type: "daily_planning",
        action: "create_schedule",
        timeScope: "today",
        tasks: [],
        conflicts: []
      };
    }
    
    console.log(`🔄 Merged confirmation data:`, {
      originalType: pendingData.confirmationType,
      userInput: userInput.substring(0, 50) + "...",
      confirmed: true,
      hasTaskAction: !!mergedResponse.taskAction,
      hasSchedulingAction: !!mergedResponse.schedulingAction
    });
    
    return mergedResponse;
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
      lastProcessed: new Date().toISOString(),
      pendingConfirmations: this.pendingConfirmations.size
    };
  }
}