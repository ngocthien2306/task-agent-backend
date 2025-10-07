import express from "express";
import { ChatController } from "../controllers/chatController.js";
import { subscriptionMiddleware } from "../middleware/subscriptionMiddleware.js";

const router = express.Router();
const chatController = new ChatController();

// Main chat endpoint with subscription middleware
router.post("/chat", 
  subscriptionMiddleware.createMiddleware(),
  (req, res) => chatController.handleChat(req, res)
);

// API endpoint to check background job status
router.get("/job-status", (req, res) => chatController.getJobStatus(req, res));

// API endpoint to manually trigger background job processing
router.post("/process-jobs", (req, res) => chatController.processJobs(req, res));

// Subscription related endpoints
router.get("/subscription/:userId", async (req, res) => {
  try {
    const result = await subscriptionMiddleware.getUserSubscription(req.params.userId);
    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;