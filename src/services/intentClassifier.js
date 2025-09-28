import OpenAI from "openai";
import config from "../config/index.js";

export class IntentClassifier {
  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openai.apiKey,
    });
  }

  /**
   * Classify user intent with conversation context
   * @param {string} userInput - User input text
   * @param {string} userId - User ID for context
   * @param {Array} conversationHistory - Previous conversation messages
   * @returns {Object} - Classification result
   */
  async classifyIntent(userInput, userId, conversationHistory = []) {
    // Extract recent context for confirmation detection
    const recentMessages = conversationHistory.slice(-5); // Last 3 messages
    const contextString = recentMessages.length > 0 
      ? `\n\nCONVERSATION CONTEXT (recent messages):\n${recentMessages.map(msg => `${msg.role}: ${msg.content}`).join('\n')}`
      : '';

    const prompt = `
Bạn là một AI classifier chuyên phân tích intent của user trong hệ thống quản lý task.

🔍 QUAN TRỌNG: Kiểm tra CONVERSATION CONTEXT để detect confirmation responses!

INPUT: "${userInput}"${contextString}

Hãy phân tích và trả về JSON với format sau:

{
  "intentType": "conversation|simple_task|scheduling|task_query|task_update|task_delete|task_stats|task_priority",
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


🔍 CONTEXT-AWARE CLASSIFICATION RULES:

**CONFIRMATION DETECTION:**
- Nếu context cho thấy hệ thống vừa hỏi confirmation (needsConfirmation: true), và user trả lời "có", "được", "ok", "yes" → PRESERVE original intent type từ context
- VD: Context: "Bạn chắc muốn xóa task X?", User: "Có" → intentType: "task_delete" (NOT conversation)
- Confirmation keywords: "có", "được", "ok", "yes", "đồng ý", "xác nhận", "chắc chắn"

**REGULAR CLASSIFICATION:**
- Nếu có nhắc đến tên task cụ thể → taskIdentifier
- Confidence cao khi intent rõ ràng
- Ưu tiên task operations nếu có keyword liên quan task
- Context giúp phân biệt confirmation vs new request
- Nếu không chắc chắn, default về conversation với confidence thấp

**IMPORTANT:** 
- Luôn kiểm tra conversation context TRƯỚC KHI classify
- Confirmation responses PHẢI preserve original intent từ context
- Chỉ classify như conversation KHI thực sự là new conversation
`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: config.openai.model,
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
  }

  /**
   * Route request based on intent classification
   * @param {Object} classification - Classification result
   * @param {string} userInput - User input
   * @param {string} userId - User ID
   * @param {string} sessionId - Session ID
   * @returns {Object} - Routing decision
   */
  async routeRequest(classification, userInput, userId, sessionId) {
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

    // Task operations - route to dedicated task operations handler
    if (['task_query', 'task_update', 'task_delete', 'task_stats', 'task_priority', 'task_reminder'].includes(intentType)) {
      console.log(`📋 Task operation detected: ${intentType} - Routing to task operations handler`);
      
      return {
        route: 'task-operations',
        intentType: intentType,
        taskIdentifier: taskIdentifier,
        action: action,
        confidence: confidence
      };
    }

    // Default fallback
    return {
      route: 'process-conversation',
      intentType: 'conversation'
    };
  }
}