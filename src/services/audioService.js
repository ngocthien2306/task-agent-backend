import OpenAI from "openai";
import { promises as fs } from "fs";
import path from "path";
import config from "../config/index.js";
import { 
  generateLipSync, 
  audioFileToBase64, 
  readJsonTranscript, 
  ensureDirectoryExists 
} from "../utils/fileHelper.js";

export class AudioService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openai.apiKey,
    });
  }

  /**
   * Generate speech using OpenAI's text-to-speech API
   * @param {string} text - Text to convert to speech
   * @param {string} fileName - Output file path
   * @param {string} voice - Voice to use
   * @returns {Promise<boolean>} - Success status
   */
  async generateSpeech(text, fileName, voice = config.openai.ttsVoice) {
    try {
      const mp3 = await this.openai.audio.speech.create({
        model: "tts-1",
        voice: voice,
        input: text,
      });

      // Convert the response to a buffer
      const buffer = Buffer.from(await mp3.arrayBuffer());
      
      // Ensure the audios directory exists
      await ensureDirectoryExists(path.dirname(fileName));
      
      // Write the buffer to a file
      await fs.writeFile(fileName, buffer);
      
      console.log(`Speech generated and saved to ${fileName}`);
      return true;
    } catch (error) {
      console.error("Error generating speech:", error);
      return false;
    }
  }

  /**
   * Generate audio and lipsync for a single message
   * @param {Object} message - Message object with text
   * @param {string} filePrefix - Prefix for audio files
   * @param {number} index - Index for multiple messages
   * @returns {Object} - Message with audio and lipsync data
   */
  async generateMessageAudio(message, filePrefix = "message", index = 0) {
    try {
      // Ensure audios directory exists
      await ensureDirectoryExists(config.audio.outputDir);
      
      const fileBaseName = `${filePrefix}_${index}`;
      const fileName = `${config.audio.outputDir}/${fileBaseName}.${config.audio.formats.input}`;
      const textInput = message.text;
      
      console.log(`🎵 Generating audio for ${fileBaseName}: "${textInput.substring(0, 50)}..."`);
      
      // Generate voice with OpenAI TTS
      await this.generateSpeech(textInput, fileName);
      
      // Generate lipsync
      await generateLipSync(fileBaseName);
      
      // Add audio and lipsync data to message
      message.audio = await audioFileToBase64(fileName);
      message.lipsync = await readJsonTranscript(`${config.audio.outputDir}/${fileBaseName}.${config.audio.formats.metadata}`);
      
      console.log(`✅ Audio generated for ${fileBaseName}`);
      return message;
      
    } catch (error) {
      console.error(`Error generating audio for ${filePrefix}_${index}:`, error);
      return message; // Return message without audio on error
    }
  }

  /**
   * Generate audio for multiple messages
   * @param {Array} messages - Array of message objects
   * @param {string} filePrefix - Prefix for audio files
   * @returns {Array} - Messages with audio and lipsync data
   */
  async generateMessagesAudio(messages, filePrefix = "message") {
    for (let i = 0; i < messages.length; i++) {
      await this.generateMessageAudio(messages[i], filePrefix, i);
    }
    return messages;
  }

  /**
   * Try to load existing audio files or generate new ones
   * @param {Array} messages - Array of message objects
   * @param {string} filePrefix - Prefix for audio files
   * @returns {Array} - Messages with audio data
   */
  async loadOrGenerateAudio(messages, filePrefix) {
    try {
      // Try to load existing audio files first
      for (let i = 0; i < messages.length; i++) {
        const fileBaseName = `${filePrefix}_${i}`;
        const audioPath = `${config.audio.outputDir}/${fileBaseName}.${config.audio.formats.input}`;
        const transcriptPath = `${config.audio.outputDir}/${fileBaseName}.${config.audio.formats.metadata}`;
        
        try {
          messages[i].audio = await audioFileToBase64(audioPath);
          messages[i].lipsync = await readJsonTranscript(transcriptPath);
        } catch (error) {
          // File doesn't exist, will generate below
          console.log(`Audio file not found for ${fileBaseName}, will generate`);
          throw error;
        }
      }
      
      console.log(`📂 Loaded existing audio files for ${filePrefix}`);
      return messages;
      
    } catch (error) {
      // Generate new audio files
      console.log(`📢 Generating new audio for ${filePrefix}...`);
      return await this.generateMessagesAudio(messages, filePrefix);
    }
  }
}