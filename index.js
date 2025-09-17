import express from "express";
import cors from "cors";
import config from "./src/config/index.js";
import chatRoutes from "./src/routes/chatRoutes.js";
import { errorHandler, notFoundHandler } from "./src/middleware/errorHandler.js";

// Create Express app
const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// Routes
app.get("/", (req, res) => {
  res.send("AI Work Assistant Server is running!");
});

// Chat routes
app.use("/", chatRoutes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(`🛑 ${signal} received, shutting down gracefully`);
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
app.listen(config.port, () => {
  console.log(`🤖 AI Work Assistant Server listening on port ${config.port}`);
  console.log(`🔗 Python API URL: ${config.pythonApi.url}`);
  console.log(`🎵 Audio generation: Enabled`);
  console.log(`📋 Background jobs: Enabled`);
  console.log('='.repeat(50));
});