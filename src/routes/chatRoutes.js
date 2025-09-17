import express from "express";
import { ChatController } from "../controllers/chatController.js";

const router = express.Router();
const chatController = new ChatController();

// Main chat endpoint
router.post("/chat", (req, res) => chatController.handleChat(req, res));

// API endpoint to check background job status
router.get("/job-status", (req, res) => chatController.getJobStatus(req, res));

// API endpoint to manually trigger background job processing
router.post("/process-jobs", (req, res) => chatController.processJobs(req, res));

export default router;