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
  getTaskOperationPrompt() {
    const today = new Date();
    const currentDate = today.toISOString().split('T')[0];
    const currentTime = today.toTimeString().split(' ')[0].substring(0, 5);

    return `Bạn là Task Operation Assistant chuyên về quản lý và thao tác với tasks hiện có.

🗓️ NGÀY GIỜ HIỆN TẠI: ${currentDate} ${currentTime}

📋 OUTPUT FORMAT (chỉ JSON, không text khác):

{
  "operation": "query|update|delete|priority_change|mark_complete|stats",
  "intent": "user_intent_description",
  "confidence": 0.0-1.0,
  "needsConfirmation": true|false,
  "confirmationType": "task_selection|update_details|delete_confirmation|none",
  "messages": [
    {
      "text": "response_message",
      "facialExpression": "smile|concerned|thinking|surprised|default",
      "animation": "Talking_0|Talking_1|Thinking_0|Celebrating|default"
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

**LUÔN cần confirmation cho:**
- DELETE operations (rủi ro cao)
- PRIORITY changes affecting multiple tasks
- UPDATE của sensitive fields (due_date, status)

**CÓ THỂ không cần confirmation:**
- QUERY operations (read-only)
- STATS requests (read-only)
- Simple mark complete (obvious intent)

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
    "operation": "priority_change",
    "targetTasks": [/* matching tasks */],
    "updateData": {
      "field": "priority",
      "newValue": "urgent"
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
  async processTaskOperation(userMessage, existingTasks, sessionId) {
    const systemPrompt = this.getTaskOperationPrompt();
    
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
        case 'priority_change':
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
      const targetTask = taskOperation.targetTasks[0];
      const updateData = taskOperation.updateData;
      
      // Build TaskUpdateRequest payload with proper camelCase fields
      const updatePayload = {};
      
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
      
      const apiField = fieldMapping[updateData.field] || updateData.field;
      updatePayload[apiField] = updateData.newValue;
      
      // Special handling for completed status
      if (updateData.field === 'status' && updateData.newValue === 'completed') {
        updatePayload.completedAt = new Date().toISOString();
      }
      
      // Special handling for date fields
      if (updateData.field === 'due_date') {
        // Ensure proper date format
        updatePayload.dueDate = new Date(updateData.newValue).toISOString();
      }
      
      console.log(`🔄 Update payload for task ${targetTask.id}:`, updatePayload);

      const response = await axios.put(
        `${config.pythonApi.url}/api/v1/tasks/${targetTask.id}`,
        updatePayload,
        {
          timeout: config.pythonApi.timeout,
          headers: { 'Content-Type': 'application/json' }
        }
      );

      return {
        success: true,
        operation: 'update',
        updated_task: response.data,
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
        
        const apiUrl = `${config.pythonApi.url}/api/v1/tasks/${task.id}/complete`;
        console.log(`🔗 Making request to: ${apiUrl}`);
        console.log(`⏱️ Timeout configured: ${config.pythonApi.timeout || 10000}ms`);
        
        // Test if the URL is reachable first
        try {
          console.log(`🏃 Attempting mark complete API call...`);
          
          const response = await axios.put(
            apiUrl,
            {}, // Empty payload - endpoint handles completion logic
            {
              timeout: config.pythonApi.timeout || 10000,
              headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              }
            }
          );
          
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
          
        } catch (axiosError) {
          console.error(`❌ Axios error for task ${task.id}:`, {
            message: axiosError.message,
            code: axiosError.code,
            status: axiosError.response?.status,
            statusText: axiosError.response?.statusText,
            data: axiosError.response?.data,
            config: {
              url: axiosError.config?.url,
              method: axiosError.config?.method,
              timeout: axiosError.config?.timeout
            }
          });
          throw axiosError;
        }
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