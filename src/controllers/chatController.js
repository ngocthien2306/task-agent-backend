import { AudioService } from "../services/audioService.js";
import { IntentClassifier } from "../services/intentClassifier.js";
import { ConversationService } from "../services/conversationService.js";
import { createResponse, createIntroMessages, createErrorMessage } from "../utils/responseHelper.js";
import config from "../config/index.js";

export class ChatController {
  constructor() {
    this.audioService = new AudioService();
    this.intentClassifier = new IntentClassifier();
    this.conversationService = new ConversationService();
  }

  /**
   * Main chat endpoint handler
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async handleChat(req, res) {
    const userMessage = req.body.message;
    const sessionId = req.body.sessionId || 'default';
    const userId = req.body.user_id || 'anonymous';
    
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
        // Classify user intent
        classification = await this.intentClassifier.classifyIntent(userMessage, userId);
        
        // Route request based on classification
        routing = await this.intentClassifier.routeRequest(classification, userMessage, userId, sessionId);
        
        console.log(`📍 Routing decision:`, routing);
        
        // Handle different routes
        if (routing.route === 'task-operation-placeholder') {
          const response = await this.createPlaceholderResponse(routing, classification);
          res.send(response);
          return;
        }
        
        // If route is process-conversation, continue with conversation logic
        if (routing.route === 'process-conversation') {
          console.log(`💬 Processing as conversation/task creation with mode: ${routing.intentType}`);
          
          try {
            // Process conversation with OpenAI
            const parsedResponse = await this.conversationService.processConversation(userMessage, sessionId);
            
            // Extract messages
            let messages = parsedResponse.messages || [parsedResponse];
            
            console.log(`🎭 Processing ${messages.length} messages for audio generation...`);
            console.log(`📊 Mode: ${parsedResponse.mode}, Intent: ${parsedResponse.intent}`);

            // Generate audio and lipsync for all messages
            await this.audioService.generateMessagesAudio(messages, "message");

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
}