import { promises as fs } from "fs";
import { exec } from "child_process";
import os from "os";
import path from "path";

/**
 * Execute a shell command
 * @param {string} command - Command to execute
 * @returns {Promise<string>} - Command output
 */
export const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      resolve(stdout);
    });
  });
};

/**
 * Read JSON transcript file
 * @param {string} file - File path
 * @returns {Promise<Object>} - Parsed JSON or empty transcript
 */
export const readJsonTranscript = async (file) => {
  try {
    const data = await fs.readFile(file, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading transcript file ${file}:`, error);
    return { mouthCues: [] }; // Return empty transcript on error
  }
};

/**
 * Convert audio file to base64
 * @param {string} file - File path
 * @returns {Promise<string>} - Base64 encoded audio
 */
export const audioFileToBase64 = async (file) => {
  try {
    const data = await fs.readFile(file);
    return data.toString("base64");
  } catch (error) {
    console.error(`Error reading audio file ${file}:`, error);
    return ""; // Return empty string on error
  }
};

/**
 * Generate lip sync data using Rhubarb
 * @param {string} fileBaseName - Base name of audio file (without extension)
 * @returns {Promise<void>}
 */
export const generateLipSync = async (fileBaseName) => {
  const time = new Date().getTime();
  console.log(`Starting conversion for ${fileBaseName}`);
  
  const mp3Path = `audios/${fileBaseName}.mp3`;
  const wavPath = `audios/${fileBaseName}.wav`;
  const jsonPath = `audios/${fileBaseName}.json`;
  
  // Convert MP3 to WAV
  await execCommand(
    `ffmpeg -y -i ${mp3Path} ${wavPath}`
  );
  console.log(`Conversion done in ${new Date().getTime() - time}ms`);

  const platform = os.platform();
  console.log(`Platform detected: ${platform}`);

  // Generate lip sync based on platform
  if (platform === 'win32') {
    // For Windows
    const currentDir = process.cwd();
    const rhubarbPath = path.join(currentDir, 'rhubarb', 'rhubarb.exe');
    await execCommand(
      `"${rhubarbPath}" -f json -o ${jsonPath} ${wavPath} -r phonetic`
    );
  } else if (platform === 'darwin') {
    // For MacOS with arm64 - need to install softwareupdate --install-rosetta
    await execCommand(
      `arch -x86_64 ./bin/rhubarb -f json -o ${jsonPath} ${wavPath} -r phonetic`
    );
  } else {
    // For Linux or other platforms, try the Linux version
    await execCommand(
      `./bin/rhubarb -f json -o ${jsonPath} ${wavPath} -r phonetic`
    );
  }

  console.log(`Lip sync done in ${new Date().getTime() - time}ms`);
};

/**
 * Ensure directory exists
 * @param {string} dirPath - Directory path
 * @returns {Promise<void>}
 */
export const ensureDirectoryExists = async (dirPath) => {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    console.error(`Error creating directory ${dirPath}:`, error);
  }
};