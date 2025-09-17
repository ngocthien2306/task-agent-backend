import dotenv from "dotenv";

dotenv.config();

export const config = {
  // Server configuration
  port: process.env.PORT || 3000,
  
  // OpenAI configuration
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "-",
    model: "gpt-4o-mini",
    maxTokens: 2000,
    temperature: 0.7,
    ttsVoice: "nova"
  },
  
  // Python API configuration
  pythonApi: {
    url: process.env.PYTHON_API_URL || "http://localhost:8000",
    timeout: 10000
  },
  
  // Audio configuration
  audio: {
    outputDir: "audios",
    formats: {
      input: "mp3",
      processing: "wav",
      metadata: "json"
    }
  },
  
  // Background job configuration
  backgroundJobs: {
    maxAttempts: 1,
    retryDelay: 2000 // milliseconds
  },
  
  // Session configuration
  session: {
    maxHistorySize: 20,
    keepRecentMessages: 15
  }
};

export default config;