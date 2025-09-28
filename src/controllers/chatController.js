import { AudioService } from "../services/audioService.js";
import { IntentClassifier } from "../services/intentClassifier.js";
import { ConversationService } from "../services/conversationService.js";
import { TaskOperationService } from "../services/taskOperationService.js";
import { createResponse, createIntroMessages, createErrorMessage } from "../utils/responseHelper.js";
import config from "../config/index.js";

export class ChatController {
  constructor() {
    this.audioService = new AudioService();
    this.intentClassifier = new IntentClassifier();
    this.conversationService = new ConversationService();
    this.taskOperationService = new TaskOperationService();
  }

  /**
   * Main chat endpoint handler
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async handleChat(req, res) {
    const userMessage = req.body.message;
    const sessionId = req.body.sessionId || 'default';
    const userId = req.body.userId || req.body.user_id || 'anonymous';
    
    console.log(`💬 New chat request from user: ${userId}, session: ${sessionId}`);
    console.log(`📝 User message: ${userMessage}`);

    try {
      // Handle intro message if no user message
      if (!userMessage) {
        const introMessages = createIntroMessages();
        
        // Try to use existing audio files first, generate if not found
        const messagesWithAudio = await this.audioService.loadOrGenerateAudio(introMessages, "intro");
        
        res.send({ messages: messagesWithAudio });
        return;
      }
      
      // Check OpenAI API key
      if (config.openai.apiKey === "-") {
        await this.sendErrorResponse(res, "Oops! OpenAI API key bị thiếu. Vui lòng thêm API key để tiếp tục!", 401, "Missing API key");
        return;
      }

      // ===== INTENT CLASSIFICATION =====
      console.log(`🎯 Starting intent classification...`);
      
      let classification = null;
      let routing = null;
      
      try {
        // Get conversation history for context-aware classification
        const conversationHistory = this.conversationService.getSession(sessionId);
        
        // Classify user intent with conversation context
        classification = await this.intentClassifier.classifyIntent(userMessage, userId, conversationHistory);
        
        // Route request based on classification
        routing = await this.intentClassifier.routeRequest(classification, userMessage, userId, sessionId);
        
        console.log(`📍 Routing decision:`, routing);
        
        // Handle task operations route
        if (routing.route === 'task-operations') {
          // Check for pending task operation confirmation first
          const taskOperationConfirmation = this.conversationService.getPendingConfirmation(sessionId);
          if (taskOperationConfirmation && taskOperationConfirmation.type === 'task_operation' && 
              this.conversationService.isConfirmationResponse(userMessage, taskOperationConfirmation)) {
            console.log(`✅ Detected task operation confirmation for session ${sessionId}`);
            this.conversationService.clearPendingConfirmation(sessionId);
            await this.handleTaskOperationConfirmation(userMessage, taskOperationConfirmation, sessionId, userId, res);
            return;
          }
          
          await this.handleTaskOperations(userMessage, sessionId, userId, classification, routing, res);
          return;
        }
        
        // If route is process-conversation, continue with conversation logic
        if (routing.route === 'process-conversation') {
          console.log(`💬 Processing as conversation/task creation with mode: ${routing.intentType}`);
          
          try {
            // ===== CHECK FOR PENDING CONFIRMATIONS =====
            const pendingConfirmation = this.conversationService.getPendingConfirmation(sessionId);
            
            if (pendingConfirmation && this.conversationService.isConfirmationResponse(userMessage, pendingConfirmation)) {
              console.log(`✅ Detected confirmation response for session ${sessionId}`);
              
              // Clear pending confirmation first
              this.conversationService.clearPendingConfirmation(sessionId);
              
              // Handle regular conversation confirmation (existing logic)
              const combinedInput = `${pendingConfirmation.originalUserInput}\n\nThông tin bổ sung từ user: ${userMessage}`;
              console.log(`🔄 Processing combined input with OpenAI:`, combinedInput.substring(0, 100) + "...");
              
              let finalResponse;
              try {
                finalResponse = await this.conversationService.processConversation(combinedInput, sessionId, userId);
              } catch (error) {
                console.log(`⚠️ OpenAI failed for confirmation, using merged pending data`);
                finalResponse = this.conversationService.mergeConfirmationData(userMessage, pendingConfirmation);
              }
              
              // Extract messages
              let messages = finalResponse.messages || [finalResponse];
              
              // Generate audio for all messages
              await this.audioService.generateMessagesAudio(messages, "confirmation");
              
              // Send to Python API immediately (no more confirmation needed)
              this.conversationService.addToBackgroundQueue({
                type: 'confirmation_completion',
                userInput: combinedInput,
                aiResponse: finalResponse,
                sessionId: sessionId,
                userId: userId,
                isConfirmed: true
              });
              
              console.log(`🚀 Sending confirmed response with ${messages.length} messages`);
              const response = createResponse(messages, {
                mode: finalResponse.mode,
                intent: finalResponse.intent,
                confidence: finalResponse.confidence,
                sessionId: sessionId,
                processing: "confirmed_and_queued",
                classification: classification,
                routing: routing
              });
              
              res.send(response);
              return;
            }
            
            // ===== NORMAL CONVERSATION PROCESSING =====
            // Process conversation with OpenAI, including userId for task fetching
            const parsedResponse = await this.conversationService.processConversation(userMessage, sessionId, userId);
            
            // Extract messages
            let messages = parsedResponse.messages || [parsedResponse];
            
            console.log(`🎭 Processing ${messages.length} messages for audio generation...`);
            console.log(`📊 Mode: ${parsedResponse.mode}, Intent: ${parsedResponse.intent}`);
            console.log(`🔍 Needs confirmation: ${parsedResponse.needsConfirmation || false}`);

            // Generate audio and lipsync for all messages
            await this.audioService.generateMessagesAudio(messages, "message");

            // ===== CHECK IF RESPONSE NEEDS CONFIRMATION =====
            if (this.conversationService.needsConfirmation(parsedResponse)) {
              console.log(`⏳ Response needs confirmation, storing pending data...`);
              
              // Store pending confirmation data instead of sending to Python API
              this.conversationService.storePendingConfirmation(sessionId, {
                ...parsedResponse,
                originalUserInput: userMessage,
                originalClassification: classification,
                originalRouting: routing
              });
              
              console.log(`🚀 Sending confirmation request with ${messages.length} messages`);
              const response = createResponse(messages, {
                mode: parsedResponse.mode,
                intent: parsedResponse.intent,
                confidence: parsedResponse.confidence,
                sessionId: sessionId,
                processing: "awaiting_confirmation",
                needsConfirmation: true,
                confirmationType: parsedResponse.confirmationType,
                classification: classification,
                routing: routing
              });
              
              res.send(response);
              return;
            }

            // ===== NO CONFIRMATION NEEDED - PROCESS NORMALLY =====
            // Add to background queue for database processing
            this.conversationService.addToBackgroundQueue({
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
            await this.sendErrorResponse(res, undefined, 500, error.message);
          }
        }
        
      } catch (classificationError) {
        console.error("❌ Error in intent classification:", classificationError);
        await this.sendErrorResponse(res, "Xin lỗi, tôi đang gặp vấn đề trong việc hiểu yêu cầu của bạn. Vui lòng thử lại!", 500, "Classification error");
      }

    } catch (error) {
      console.error("❌ Error in chat handler:", error);
      await this.sendErrorResponse(res, undefined, 500, error.message);
    }
  }

  /**
   * Send error response with audio
   * @param {Object} res - Express response object
   * @param {string} errorText - Error message text
   * @param {number} statusCode - HTTP status code
   * @param {string} errorDetails - Additional error details
   */
  async sendErrorResponse(res, errorText = "Sorry, tôi đang gặp một chút vấn đề technical. Bạn có thể thử lại không?", statusCode = 500, errorDetails = "Internal server error") {
    try {
      const errorMessages = [createErrorMessage(errorText)];

      // Generate audio for error message
      await this.audioService.generateMessagesAudio(errorMessages, "error");

      res.status(statusCode).send(createResponse(errorMessages, {
        error: { message: errorDetails }
      }));
      
    } catch (audioError) {
      console.error("Error generating error message audio:", audioError);
      // Send response without audio if audio generation fails
      res.status(statusCode).send({
        messages: [createErrorMessage(errorText)],
        error: errorDetails
      });
    }
  }

  /**
   * Create placeholder response for unimplemented features
   * @param {Object} routing - Routing information
   * @param {Object} classification - Classification information
   * @returns {Object} - Response object
   */
  async createPlaceholderResponse(routing, classification) {
    const placeholderMessages = [createErrorMessage(routing.message)];

    await this.audioService.generateMessagesAudio(placeholderMessages, "placeholder");

    return createResponse(placeholderMessages, {
      intentType: routing.intentType,
      classification: classification,
      routing: routing
    });
  }

  /**
   * Get background job status
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  getJobStatus(req, res) {
    const status = this.conversationService.getJobStatus();
    res.json(status);
  }

  /**
   * Manually trigger background job processing
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  processJobs(req, res) {
    this.conversationService.processBackgroundJobs();
    const status = this.conversationService.getJobStatus();
    res.json({
      message: "Background job processing triggered",
      queueSize: status.queueSize
    });
  }

  /**
   * Handle task operations (query, update, delete, stats)
   * @param {string} userMessage - User message
   * @param {string} sessionId - Session ID
   * @param {string} userId - User ID
   * @param {Object} classification - Intent classification
   * @param {Object} routing - Routing decision
   * @param {Object} res - Express response object
   */
  async handleTaskOperations(userMessage, sessionId, userId, classification, routing, res) {
    try {
      console.log(`🔧 Handling task operations for user: ${userId}`);
      
      // Fetch current user tasks
      const taskData = await this.conversationService.fetchUserTasks(userId);
      console.log(`📋 Found ${taskData.count} existing tasks for operations`);
      
      // Process with task operation service
      const operationResponse = await this.taskOperationService.processTaskOperation(
        userMessage, 
        taskData.tasks, 
        sessionId
      );
      
      console.log(`🎯 Operation: ${operationResponse.operation}, Needs confirmation: ${operationResponse.needsConfirmation}`);
      
      // Handle confirmation flow
      if (operationResponse.needsConfirmation) {
        // Store pending operation for confirmation
        this.conversationService.storePendingConfirmation(sessionId, {
          type: 'task_operation',
          confirmationType: operationResponse.confirmationType,
          pendingData: operationResponse,
          originalUserInput: userMessage,
          operation: operationResponse.operation
        });
        
        // Generate audio for confirmation message
        await this.audioService.generateMessagesAudio(operationResponse.messages, "task_operation");
        
        const response = createResponse(operationResponse.messages, {
          mode: "task_operation",
          intent: operationResponse.intent,
          confidence: operationResponse.confidence,
          sessionId: sessionId,
          needsConfirmation: true,
          confirmationType: operationResponse.confirmationType,
          classification: classification,
          routing: routing
        });
        
        res.send(response);
        return;
      }
      
      // Execute operation immediately if no confirmation needed
      const executionResult = await this.taskOperationService.executeTaskOperation(
        operationResponse.taskOperation, 
        userId
      );
      
      console.log(`✅ Operation executed:`, executionResult.success ? 'Success' : 'Failed');
      
      // Generate response messages based on operation result
      let resultMessages = Array.isArray(operationResponse.messages) ? operationResponse.messages : [];
      
      if (executionResult.success) {
        // Add success message based on operation type
        const successMessage = this.createOperationSuccessMessage(
          operationResponse.operation, 
          executionResult
        );
        resultMessages = [...resultMessages, successMessage];
      } else {
        // Add error message
        resultMessages = [...resultMessages, {
          text: `❌ Có lỗi xảy ra: ${executionResult.error}`,
          facialExpression: "concerned",
          animation: "Talking_0"
        }];
      }
      
      // Generate audio for all messages
      await this.audioService.generateMessagesAudio(resultMessages, "task_operation");
      
      // Prepare response with task data for FE
      const responseData = {
        mode: "task_operation",
        intent: operationResponse.intent,
        confidence: operationResponse.confidence,
        sessionId: sessionId,
        operationResult: executionResult,
        classification: classification,
        routing: routing
      };

      // Include task data for query operations to show in FE toast
      if (operationResponse.operation === 'query' && executionResult.success && executionResult.results) {
        responseData.taskData = {
          operation: 'query',
          tasks: executionResult.results,
          count: executionResult.count,
          filters: executionResult.filters,
          displayType: 'toast' // Hint for FE to show as toast
        };
      }

      // Include updated task data for update operations
      if (operationResponse.operation === 'update' && executionResult.success && executionResult.updated_tasks) {
        responseData.taskData = {
          operation: 'update',
          tasks: executionResult.updated_tasks,
          count: executionResult.count,
          displayType: 'toast'
        };
      }

      // Include completed task data for mark_complete operations
      if (operationResponse.operation === 'mark_complete' && executionResult.success && executionResult.completed_tasks) {
        responseData.taskData = {
          operation: 'mark_complete',
          tasks: executionResult.completed_tasks,
          count: executionResult.count,
          displayType: 'toast'
        };
      }

      const response = createResponse(resultMessages, responseData);
      
      // Debug logging for task data
      if (responseData.taskData) {
        console.log(`📋 Sending taskData to FE:`, {
          operation: responseData.taskData.operation,
          taskCount: responseData.taskData.count,
          displayType: responseData.taskData.displayType
        });
      }
      
      res.send(response);
      
    } catch (error) {
      console.error("❌ Error in task operations:", error);
      await this.sendErrorResponse(res, "Sorry, có lỗi xảy ra khi xử lý thao tác với task.", 500, error.message);
    }
  }

  /**
   * Create success message based on operation type
   * @param {string} operation - Operation type
   * @param {Object} result - Execution result
   * @returns {Object} - Success message
   */
  createOperationSuccessMessage(operation, result) {
    switch (operation) {
      case 'query':
        return {
          text: `✅ Tìm thấy ${result.count} tasks phù hợp với yêu cầu của bạn.`,
          facialExpression: "smile",
          animation: "Talking_0"
        };
        
      case 'update':
      case 'priority_change':
      case 'mark_complete':
        const taskName = result.updated_tasks?.[0]?.title || result.updated_tasks?.[0]?.updated_task?.title || 'task';
        return {
          text: `✅ Đã cập nhật ${taskName} thành công!`,
          facialExpression: "smile", 
          animation: "Celebrating"
        };
        
      case 'delete':
        return {
          text: `✅ Đã xóa ${result.count} task(s) thành công.`,
          facialExpression: "smile",
          animation: "Talking_0"
        };
        
      case 'stats':
        return {
          text: `📊 Thống kê: ${result.stats.total_tasks} tasks, hoàn thành ${result.stats.completion_rate}%.`,
          facialExpression: "smile",
          animation: "Talking_1"
        };
        
      default:
        return {
          text: "✅ Thao tác hoàn thành thành công!",
          facialExpression: "smile",
          animation: "Talking_1"
        };
    }
  }

  /**
   * Handle task operation confirmation
   * @param {string} userMessage - User confirmation message
   * @param {Object} pendingConfirmation - Pending confirmation data
   * @param {string} sessionId - Session ID
   * @param {string} userId - User ID
   * @param {Object} res - Express response object
   */
  async handleTaskOperationConfirmation(userMessage, pendingConfirmation, sessionId, userId, res) {
    try {
      console.log(`🔧 Handling task operation confirmation: ${pendingConfirmation.operation}`);
      
      const operationData = pendingConfirmation.pendingData;
      
      // Update operation with user confirmation if needed
      if (pendingConfirmation.confirmationType === 'task_selection') {
        // User provided task selection/clarification
        operationData.taskOperation.userSelection = userMessage;
      } else if (pendingConfirmation.confirmationType === 'update_details') {
        // User provided additional update details
        operationData.taskOperation.updateData.userInput = userMessage;
      }
      
      // Execute the confirmed operation
      const executionResult = await this.taskOperationService.executeTaskOperation(
        operationData.taskOperation, 
        userId
      );
      
      console.log(`✅ Confirmed operation executed:`, executionResult.success ? 'Success' : 'Failed');
      
      // Generate response messages
      let responseMessages = [];
      
      if (executionResult.success) {
        responseMessages = [
          {
            text: "Perfect! Đã xác nhận và thực hiện thao tác thành công.",
            facialExpression: "smile",
            animation: "Celebrating"
          },
          this.createOperationSuccessMessage(operationData.operation, executionResult)
        ];
      } else {
        responseMessages = [
          {
            text: `❌ Có lỗi khi thực hiện: ${executionResult.error}`,
            facialExpression: "concerned",
            animation: "Talking_0"
          }
        ];
      }
      
      // Generate audio for messages
      await this.audioService.generateMessagesAudio(responseMessages, "task_operation_confirmed");
      
      // Prepare response data
      const responseData = {
        mode: "task_operation",
        intent: operationData.intent,
        confidence: operationData.confidence,
        sessionId: sessionId,
        operationResult: executionResult,
        confirmed: true
      };

      // Include task data for confirmed operations
      if (executionResult.success) {
        if (operationData.operation === 'delete' && executionResult.deleted_tasks) {
          responseData.taskData = {
            operation: 'delete',
            tasks: executionResult.deleted_tasks,
            count: executionResult.count,
            displayType: 'toast'
          };
        } else if (operationData.operation === 'update' && executionResult.updated_tasks) {
          responseData.taskData = {
            operation: 'update',
            tasks: executionResult.updated_tasks,
            count: executionResult.count,
            displayType: 'toast'
          };
        } else if (operationData.operation === 'mark_complete' && executionResult.completed_tasks) {
          responseData.taskData = {
            operation: 'mark_complete',
            tasks: executionResult.completed_tasks,
            count: executionResult.count,
            displayType: 'toast'
          };
        }
      }

      const response = createResponse(responseMessages, responseData);
      
      // Debug logging for confirmed task data
      if (responseData.taskData) {
        console.log(`📋 Sending confirmed taskData to FE:`, {
          operation: responseData.taskData.operation,
          taskCount: responseData.taskData.count,
          displayType: responseData.taskData.displayType
        });
      }
      
      res.send(response);
      
    } catch (error) {
      console.error("❌ Error in task operation confirmation:", error);
      await this.sendErrorResponse(res, error, "task operation confirmation", sessionId);
    }
  }
}