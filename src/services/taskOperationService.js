import OpenAI from "openai";
import axios from "axios";
import config from "../config/index.js";

export class TaskOperationService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openai.apiKey,
    });
  }

  /**
   * Get specialized prompt for task operations
   * @returns {string} - Task operation system prompt
   */
  getTaskOperationPrompt(userContext = {}) {

    const userTimezone = "Asia/Ho_Chi_Minh";
    let today, currentDate, currentTime, tomorrow;
    let thisMonday, thisTuesday, thisWednesday, thisThursday, thisFriday, thisSaturday, thisSunday;
    
    try {
      // Create dates in user's timezone using Intl.DateTimeFormat
      today = new Date();
      
      // Get date components in user's timezone
      const userDateFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: userTimezone,
        year: 'numeric',
        month: '2-digit', 
        day: '2-digit'
      });
      
      const userTimeFormatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: userTimezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      
      // Format date and time in user's timezone
      currentDate = userDateFormatter.format(today); // YYYY-MM-DD
      currentTime = userTimeFormatter.format(today); // HH:MM
      
      // Calculate tomorrow in user's timezone
      const tomorrowDate = new Date(today.getTime() + 24 * 60 * 60 * 1000);
      tomorrow = userDateFormatter.format(tomorrowDate);
      
      // Calculate weekdays for this week
      const todayDayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
      const daysToMonday = todayDayOfWeek === 0 ? -6 : 1 - todayDayOfWeek;
      const mondayThisWeek = new Date(today.getTime() + daysToMonday * 24 * 60 * 60 * 1000);
      
      thisMonday = userDateFormatter.format(mondayThisWeek);
      thisTuesday = userDateFormatter.format(new Date(mondayThisWeek.getTime() + 1 * 24 * 60 * 60 * 1000));
      thisWednesday = userDateFormatter.format(new Date(mondayThisWeek.getTime() + 2 * 24 * 60 * 60 * 1000));
      thisThursday = userDateFormatter.format(new Date(mondayThisWeek.getTime() + 3 * 24 * 60 * 60 * 1000));
      thisFriday = userDateFormatter.format(new Date(mondayThisWeek.getTime() + 4 * 24 * 60 * 60 * 1000));
      thisSaturday = userDateFormatter.format(new Date(mondayThisWeek.getTime() + 5 * 24 * 60 * 60 * 1000));
      thisSunday = userDateFormatter.format(new Date(mondayThisWeek.getTime() + 6 * 24 * 60 * 60 * 1000));
      
      console.log(`🕒 Time calculation: UTC=${today.toISOString()}, User(${userTimezone}): ${currentDate} ${currentTime}, Tomorrow: ${tomorrow}`);
      console.log(`📅 This week: Mon=${thisMonday}, Fri=${thisFriday}, Sat=${thisSaturday}, Sun=${thisSunday}`);
    } catch (error) {
      console.error(`❌ Timezone calculation error:`, error);
      // Fallback to UTC
      today = new Date();
      currentDate = today.toISOString().split('T')[0];
      currentTime = today.toTimeString().split(' ')[0].substring(0, 5);
      tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      // Fallback weekday calculations
      const todayDayOfWeek = today.getDay();
      const daysToMonday = todayDayOfWeek === 0 ? -6 : 1 - todayDayOfWeek;
      const mondayThisWeek = new Date(today.getTime() + daysToMonday * 24 * 60 * 60 * 1000);
      
      thisMonday = mondayThisWeek.toISOString().split('T')[0];
      thisTuesday = new Date(mondayThisWeek.getTime() + 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      thisWednesday = new Date(mondayThisWeek.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      thisThursday = new Date(mondayThisWeek.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      thisFriday = new Date(mondayThisWeek.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      thisSaturday = new Date(mondayThisWeek.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      thisSunday = new Date(mondayThisWeek.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }


    return `Bạn là Task Operation Assistant chuyên về quản lý và thao tác với tasks hiện có cho ${userContext.first_name || 'user'} ${userContext.occupation || 'work'} context..


⏰ NGÀY GIỜ HIỆN TẠI: ${currentDate} ${currentTime} (${userTimezone}) | Tomorrow: ${tomorrow}
Thứ 2: ${thisMonday}
Chủ nhật: ${thisSunday}

📋 OUTPUT FORMAT (chỉ JSON, không text khác):
👤 STYLE: ${userContext.communication_style || 'friendly'} tone, ${userContext.interaction_preference || 'detailed'} responses

Lúc nào cũng phải trả ra format như bên dưới

{
  "operation": "query|update|delete|priority_change|mark_complete|stats",
  "intent": "user_intent_description",
  "confidence": 0.0-1.0,
  "needsConfirmation": true|false,
  "confirmationType": "task_selection|update_details|delete_confirmation|none",
  "messages": [
    {
      "text": "response_message",
      "facialExpression": "smile|concerned|thinking|surprised",
      "animation": "Talking_0|Talking_1|Thinking_0|Celebrating"
    }
  ],
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
  ],
  "taskOperation": {
    "operation": "query|update|delete|priority_change|mark_complete|stats",
    "targetTasks": [
      {
        "id": "task_id_if_specific",
        "title": "task_title_for_identification",
        "reason": "why_this_task_selected"
      }
    ],
    "queryFilters": {
      "status": "pending|in_progress|completed|cancelled|all",
      "priority": "low|medium|high|urgent|all", 
      "timeRange": "today|tomorrow|this_week|overdue|all",
      "category": "work|personal|health|learning|shopping|entertainment|other|all"
    },
    "updateData": {
      "field": "priority|status|due_date|due_time|title|description|category",
      "oldValue": "current_value",
      "newValue": "new_value",
      "reason": "explanation"
    },
    "statsRequested": {
      "type": "summary|productivity|completion_rate|time_analysis|priority_breakdown",
      "timeframe": "today|this_week|this_month|all_time"
    }
  },
  "clarificationNeeded": {
    "questions": ["question1", "question2"],
    "missingInfo": ["task_selection", "new_priority", "time_range"]
  }
}

🔍 OPERATION TYPES:

**QUERY** - Tìm kiếm và hiển thị tasks:
- "Xem tasks hôm nay", "Task nào còn pending?", "Tasks urgent?"
- Phân tích user input để xác định filters
- Hiển thị kết quả với format dễ đọc
- Dựa vào thời gian đã cung cấp và câu hỏi của nguời dùng để trả ra đúng task của thời gian đó
    - Ví dụ: Hôm nay có bao nhiêu task? hiện tại bạn được user input 7 tasks nhưng có 3 task trong ngày hôm nay (dựa vào ngày hiện tại đã cung cấp)

**UPDATE** - Sửa đổi task hiện có:
- "Đổi priority task X thành urgent", "Hoàn thành task Y"
- "Dời deadline task Z sang ngày mai"
- Yêu cầu xác nhận trước khi update

**DELETE** - Xóa task:
- "Xóa task X", "Hủy meeting Y", "Bỏ task Z"
- LUÔN yêu cầu xác nhận trước khi xóa
- Giải thích hậu quả của việc xóa

**PRIORITY_CHANGE** - Thay đổi độ ưu tiên:
- "Task X quan trọng hơn", "Hạ priority task Y"
- Phân tích impact với other tasks
- Suggest optimal priority ordering

**MARK_COMPLETE** - Đánh dấu hoàn thành:
- "Xong task X", "Complete task Y", "Done with Z"
- Update status và completion time
- Congratulate user on completion

**STATS** - Thống kê và phân tích:
- "Tôi làm được bao nhiêu task?", "Productivity thế nào?"
- "Tasks nào hay delay?", "Category nào nhiều nhất?"

🎯 TASK IDENTIFICATION LOGIC:

**Cách xác định task:**
1. **By exact title**: "Update task 'Meeting team'"
2. **By keywords**: "Task về meeting", "Báo cáo quarterly"  
3. **By time**: "Task hôm nay", "Deadline tuần này"
4. **By priority**: "Tasks urgent", "Việc quan trọng"
5. **By status**: "Tasks chưa xong", "Completed tasks"

**Khi multiple tasks match:**
- Liệt kê tất cả matching tasks
- Yêu cầu user chọn specific task
- needsConfirmation: true với task selection

🚨 CONFIRMATION REQUIREMENTS:

**SKIP CONFIRMATION khi user nói rõ ràng:**
- "không cần hỏi lại", "đừng hỏi nữa", "làm luôn", "xác nhận rồi"
- "chắc chắn", "confirm", "yes", "đồng ý"
- Set needsConfirmation: false và execute ngay

**LUÔN cần confirmation cho:**
- DELETE operations (trừ khi user đã nói skip)
- PRIORITY changes affecting multiple tasks
- UPDATE của sensitive fields (due_date, status)

**CÓ THỂ không cần confirmation:**
- QUERY operations (read-only)
- STATS requests (read-only)
- Simple mark complete (obvious intent)

⏰ TIME UPDATE PHRASES TO RECOGNIZE:

**Cập nhật giờ (due_time):**
- "cập nhật task ABC về khung giờ 15:30"
- "đổi giờ task XYZ thành 9h sáng" → "09:00"
- "reschedule meeting lúc 2h chiều" → "14:00" 
- "chuyển task về 8:30 tối" → "20:30"

**Cập nhật ngày (due_date):**
- "đổi ngày task ABC sang hôm nay" → current date
- "reschedule meeting sang ngày mai" → tomorrow date
- "chuyển deadline về tuần sau" → +7 days
- "task này để 25/12" → "2024-12-25"

**Combined time and date:**
- "task meeting chuyển sang 2h chiều ngày mai" → both due_date and due_time
- "reschedule báo cáo về 9h sáng thứ 2" → calculate Monday date + 09:00

📊 EXAMPLES:

**Query Example:**
Input: "Tasks hôm nay có gì?"
{
  "operation": "query",
  "taskOperation": {
    "operation": "query",
    "queryFilters": {
      "timeRange": "today",
      "status": "all"
    }
  }
}

**Update Example:**
Input: "Đổi task meeting thành urgent"
{
  "operation": "update",
  "needsConfirmation": true,
  "confirmationType": "task_selection",
  "taskOperation": {
    "operation": "update",
    "targetTasks": [/* matching tasks */],
    "updateData": {
      "field": "priority",
      "newValue": "urgent"
    }
  }
}

**Time Update Examples:**
Input: "Cập nhật task báo cáo về khung giờ 15:30"
{
  "operation": "update",
  "needsConfirmation": false,
  "taskOperation": {
    "operation": "update",
    "targetTasks": [/* matching task báo cáo */],
    "updateData": {
      "field": "due_time",
      "newValue": "15:30"
    }
  }
}

Input: "Đổi ngày task meeting sang ngày mai"
{
  "operation": "update", 
  "needsConfirmation": false,
  "taskOperation": {
    "operation": "update",
    "targetTasks": [/* matching task meeting */],
    "updateData": {
      "field": "due_date",
      "newValue": "2024-01-16"  // Calculate tomorrow's date
    }
  }
}

Input: "Cập nhật task báo cáo sang 2h chiều ngày mai"
{
  "operation": "update",
  "needsConfirmation": false,
  "taskOperation": {
    "operation": "update",
    "targetTasks": [/* matching task báo cáo */],
    "updateData": {
      "fields": [
        {"field": "due_time", "newValue": "14:00"},
        {"field": "due_date", "newValue": "2024-01-16"}
      ]
    }
  }
}

**Delete Example:**
Input: "Xóa task báo cáo"
{
  "operation": "delete", 
  "needsConfirmation": true,
  "confirmationType": "delete_confirmation",
  "messages": [{
    "text": "⚠️ Bạn chắc chắn muốn xóa task 'Báo cáo quarterly'? Hành động này không thể hoàn tác.",
    "facialExpression": "concerned"
  }]
}

✨ RESPONSE QUALITY:
- Luôn acknowledge user intent
- Provide clear next steps
- Use appropriate facial expressions
- Ask specific clarifying questions
- Show empathy and understanding`;
  }

  /**
   * Process task operation with specialized prompt
   * @param {string} userMessage - User message
   * @param {Array} existingTasks - Current user tasks
   * @param {string} sessionId - Session ID
   * @returns {Object} - Task operation response
   */
  async processTaskOperation(userMessage, existingTasks, sessionId, userContext={}) {
    const systemPrompt = this.getTaskOperationPrompt(userContext);
    
    // Format existing tasks for context
    const tasksContext = existingTasks.length > 0 
      ? `\n\n📋 CURRENT USER TASKS (${existingTasks.length} total):\n${JSON.stringify(existingTasks, null, 2)}`
      : "\n\n📋 CURRENT USER TASKS: No tasks found.";

    const messages = [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: userMessage + tasksContext
      }
    ];

    console.log(`🔧 Processing task operation with ${existingTasks.length} tasks context`);

    try {
      const completion = await this.openai.chat.completions.create({
        model: config.openai.model,
        max_tokens: config.openai.maxTokens,
        temperature: 0.3, // Lower temperature for more consistent operations
        response_format: {
          type: "json_object",
        },
        messages: messages,
      });

      const response = JSON.parse(completion.choices[0].message.content);
      console.log(`✅ Task operation processed: ${response.operation}`);
      
      return response;

    } catch (error) {
      console.error("❌ Error in task operation processing:", error);
      
      // Fallback response for task operations
      return {
        operation: "query",
        intent: "fallback task query",
        confidence: 0.5,
        needsConfirmation: false,
        confirmationType: "none",
        messages: [{
          text: "Tôi hiểu bạn muốn thao tác với tasks. Bạn có thể nói rõ hơn muốn làm gì không?",
          facialExpression: "thinking",
          animation: "Thinking_0"
        }],
        taskOperation: {
          operation: "query",
          queryFilters: {
            status: "all",
            timeRange: "all"
          }
        }
      };
    }
  }

  /**
   * Execute task operation via Python API
   * @param {Object} taskOperation - Task operation details
   * @param {string} userId - User ID
   * @returns {Object} - Operation result
   */
  async executeTaskOperation(taskOperation, userId) {
    try {
      const operation = taskOperation.operation;
      console.log(`🚀 Executing ${operation} operation for user ${userId}`);

      switch (operation) {
        case 'query':
          return await this.executeQuery(taskOperation.queryFilters, userId);
          
        case 'update':
          // Handles all update types: priority_change, time_update, date_update, time_date_update
          return await this.executeUpdate(taskOperation, userId);
          
        case 'mark_complete':
          return await this.executeMarkComplete(taskOperation.targetTasks, userId);
          
        case 'delete':
          return await this.executeDelete(taskOperation.targetTasks, userId);
          
        case 'stats':
          return await this.executeStats(taskOperation.statsRequested, userId);
          
        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }
      
    } catch (error) {
      console.error(`❌ Error executing task operation:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Execute query operation with server-side filtering
   */
  async executeQuery(filters, userId) {
    try {
      // Build query parameters for server-side filtering
      const queryParams = new URLSearchParams();
      
      if (filters.status && filters.status !== 'all') {
        queryParams.append('status', filters.status);
      }
      
      if (filters.priority && filters.priority !== 'all') {
        queryParams.append('priority', filters.priority);
      }
      
      if (filters.category && filters.category !== 'all') {
        queryParams.append('category', filters.category);
      }
      
      // Handle time-based filtering
      const today = new Date().toISOString().split('T')[0];
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      if (filters.timeRange === 'today') {
        queryParams.append('due_date', today);
      } else if (filters.timeRange === 'tomorrow') {
        queryParams.append('due_date', tomorrow);
      }
      
      // Add limit for performance
      if (filters.limit) {
        queryParams.append('limit', filters.limit.toString());
      }
      
      const url = `${config.pythonApi.url}/api/v1/tasks-user/${userId}${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
      
      console.log(`📊 Querying tasks with filters:`, Object.fromEntries(queryParams));
      
      const response = await axios.get(url, {
        timeout: config.pythonApi.timeout
      });

      let tasks = response.data || [];
      
      // Apply client-side filters for complex time ranges not supported by server
      if (filters.timeRange === 'overdue') {
        tasks = tasks.filter(task => task.due_date && task.due_date < today && task.status !== 'completed');
      } else if (filters.timeRange === 'this_week') {
        const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        tasks = tasks.filter(task => task.due_date && task.due_date >= today && task.due_date <= weekFromNow);
      }

      return {
        success: true,
        operation: 'query',
        results: tasks,
        count: tasks.length,
        filters: filters,
        server_filtered: queryParams.toString().length > 0
      };
      
    } catch (error) {
      throw new Error(`Query failed: ${error.message}`);
    }
  }

  /**
   * Execute update operation
   */
  async executeUpdate(taskOperation, userId) {
    try {
      const targetTasks = taskOperation.targetTasks;
      const updateData = taskOperation.updateData;
      const results = [];
      
      if (!targetTasks || targetTasks.length === 0) {
        throw new Error("No target tasks provided for update");
      }
      
      console.log(`🔄 Starting update operation for ${targetTasks.length} tasks`);
      console.log(`📝 Update data:`, updateData);
      
      // Map fields to camelCase format expected by API
      const fieldMapping = {
        'title': 'title',
        'description': 'description',
        'priority': 'priority',
        'category': 'category',
        'status': 'status',
        'due_date': 'dueDate',
        'due_time': 'dueTime',
        'estimated_duration': 'estimatedDuration',
        'actual_duration': 'actualDuration'
      };
      
      for (const task of targetTasks) {
        console.log(`\n🎯 Updating task: ${task.id} (${task.title})`);
        
        // Build TaskUpdateRequest payload with proper camelCase fields
        const updatePayload = {};
        
        // Handle multiple fields if updateData has multiple updates
        if (updateData.fields && Array.isArray(updateData.fields)) {
          // Multiple field update
          for (const fieldUpdate of updateData.fields) {
            const apiField = fieldMapping[fieldUpdate.field] || fieldUpdate.field;
            updatePayload[apiField] = fieldUpdate.newValue;
            
            // Special handling for date fields
            if (fieldUpdate.field === 'due_date') {
              updatePayload.dueDate = new Date(fieldUpdate.newValue).toISOString();
            }
            
            // Special handling for completed status
            if (fieldUpdate.field === 'status' && fieldUpdate.newValue === 'completed') {
              updatePayload.completedAt = new Date().toISOString();
            }
          }
        } else {
          // Single field update (backward compatibility)
          const apiField = fieldMapping[updateData.field] || updateData.field;
          updatePayload[apiField] = updateData.newValue;
          
          // Special handling for completed status
          if (updateData.field === 'status' && updateData.newValue === 'completed') {
            updatePayload.completedAt = new Date().toISOString();
          }
          
          // Special handling for date fields
          if (updateData.field === 'due_date') {
            updatePayload.dueDate = new Date(updateData.newValue).toISOString();
          }
        }
        
        console.log(`📝 Update payload for task ${task.id}:`, updatePayload);

        // Retry logic similar to executeMarkComplete
        let retryCount = 0;
        const maxRetries = 2;
        let response = null;
        
        while (retryCount <= maxRetries) {
          try {
            console.log(`🏃 Attempting update API call (attempt ${retryCount + 1}/${maxRetries + 1})...`);
            
            response = await axios.put(
              `${config.pythonApi.url}/api/v1/tasks/${task.id}`,
              updatePayload,
              {
                timeout: 15000, // Increase timeout
                headers: { 
                  'Content-Type': 'application/json',
                  'Connection': 'close' // Force close connection
                },
                maxRedirects: 0,
                validateStatus: function (status) {
                  return status >= 200 && status < 300;
                }
              }
            );
            
            // If we reach here, the request was successful
            console.log(`✅ Update API response for task ${task.id}:`, {
              status: response.status,
              data: response.data
            });
            break;
            
          } catch (axiosError) {
            retryCount++;
            console.error(`❌ Update attempt ${retryCount} failed for task ${task.id}:`, {
              message: axiosError.message,
              code: axiosError.code,
              status: axiosError.response?.status
            });
            
            // If this is the last retry or not a connection error, throw
            if (retryCount > maxRetries || (axiosError.code !== 'ECONNRESET' && axiosError.code !== 'ECONNREFUSED')) {
              throw axiosError;
            }
            
            // Wait before retry
            console.log(`⏳ Waiting 1s before retry...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
        console.log(`✅ Task ${task.id} updated successfully`);
        
        results.push({
          task_id: task.id,
          title: task.title,
          updated_field: updateData.field,
          old_value: task[updateData.field] || 'unknown',
          new_value: updateData.newValue,
          updated_task: response.data
        });
      }

      return {
        success: true,
        operation: 'update',
        updated_tasks: results,
        count: results.length,
        update_details: updateData
      };
      
    } catch (error) {
      throw new Error(`Update failed: ${error.message}`);
    }
  }

  /**
   * Execute mark complete operation - simple status update
   */
  async executeMarkComplete(targetTasks, userId) {
    try {
      const results = [];
      
      if (!targetTasks || targetTasks.length === 0) {
        throw new Error("No target tasks provided for completion");
      }
      
      console.log(`🔄 Starting mark complete operation for ${targetTasks.length} tasks`);
      console.log(`📋 Target tasks data:`, JSON.stringify(targetTasks, null, 2));
      
      for (const task of targetTasks) {
        console.log(`\n🎯 Processing task:`, {
          id: task.id,
          title: task.title,
          status: task.status,
          id_type: typeof task.id,
          id_length: task.id ? task.id.length : 'null'
        });
        
        // Validate task ID
        if (!task.id) {
          throw new Error(`Invalid task ID for task: ${task.title}`);
        }
        
        // Validate task ID format (should be MongoDB ObjectId - 24 hex chars)
        if (typeof task.id !== 'string' || !/^[0-9a-fA-F]{24}$/.test(task.id)) {
          console.log(`⚠️ Task ID format warning: ${task.id} may not be a valid ObjectId`);
        }
        
        const apiUrl = `${config.pythonApi.url}/api/v1/tasks/${task.id}`;
        console.log(`🔗 Making request to update endpoint: ${apiUrl}`);
        console.log(`⏱️ Timeout configured: ${config.pythonApi.timeout || 10000}ms`);
        
        // Retry logic for connection issues
        let retryCount = 0;
        const maxRetries = 2;
        let response = null;
        
        while (retryCount <= maxRetries) {
          try {
            console.log(`🏃 Attempting mark complete API call (attempt ${retryCount + 1}/${maxRetries + 1})...`);
            
            // Use the same update endpoint as executeUpdate (which works)
            const updatePayload = {
              status: "completed",
              completedAt: new Date().toISOString()
            };
            
            console.log(`📝 Using update endpoint with payload:`, updatePayload);
            
            response = await axios.put(
              `${config.pythonApi.url}/api/v1/tasks/${task.id}`, // Same endpoint as executeUpdate
              updatePayload,
              {
                timeout: 15000, // Increase timeout to 15s since API is slow
                headers: { 
                  'Content-Type': 'application/json',
                  'Accept': 'application/json',
                  'Connection': 'close' // Force close connection to avoid pool issues
                },
                maxRedirects: 0, // Disable redirects
                validateStatus: function (status) {
                  return status >= 200 && status < 300; // Accept only 2xx status codes
                }
              }
            );
            
            // If we reach here, the request was successful
            break;
            
          } catch (axiosError) {
            retryCount++;
            console.error(`❌ Attempt ${retryCount} failed for task ${task.id}:`, {
              message: axiosError.message,
              code: axiosError.code,
              status: axiosError.response?.status
            });
            
            // If this is the last retry or not a connection error, throw
            if (retryCount > maxRetries || (axiosError.code !== 'ECONNRESET' && axiosError.code !== 'ECONNREFUSED')) {
              throw axiosError;
            }
            
            // Wait before retry
            console.log(`⏳ Waiting 1s before retry...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
        console.log(`✅ Mark complete API response:`, {
          status: response.status,
          data: response.data
        });
        
        results.push({
          task_id: task.id,
          title: task.title,
          status: "completed",
          completed_at: response.data.completed_at,
          updated_task: response.data
        });
      }

      const result = {
        success: true,
        operation: 'mark_complete',
        completed_tasks: results,
        count: results.length
      };
      
      console.log(`🎉 Mark complete operation completed successfully:`, result);
      return result;
      
    } catch (error) {
      console.error(`💥 Mark complete operation failed:`, {
        error: error.message,
        stack: error.stack,
        targetTasks: targetTasks?.map(t => ({ id: t.id, title: t.title }))
      });
      throw new Error(`Mark complete failed: ${error.message}`);
    }
  }

  /**
   * Execute delete operation
   */
  async executeDelete(targetTasks, userId) {
    try {
      const results = [];
      
      for (const task of targetTasks) {
        const response = await axios.delete(
          `${config.pythonApi.url}/api/v1/tasks/${task.id}`,
          { timeout: config.pythonApi.timeout }
        );
        
        results.push({
          task_id: task.id,
          title: task.title,
          deleted: true
        });
      }

      return {
        success: true,
        operation: 'delete',
        deleted_tasks: results,
        count: results.length
      };
      
    } catch (error) {
      throw new Error(`Delete failed: ${error.message}`);
    }
  }

  /**
   * Execute stats operation
   */
  async executeStats(statsRequest, userId) {
    try {
      const response = await axios.get(`${config.pythonApi.url}/api/v1/tasks-user/${userId}`, {
        timeout: config.pythonApi.timeout
      });

      const tasks = response.data || [];
      
      // Generate basic stats
      const stats = {
        total_tasks: tasks.length,
        completed: tasks.filter(t => t.status === 'completed').length,
        pending: tasks.filter(t => t.status === 'pending').length,
        in_progress: tasks.filter(t => t.status === 'in_progress').length,
        by_priority: {
          urgent: tasks.filter(t => t.priority === 'urgent').length,
          high: tasks.filter(t => t.priority === 'high').length,
          medium: tasks.filter(t => t.priority === 'medium').length,
          low: tasks.filter(t => t.priority === 'low').length
        },
        by_category: {}
      };
      
      // Category breakdown
      tasks.forEach(task => {
        const category = task.category || 'other';
        stats.by_category[category] = (stats.by_category[category] || 0) + 1;
      });
      
      // Completion rate
      stats.completion_rate = tasks.length > 0 
        ? Math.round((stats.completed / tasks.length) * 100) 
        : 0;

      return {
        success: true,
        operation: 'stats',
        stats: stats,
        timeframe: statsRequest.timeframe
      };
      
    } catch (error) {
      throw new Error(`Stats generation failed: ${error.message}`);
    }
  }
}