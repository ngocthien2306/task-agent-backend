import axios from 'axios';
import config from '../config/index.js';

/**
 * Subscription middleware - Checks user subscription limits before processing chat requests
 */
export class SubscriptionMiddleware {
  constructor() {
    this.pythonApiUrl = config.pythonApi.url;
    this.timeout = config.pythonApi.timeout;
  }

  /**
   * Check subscription limits before processing request
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Next middleware function
   */
  async checkSubscriptionLimits(req, res, next) {
    try {
      const userId = req.body.userId || req.body.user_id || 'anonymous';
      const estimatedTokens = this.estimateTokens(req.body.message || '');
      
      console.log(`🔒 Checking subscription limits for user: ${userId}, estimated tokens: ${estimatedTokens}`);

      // Call Python API to check limits
      const response = await axios.post(
        `${this.pythonApiUrl}/api/v1/usage/check-limit`,
        {
          user_id: userId,
          estimated_tokens: estimatedTokens
        },
        {
          timeout: this.timeout,
          headers: {
            'Content-Type': 'application/json',
            'X-Source': 'nodejs-middleware'
          }
        }
      );

      const limitCheck = response.data;
      
      if (!limitCheck.can_proceed) {
        console.log(`❌ Subscription limit exceeded for user ${userId}: ${limitCheck.reason}`);
        
        // Return limit exceeded response
        return res.status(429).json({
          success: false,
          error: 'subscription_limit_exceeded',
          message: this.getLimitExceededMessage(limitCheck.reason),
          details: {
            reason: limitCheck.reason,
            suggested_action: limitCheck.suggested_action,
            subscription: this.sanitizeSubscriptionData(limitCheck.subscription)
          }
        });
      }

      // Store subscription info in request for later use
      req.subscriptionInfo = {
        subscription: limitCheck.subscription,
        estimated_tokens: estimatedTokens,
        estimated_cost: limitCheck.estimated_cost || 0
      };

      console.log(`✅ Subscription check passed for user ${userId}`);
      next();

    } catch (error) {
      console.error(`❌ Error checking subscription limits:`, error.message);
      
      if (error.response) {
        console.error(`HTTP ${error.response.status}:`, error.response.data);
        
        // If Python API is down, allow request but log error
        if (error.response.status >= 500) {
          console.log(`⚠️ Python API error, allowing request to proceed`);
          req.subscriptionInfo = { error: 'api_unavailable' };
          return next();
        }
      }

      // For other errors, return error response
      res.status(503).json({
        success: false,
        error: 'subscription_check_failed',
        message: 'Không thể kiểm tra subscription hiện tại. Vui lòng thử lại sau.',
        details: { error: error.message }
      });
    }
  }

  /**
   * Track token usage after successful request
   * @param {string} userId - User ID
   * @param {string} sessionId - Session ID
   * @param {Object} tokenUsage - Token usage from OpenAI
   * @param {Object} requestInfo - Additional request information
   */
  async trackTokenUsage(userId, sessionId, tokenUsage, requestInfo = {}) {
    try {
      console.log(`📊 Tracking token usage for user ${userId}: ${tokenUsage.total_tokens} tokens`);

      const usageData = {
        user_id: userId,
        session_id: sessionId,
        tokens_consumed: tokenUsage.total_tokens || 0,
        input_tokens: tokenUsage.prompt_tokens || 0,
        output_tokens: tokenUsage.completion_tokens || 0,
        request_type: requestInfo.request_type || 'chat',
        model_used: requestInfo.model_used || 'gpt-3.5-turbo',
        endpoint: requestInfo.endpoint || '/chat'
      };

      const response = await axios.post(
        `${this.pythonApiUrl}/api/v1/usage/track`,
        usageData,
        {
          timeout: this.timeout,
          headers: {
            'Content-Type': 'application/json',
            'X-Source': 'nodejs-middleware'
          }
        }
      );

      const trackingResult = response.data;
      
      if (trackingResult.success) {
        console.log(`✅ Token usage tracked successfully. Cost: ${trackingResult.cost_vnd || 0} VND`);
        return {
          success: true,
          usage_summary: trackingResult.usage_summary,
          cost_vnd: trackingResult.cost_vnd
        };
      } else {
        console.error(`❌ Failed to track token usage:`, trackingResult.error);
        return { success: false, error: trackingResult.error };
      }

    } catch (error) {
      console.error(`❌ Error tracking token usage:`, error.message);
      
      // Don't fail the main request if usage tracking fails
      return { success: false, error: error.message };
    }
  }

  /**
   * Get user's current subscription info
   * @param {string} userId - User ID
   * @returns {Object} - Subscription information
   */
  async getUserSubscription(userId) {
    try {
      const response = await axios.get(
        `${this.pythonApiUrl}/api/v1/subscription/${userId}`,
        {
          timeout: this.timeout,
          headers: {
            'Content-Type': 'application/json',
            'X-Source': 'nodejs-middleware'
          }
        }
      );

      return response.data;

    } catch (error) {
      console.error(`❌ Error getting user subscription:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Estimate tokens for a given message
   * @param {string} message - User message
   * @returns {number} - Estimated token count
   */
  estimateTokens(message) {
    if (!message) return 100; // Default minimum
    
    // Rough estimation: ~4 characters per token for English
    // For Vietnamese, might be less efficient, so we use ~3 chars per token
    const baseTokens = Math.ceil(message.length / 3);
    
    // Add buffer for system prompt and response
    const systemPromptTokens = 2000; // Approximate
    const responseTokens = 500; // Conservative estimate
    
    return baseTokens + systemPromptTokens + responseTokens;
  }

  /**
   * Get user-friendly limit exceeded message
   * @param {string} reason - Limit exceeded reason
   * @returns {string} - User-friendly message
   */
  getLimitExceededMessage(reason) {
    if (reason.includes('token limit')) {
      return 'Bạn đã sử dụng hết quota tokens cho gói hiện tại. Vui lòng nâng cấp gói để tiếp tục sử dụng.';
    } else if (reason.includes('request limit')) {
      return 'Bạn đã đạt giới hạn số requests cho gói hiện tại. Vui lòng nâng cấp gói để tiếp tục.';
    } else if (reason.includes('expired')) {
      return 'Gói subscription của bạn đã hết hạn. Vui lòng gia hạn để tiếp tục sử dụng.';
    } else if (reason.includes('cancelled')) {
      return 'Gói subscription của bạn đã bị hủy. Vui lòng đăng ký lại để sử dụng dịch vụ.';
    } else {
      return 'Không thể thực hiện request do giới hạn subscription. Vui lòng kiểm tra gói của bạn.';
    }
  }

  /**
   * Sanitize subscription data for frontend
   * @param {Object} subscription - Raw subscription data
   * @returns {Object} - Sanitized subscription data
   */
  sanitizeSubscriptionData(subscription) {
    if (!subscription) return null;

    return {
      plan_type: subscription.plan_type,
      status: subscription.status,
      tokens_used: subscription.tokens_used,
      tokens_limit: subscription.tokens_limit,
      requests_used: subscription.requests_used,
      requests_limit: subscription.requests_limit,
      end_date: subscription.end_date
    };
  }

  /**
   * Create subscription check middleware function
   * @returns {Function} - Express middleware function
   */
  createMiddleware() {
    return this.checkSubscriptionLimits.bind(this);
  }
}

// Create and export singleton instance
const subscriptionMiddleware = new SubscriptionMiddleware();

export default subscriptionMiddleware;
export { subscriptionMiddleware };