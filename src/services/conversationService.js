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
   * @param {Object} userContext - User context with timezone
   * @returns {string} - System prompt
   */
  getSystemPrompt(userContext = {}) {
    console.log(`📋 getSystemPrompt called with userContext:`, {
      hasData: Object.keys(userContext).length > 0,
      timezone: userContext.timezone,
      name: `${userContext.first_name || ''} ${userContext.last_name || ''}`.trim(),
      communication_style: userContext.communication_style,
      interaction_preference: userContext.interaction_preference
    });

    // Handle timezone-aware dates
    const userTimezone = "Asia/Ho_Chi_Minh"; // userContext.timezone || 'UTC';
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

    // Build personalization context
    const personalizationContext = this.buildUserPersonalizationContext(userContext);

    return `AI Work Assistant cho ${userContext.first_name || 'user'} - ${userContext.occupation || 'work'} context.

⏰ TIME: ${currentDate} ${currentTime} (${userTimezone}) | Tomorrow: ${tomorrow}
👤 STYLE: ${userContext.communication_style || 'friendly'} tone, ${userContext.interaction_preference || 'detailed'} responses
${userContext.custom_instructions ? `📋 Custom: "${userContext.custom_instructions.substring(0, 100)}..."` : ''}

${personalizationContext ? `🎯 USER PROFILE:\n${personalizationContext}\n` : ''}

🕐 TIME PARSING (CRITICAL - Never null if time given):
- "trưa nay 12h" → dueDate:"${currentDate}", dueTime:"12:00"
- "sáng/trưa/chiều/tối" → 08:00/12:00/15:00/19:00
- "hôm nay/mai" → ${currentDate}/${tomorrow}

🎭 RESPONSE STYLE - ${userContext.interaction_preference || 'balanced'}:
${this.getCompactStyleGuide(userContext.interaction_preference, userContext)}

📋 OUTPUT JSON: {mode, intent, confidence, needsConfirmation, messages: [{text, facialExpression, animation}], taskAction: {action, tasks: [{title, description, priority, category, dueDate, dueTime, status, tags, subtasks, reminders}]}, schedulingAction}

⚠️ CRITICAL - ABSOLUTELY REQUIRED IN EVERY RESPONSE: 
- **messages**: REQUIRED! ALWAYS include messages array with at least 1 message object containing text, facialExpression, and animation
- **taskAction**: REQUIRED! ALWAYS include taskAction (use "action": "none" if no task action)
- **schedulingAction**: REQUIRED! ALWAYS include schedulingAction (use "type": "none", "action": "none" if no scheduling)
- For learning plans: ALWAYS create MULTIPLE tasks (3-5 tasks) in tasks array
- ALWAYS include dueDate and dueTime for each task (use ${currentDate}, ${tomorrow}, weekdays: ${thisMonday}-${thisSunday}) hãy tính toán ngày cho đúng
- ALWAYS include relevant referenceLinks for tasks that benefit from additional resources (learning, work, research, health, shopping, etc.) with real, helpful URLs, ít nhất 2 tài liệu tham khảo

📋 OUTPUT FORMAT (chỉ JSON, không text khác):

GENERAL FORMAT:
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
      "text": "response_text_based_on_interaction_preference",
      "facialExpression": "smile|concerned|excited|thinking|surprised|funnyFace|default",
      "animation": "Talking_0|Talking_1|Talking_2|Thinking_0|Celebrating|Laughing|Rumba Dancing|Standing Idle|Terrified|Crying|Angry"
    }
  ],
  "taskAction": {
    "action": "create|update|delete|query|none",
    "tasks": [
      {
        "title": "task_title",
        "description": "task_description", 
        "priority": "low|medium|high|urgent",
        "category": "work|personal|health|learning|meeting|deep_work|communication|admin|break|shopping|entertainment|other",
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
        ],
        "referenceLinks": [
          {
            "title": "Resource Title",
            "url": "https://example.com/resource"
          }
        ]
      }
    ]
  },
  "schedulingAction": {
    "type": "daily_planning|rescheduling|weekly_planning|none",
    "action": "create_schedule|reschedule|weekly_plan|conflict_resolve|none",
    "timeScope": "today|tomorrow|this_week|next_week|null",
    "tasks": [
      {
        // UNIFIED STRUCTURE - same as taskAction.tasks + scheduling fields
        "title": "task_title",
        "description": "task_description",
        "priority": "low|medium|high|urgent",
        "category": "work|personal|health|learning|meeting|deep_work|communication|admin|break|shopping|entertainment|other",
        "dueDate": "YYYY-MM-DD_or_null",
        "dueTime": "HH:MM_or_null",
        "status": "pending|in_progress|completed|cancelled",
        "tags": ["keyword1", "keyword2"],
        // Scheduling-specific fields:
        "startTime": "HH:MM_or_null",
        "endTime": "HH:MM_or_null",
        "duration": "minutes_estimated",
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
- LEARNING PLANS: "Kế hoạch học deep learning", "Study plan for React", "Lên kế hoạch học tiếng Anh"
- CREATE MULTIPLE SPECIFIC TASKS (3-5 tasks) for learning plans, NOT generic templates
- 1-5 isolated tasks, no complex scheduling needed

📅 SCHEDULING MODE:
- Multiple tasks needing time allocation: "Hôm nay tôi có meeting A, task B, call C"
- Complex planning: "Sắp xếp schedule cho tôi"
- Rescheduling: "Meeting dời giờ, adjust lại"
- Weekly planning: "Tạo schedule template cho tuần" (ONLY for generic templates)
- Time conflicts and optimization needed

🚨 IMPORTANT: 
- "Kế hoạch học", "Learning plan", "Study plan" = SIMPLE_TASK mode (create multiple specific tasks), NOT SCHEDULING mode!
- Single assignments with deadlines: "làm bài tập X vào thứ 7" = SIMPLE_TASK mode, NOT scheduling
- Academic tasks/homework = SIMPLE_TASK mode even if time is mentioned

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

**📚 VÍ DỤ LEARNING PLAN - SIMPLE_TASK MODE:**

✅ Input: "Kế hoạch học deep learning"
✅ Response: mode: "simple_task", taskAction: {action: "create", tasks: [array_of_multiple_tasks]}
✅ Tạo 4-5 tasks cụ thể với THỜI GIAN:

{
  "taskAction": {
    "action": "create",
    "tasks": [
      {
        "title": "Đọc sách Deep Learning - Ian Goodfellow (Chapter 1-3)",
        "description": "Tìm hiểu các khái niệm cơ bản về deep learning",
        "priority": "high",
        "category": "learning",
        "dueDate": "${currentDate}",
        "dueTime": "09:00",
        "tags": ["deep-learning", "theory", "goodfellow"],
        "referenceLinks": [try to give me some references]
      },
      {
        "title": "Hoàn thành CS231n course - Lecture 1-5", 
        "description": "Xem video lectures và làm assignments",
        "priority": "high",
        "category": "learning",
        "dueDate": "${tomorrow}",
        "dueTime": "10:00",
        "tags": ["cs231n", "stanford", "cnn"],
        "referenceLinks": [try to give me some references]

      },
      {
        "title": "Code Neural Network from scratch với Python",
        "description": "Implement basic neural network không dùng framework",
        "priority": "medium", 
        "category": "learning",
        "dueDate": "${tomorrow}",
        "dueTime": "14:00",
        "tags": ["coding", "python", "neural-network"],
        "subtasks": [
          "Thiết lập môi trường Python và import thư viện",
          "Implement forward propagation",
          "Implement backpropagation và gradient descent",
          "Test và optimize neural network"
        ],
        "referenceLinks": [try to give me some references]

      }
    ]
  },
  "schedulingAction": {"type": "none", "action": "none"}
}

❌ KHÔNG được dùng: schedulingAction: {type: "weekly_planning"}
✅ PHẢI có dueDate và dueTime cho mỗi task (dùng ${currentDate}, ${tomorrow}, ${thisMonday}, ${thisFriday}, v.v.) hãy tính toán 

📚 REFERENCE LINKS GUIDELINES:
🎓 LEARNING TASKS: Always include 2-3 helpful links
- Deep Learning: official books, courses (Coursera, edX), documentation
- Programming: official docs, tutorials, GitHub repos, Stack Overflow guides
- Languages: official websites, interactive platforms (Duolingo, etc.)
- Certifications: official cert pages, practice exams

💼 WORK TASKS: Include relevant tools/resources
- Project management: Jira, Trello, Asana links
- Documentation: company wikis, official guides
- Tools: software documentation, tutorials

💪 HEALTH/FITNESS: Include reliable sources
- Workout plans: fitness apps, YouTube channels, official guides
- Nutrition: official health websites, meal planning tools

🛒 SHOPPING: Include helpful resources
- Price comparison sites, official product pages
- Review sites (for research tasks)

⚠️ IMPORTANT: Use REAL, working URLs - no fake links!

📝 SUBTASKS GUIDELINES:
🎯 CREATE SUBTASKS for complex tasks (estimated duration > 2 hours):

🎓 LEARNING/ACADEMIC TASKS:
Example: "Làm bài tập dự đoán hình ảnh"
"subtasks": [
  "Thu thập và chuẩn bị dataset", 
  "Tiền xử lý dữ liệu hình ảnh",
  "Thiết kế và implement model",
  "Training và fine-tuning model", 
  "Đánh giá kết quả và viết báo cáo"
]

💼 WORK PROJECTS:
Example: "Tạo tính năng thanh toán"
"subtasks": [
  "Thiết kế database schema",
  "Implement payment API", 
  "Tạo UI thanh toán",
  "Viết unit tests",
  "Deploy và testing"
]

🔬 RESEARCH TASKS:
Example: "Nghiên cứu về AI trong y tế"
"subtasks": [
  "Thu thập tài liệu nghiên cứu",
  "Phân tích các ứng dụng hiện tại", 
  "Tổng hợp findings",
  "Viết báo cáo tổng kết"
]

⚡ Simple tasks (< 2 hours): NO subtasks needed
Examples: "Chạy bộ 30 phút", "Gọi điện cho khách hàng", "Đọc email"

✅ Complex tasks (> 2 hours): 3-5 specific subtasks  
Examples: "Làm bài tập lập trình", "Nghiên cứu đề tài", "Tạo presentation"

🎯 WHEN TO ADD SUBTASKS:
- Learning projects, coding tasks, research work
- Work projects with multiple phases  
- Any task requiring planning or multiple steps

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
   * Get compact style guide for different interaction preferences
   * @param {string} preference - User's interaction preference
   * @param {Object} userContext - User context data
   * @returns {string} - Compact style guidelines
   */
  getCompactStyleGuide(preference, userContext) {
    const baseStyle = {
      detailed: "📝 Detailed: Comprehensive responses, step-by-step guidance, anticipate needs, explain context",
      concise: "⚡ Concise: Brief responses, key points only, minimal explanations, direct actions",
      conversational: "💬 Conversational: Friendly tone, casual language, show personality, relatable examples"
    };

    const style = baseStyle[preference] || baseStyle['detailed'];
    
    // Add personalization hints
    const hints = [];
    if (userContext.communication_style === 'professional') hints.push("Keep formal tone");
    if (userContext.work_style === 'analytical') hints.push("Include logical reasoning");
    if (userContext.motivation_factors?.includes('efficiency')) hints.push("Focus on productivity");
    
    return hints.length > 0 ? `${style}\n💡 Hints: ${hints.join(', ')}` : style;
  }

  /**
   * Build personalized context from user profile
   * @param {Object} userContext - User context data
   * @returns {string} - Formatted personalization context
   */
  buildUserPersonalizationContext(userContext) {
    console.log(`🎯 buildUserPersonalizationContext called with:`, {
      hasData: Object.keys(userContext).length > 0,
      keys: Object.keys(userContext),
      first_name: userContext.first_name,
      occupation: userContext.occupation,
      timezone: userContext.timezone
    });

    const sections = [];

    // Personal Info
    if (userContext.first_name || userContext.last_name) {
      sections.push(`📝 Personal: ${userContext.first_name || ''} ${userContext.last_name || ''}`.trim());
    }

    // Professional Info
    const professional = [];
    if (userContext.occupation) professional.push(`Occupation: ${userContext.occupation}`);
    if (userContext.company) professional.push(`Company: ${userContext.company}`);
    if (userContext.industry) professional.push(`Industry: ${userContext.industry}`);
    if (userContext.position_level) professional.push(`Level: ${userContext.position_level}`);
    if (userContext.work_location) professional.push(`Location: ${userContext.work_location}`);
    if (professional.length > 0) {
      sections.push(`💼 Professional: ${professional.join(', ')}`);
    }

    // Work Style & Communication
    const workStyle = [];
    if (userContext.work_style) workStyle.push(`Work style: ${userContext.work_style}`);
    if (userContext.communication_style) workStyle.push(`Communication: ${userContext.communication_style}`);
    if (userContext.interaction_preference) workStyle.push(`Interaction: ${userContext.interaction_preference}`);
    if (workStyle.length > 0) {
      sections.push(`🎯 Work Style: ${workStyle.join(', ')}`);
    }

    // Goals & Motivation  
    const goals = [];
    if (userContext.primary_goals && userContext.primary_goals.length > 0) {
      goals.push(`Primary goals: [${userContext.primary_goals.join(', ')}]`);
    }
    if (userContext.task_priorities) goals.push(`Task priority: ${userContext.task_priorities}`);
    if (userContext.planning_horizon) goals.push(`Planning: ${userContext.planning_horizon}`);
    if (userContext.motivation_factors && userContext.motivation_factors.length > 0) {
      goals.push(`Motivation: [${userContext.motivation_factors.join(', ')}]`);
    }
    if (goals.length > 0) {
      sections.push(`🎯 Goals & Motivation: ${goals.join(', ')}`);
    }

    // Learning & Growth
    const learning = [];
    if (userContext.learning_style) learning.push(`Learning style: ${userContext.learning_style}`);
    if (userContext.interests && userContext.interests.length > 0) {
      learning.push(`Interests: [${userContext.interests.join(', ')}]`);
    }
    if (userContext.stress_management && userContext.stress_management.length > 0) {
      learning.push(`Stress management: [${userContext.stress_management.join(', ')}]`);
    }
    if (learning.length > 0) {
      sections.push(`📚 Learning & Growth: ${learning.join(', ')}`);
    }

    // AI Preferences
    const aiPrefs = [];
    if (userContext.reminder_style) aiPrefs.push(`Reminder style: ${userContext.reminder_style}`);
    if (userContext.feedback_preference) aiPrefs.push(`Feedback: ${userContext.feedback_preference}`);
    if (userContext.privacy_level) aiPrefs.push(`Privacy: ${userContext.privacy_level}`);
    if (userContext.tech_level) aiPrefs.push(`Tech level: ${userContext.tech_level}`);
    if (userContext.device_usage) aiPrefs.push(`Device: ${userContext.device_usage}`);
    if (aiPrefs.length > 0) {
      sections.push(`🤖 AI Preferences: ${aiPrefs.join(', ')}`);
    }

    // Custom Instructions
    if (userContext.custom_instructions) {
      sections.push(`📋 Custom Instructions: "${userContext.custom_instructions}"`);
    }

    // Language & Communication
    if (userContext.language_preference) {
      sections.push(`🌐 Language: ${userContext.language_preference}`);
    }

    return sections.length > 0 ? sections.join('\n') : 'No personalization data available - using default settings';
  }

  /**
   * Get interaction preference guidelines for ChatGPT
   * @param {string} preference - User interaction preference
   * @returns {string} - Formatted guidelines
   */
  getInteractionPreferenceGuidelines(preference) {
    switch (preference) {
      case 'detailed':
        return `
📋 **CHI TIẾT MODE** - Detailed responses:
- Provide comprehensive explanations with step-by-step breakdown
- Include multiple options and alternatives when possible
- Give detailed context and reasoning behind suggestions
- Use structured format with clear sections and bullet points
- Explain potential consequences and considerations
- Example: "Để hoàn thành task này, bạn có thể làm theo 3 bước: 1) Chuẩn bị... 2) Thực hiện... 3) Kiểm tra..."
- Always include "why" behind recommendations
- Offer additional resources or next steps`;

      case 'concise':
        return `
⚡ **SÚC TÍCH MODE** - Concise responses:
- Keep responses short and direct, maximum 1-2 sentences
- Focus on essential information only, no extra explanations
- Use bullet points for multiple items
- Get straight to the point without context
- Example: "Task deadline: 2PM. Priority: High. Next action: Call client."
- Avoid elaborations unless specifically asked
- Use action-oriented language`;

      case 'conversational':
        return `
💬 **TRÒ CHUYỆN MODE** - Conversational responses:
- Use natural, friendly tone like talking to a friend
- Include casual expressions and encouraging words
- Ask follow-up questions to engage user
- Use emojis and casual language appropriately
- Example: "Hey! Nhớ gọi cho client lúc 2PM nhé. Việc này quan trọng đấy!"
- Show empathy and understanding
- Make responses feel personal and warm
- Use Vietnamese casual expressions naturally`;

      default:
        return `
📝 **BALANCED MODE** - Standard detailed responses:
- Provide clear but not overly lengthy explanations
- Balance information with readability
- Use structured format when helpful`;
    }
  }

  /**
   * Get message examples for interaction preferences
   * @param {string} preference - User interaction preference
   * @returns {string} - Message examples
   */
  getMessageExamples(preference, userContext = {}) {
    switch (preference) {
      case 'detailed':
        return `
**DETAILED MESSAGE EXAMPLES:**
✅ Task Creation: "Tôi đã tạo task 'Họp với giáo sư' cho bạn với các chi tiết sau: Thời gian là hôm nay 12:00, category Meeting, priority Medium. Để chuẩn bị tốt cho cuộc họp, bạn nên: 1) Review agenda trước, 2) Chuẩn bị câu hỏi, 3) Mang theo tài liệu cần thiết. Bạn có muốn tôi thêm reminder 15 phút trước không?"
- Use: facialExpression: "thinking", animation: "Talking_1"

✅ Task Update: "Task đã được cập nhật thành công! Những thay đổi bao gồm: Priority từ Medium → High, deadline moved từ 2PM → 4PM. Lý do tôi suggest giữ priority cao là vì task này ảnh hưởng đến timeline của project. Bạn có cần tôi điều chỉnh các task khác để phù hợp không?"
- Use: facialExpression: "smile", animation: "Talking_2"`;

      case 'concise':
        return `
**CONCISE MESSAGE EXAMPLES:**
✅ Task Creation: "✓ Tạo task 'Họp giáo sư' - 12:00 hôm nay. Reminder: 11:45."
- Use: facialExpression: "default", animation: "Talking_0"

✅ Task Update: "✓ Updated: Priority → High, Time → 4PM."
- Use: facialExpression: "smile", animation: "Talking_0"

✅ Error: "❌ Task not found. Check ID."
- Use: facialExpression: "concerned", animation: "Talking_0"`;

      case 'conversational':
        return `
**CONVERSATIONAL MESSAGE EXAMPLES:**
✅ Task Creation: "Hey ${userContext.first_name || 'bạn'}! 😊 Mình đã tạo task họp với giáo sư lúc 12h trưa hôm nay rồi nè! Cuộc họp này nghe có vẻ quan trọng đấy. Bạn có muốn mình nhắc nhở trước 15 phút không? Chúc bạn họp thành công nhé! 🎯"
- Use: facialExpression: "smile", animation: "Celebrating"

✅ Task Update: "Wow! 🎉 Task đã được update xong rồi đó! Priority giờ là High rồi, thời gian chuyển sang 4PM. Hình như việc này khá gấp nhỉ? Mình sẽ giúp bạn theo dõi thật kỹ! Còn việc gì khác cần support không? 😄"
- Use: facialExpression: "excited", animation: "Talking_2"

✅ Encouragement: "Chà! Bạn đã hoàn thành 5 tasks hôm nay rồi đấy! 🚀 Productive quá! Giờ nghỉ ngơi một chút đi, deserve it mà! ☕"
- Use: facialExpression: "smile", animation: "Laughing"`;

      default:
        return `
**BALANCED MESSAGE EXAMPLES:**
✅ Task Creation: "Đã tạo thành công task 'Họp với giáo sư' vào 12:00 hôm nay. Task được set priority Medium và category Meeting. Bạn muốn thêm reminder không?"
- Use: facialExpression: "smile", animation: "Talking_1"`;
    }
  }

  /**
   * Initialize or get session
   * @param {string} sessionId - Session ID
   * @param {Object} userContext - User context for system prompt
   * @returns {Array} - Message history
   */
  getSession(sessionId, userContext = {}) {
    console.log(`🔍 getSession called for ${sessionId}, exists: ${this.sessions.has(sessionId)}, hasUserContext: ${Object.keys(userContext).length > 0}`);
    
    if (!this.sessions.has(sessionId)) {
      console.log(`🆕 Creating new session ${sessionId} in getSession with userContext`);
      this.sessions.set(sessionId, [
        {
          role: "system",
          content: this.getSystemPrompt(userContext)
        }
      ]);
    }
    return this.sessions.get(sessionId);
  }

  /**
   * Add message to session and limit history size
   * @param {string} sessionId - Session ID
   * @param {Object} message - Message object
   * @param {Object} userContext - User context for system prompt update
   */
  addMessageToSession(sessionId, message, userContext = {}) {
    const messageHistory = this.getSession(sessionId, userContext);
    
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
   * Update system prompt for existing session with fresh date/time
   * @param {string} sessionId - Session ID
   * @param {Object} userContext - User context with timezone
   */
  updateSystemPrompt(sessionId, userContext = {}) {
    console.log(`🔄 updateSystemPrompt called for session ${sessionId} with userContext:`, {
      hasData: Object.keys(userContext).length > 0,
      timezone: userContext.timezone,
      sessionExists: this.sessions.has(sessionId)
    });

    if (this.sessions.has(sessionId)) {
      const messageHistory = this.sessions.get(sessionId);
      // Update the system message (first message) with fresh prompt
      messageHistory[0] = {
        role: "system",
        content: this.getSystemPrompt(userContext)
      };
      this.sessions.set(sessionId, messageHistory);
      console.log(`✅ System prompt updated for existing session ${sessionId}`);
    } else {
      // Create new session with userContext if session doesn't exist
      console.log(`🆕 Creating new session ${sessionId} with userContext`);
      this.sessions.set(sessionId, [
        {
          role: "system",
          content: this.getSystemPrompt(userContext)
        }
      ]);
    }
  }

  /**
   * Fetch user profile with timezone
   * @param {string} userId - User ID
   * @returns {Object} - User profile data
   */
  async fetchUserProfile(userId) {
    try {
      console.log(`👤 Fetching user profile for user: ${userId}`);
      
      const response = await axios.get(`${config.pythonApi.url}/api/v1/onboarding/profile/${userId}`, {
        timeout: config.pythonApi.timeout,
        headers: {
          'Content-Type': 'application/json',
          'X-Source': 'nodejs-server'
        }
      });

      const profile = response.data || {};
      console.log(`✅ Fetched user profile: ${profile.first_name || 'Unknown'}, timezone=${profile.timezone || 'UTC'}`);
      
      // Return comprehensive personalization data
      return {
        // Personal Info
        first_name: profile.first_name,
        last_name: profile.last_name,
        
        // Professional Info  
        occupation: profile.occupation,
        company: profile.company,
        industry: profile.industry,
        position_level: profile.position_level,
        work_location: profile.work_location,
        
        // Work Style & Communication
        work_style: profile.work_style,
        communication_style: profile.communication_style,
        interaction_preference: profile.interaction_preference,
        working_hours: profile.working_hours,
        break_style: profile.break_style,
        
        // Goals & Motivation
        primary_goals: profile.primary_goals || [],
        task_priorities: profile.task_priorities,
        planning_horizon: profile.planning_horizon,
        success_metrics: profile.success_metrics || [],
        motivation_factors: profile.motivation_factors || [],
        
        // Learning & Growth
        interests: profile.interests || [],
        learning_style: profile.learning_style,
        stress_management: profile.stress_management || [],
        
        // Technical Preferences
        timezone: profile.timezone || 'UTC',
        language_preference: profile.language_preference || 'en',
        device_usage: profile.device_usage,
        tech_level: profile.tech_level,
        notification_preferences: profile.notification_preferences || [],
        
        // AI Assistant Settings
        custom_instructions: profile.custom_instructions,
        reminder_style: profile.reminder_style,
        feedback_preference: profile.feedback_preference,
        privacy_level: profile.privacy_level
      };

    } catch (error) {
      console.error(`❌ Error fetching user profile for ${userId}:`, error.message);
      return {
        timezone: 'UTC',
        language_preference: 'en'
      };
    }
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
        due_date: task.dueDate,
        due_time: task.dueTime, // HH:MM
        duration: task.estimatedDuration // minutes
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
   * @param {Object} userContext - User profile data from FE (optional)
   * @returns {Object} - AI response
   */
  async processConversation(userMessage, sessionId, userId = null, userContext = {}) {
    console.log(`🔧 processConversation called with userContext:`, {
      hasUserContext: Object.keys(userContext).length > 0,
      timezone: userContext.timezone,
      name: `${userContext.first_name || ''} ${userContext.last_name || ''}`.trim(),
      communication_style: userContext.communication_style
    });

    // Use provided userContext from FE, or fetch if not provided

    
    // Fetch existing tasks if userId provided and it's a task/scheduling related intent
    let existingTasksContext = "";

    const taskData = await this.fetchUserTasks(userId);
    if (taskData.tasks.length > 0) {
      existingTasksContext = `\n\n📋 EXISTING TASKS (${taskData.count} total):\n${JSON.stringify(taskData.tasks, null, 2)}\n\n⚠️ IMPORTANT: Check for time conflicts and duplicate tasks before creating new ones!`;
    } else {
      existingTasksContext = "\n\n📋 EXISTING TASKS: No existing tasks found.";
    }
    
    
    // Update system prompt with fresh date/time before AI call
    this.updateSystemPrompt(sessionId, userContext);
    
    // Add user message with existing tasks context to history
    this.addMessageToSession(sessionId, {
      role: "user", 
      content: userMessage + existingTasksContext
    }, userContext);

    // Get updated message history
    const messageHistory = this.getSession(sessionId, userContext);
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
      console.log(`🔍 Raw ChatGPT response:`, aiResponseRaw);
      
      // Extract token usage information
      const tokenUsage = completion.usage || {};
      console.log(`📊 Token usage:`, tokenUsage);
      
      const parsedResponse = JSON.parse(aiResponseRaw);
      console.log(`📋 Parsed taskAction:`, JSON.stringify(parsedResponse.taskAction, null, 2));
      
      // ===== VALIDATION: Ensure messages field exists =====
      if (!parsedResponse.messages || !Array.isArray(parsedResponse.messages) || parsedResponse.messages.length === 0) {
        console.warn(`⚠️ ChatGPT response missing messages array, generating default message`);
        
        // Generate default message based on mode and intent
        let defaultText = "Đã xử lý yêu cầu của bạn.";
        let defaultExpression = "smile";
        let defaultAnimation = "Talking_1";
        
        if (parsedResponse.mode === "simple_task" && parsedResponse.taskAction?.action === "create") {
          const taskCount = parsedResponse.taskAction.tasks?.length || 0;
          if (taskCount > 1) {
            defaultText = `Tôi đã tạo ${taskCount} tasks cho kế hoạch của bạn! Hãy cố gắng hoàn thành nhé! 🎯`;
            defaultExpression = "smile";
            defaultAnimation = "Celebrating";
          } else if (taskCount === 1) {
            defaultText = `Đã tạo task "${parsedResponse.taskAction.tasks[0]?.title || 'mới'}" thành công! ✅`;
            defaultExpression = "smile";
            defaultAnimation = "Talking_2";
          }
        } else if (parsedResponse.mode === "scheduling") {
          defaultText = "Đã sắp xếp lịch trình cho bạn! 📅";
          defaultExpression = "smile";
          defaultAnimation = "Talking_1";
        }
        
        // Set default messages
        parsedResponse.messages = [{
          text: defaultText,
          facialExpression: defaultExpression,
          animation: defaultAnimation
        }];
      }
      
      // Add token usage to response
      parsedResponse.tokenUsage = tokenUsage;
      
      // Add AI response to conversation history
      this.addMessageToSession(sessionId, {
        role: "assistant",
        content: aiResponseRaw
      }, userContext);

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