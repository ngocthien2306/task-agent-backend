/**
 * Create standardized response with metadata
 * @param {Array} messages - Array of message objects
 * @param {Object} options - Additional options
 * @returns {Object} - Standardized response object
 */
export const createResponse = (messages, options = {}) => {
  const {
    mode = null,
    intent = null,
    confidence = null,
    sessionId = null,
    classification = null,
    routing = null,
    processing = null,
    error = null,
    taskData = null
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
  
  // Add taskData to top level of response for FE
  if (taskData) {
    response.taskData = taskData;
  }
  
  return response;
};

/**
 * Create intro messages
 * @returns {Array} - Array of intro message objects
 */
export const createIntroMessages = () => {
  return [
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
};

/**
 * Create error message object
 * @param {string} text - Error message text
 * @returns {Object} - Error message object
 */
export const createErrorMessage = (text = "Sorry, tôi đang gặp một chút vấn đề technical. Bạn có thể thử lại không?") => {
  return {
    text,
    facialExpression: "concerned",
    animation: "Thinking_0",
  };
};