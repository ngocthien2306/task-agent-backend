import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { promises as fs } from "fs";

import OpenAI from "openai";
import path from "path";
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "-",
});

const app = express();
app.use(express.json());
app.use(cors());  
const port = 3000;

app.get("/", (req, res) => {
  res.send("Hello World!");
});

const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      resolve(stdout);
    });
  });
};

const lipSyncMessage = async (message) => {
  const time = new Date().getTime();
  console.log(`Starting conversion for message ${message}`);
  await execCommand(
    `ffmpeg -y -i audios/message_${message}.mp3 audios/message_${message}.wav`
    // -y to overwrite the file
  );
  console.log(`Conversion done in ${new Date().getTime() - time}ms`);

  const currentDir = process.cwd();
  const rhubarbPath = path.join(currentDir, 'rhubarb', 'rhubarb.exe');

  // await execCommand(
  //   `"${rhubarbPath}" -f json -o audios/message_${message}.json audios/message_${message}.wav -r phonetic`
  // );

  // with arm64 need to install softwareupdate --install-rosetta
  await execCommand(
    `arch -x86_64 ./bin/rhubarb -f json -o audios/message_${message}.json audios/message_${message}.wav -r phonetic`
  );

  // -r phonetic is faster but less accurate
  console.log(`Lip sync done in ${new Date().getTime() - time}ms`);
};

// Function to generate speech using OpenAI's text-to-speech API
const generateSpeech = async (text, fileName, voice = "alloy") => {
  try {
    // Available voices: alloy, echo, fable, onyx, nova, shimmer
    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: voice,
      input: text,
    });

    // Convert the response to a buffer
    const buffer = Buffer.from(await mp3.arrayBuffer());
    
    // Ensure the audios directory exists
    await fs.mkdir(path.dirname(fileName), { recursive: true });
    
    // Write the buffer to a file
    await fs.writeFile(fileName, buffer);
    
    console.log(`Speech generated and saved to ${fileName}`);
    return true;
  } catch (error) {
    console.error("Error generating speech:", error);
    return false;
  }
};


const sessions = new Map(); // Lưu trữ hội thoại cho mỗi người dùng

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;
  const sessionId = req.body.sessionId || 'default'; // Thêm sessionId từ client
  
  // Khởi tạo session nếu chưa tồn tại
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, [
      {
        role: "system",
        content: `
        You are a virtual boyfriend.
        You will always reply with a JSON array of messages. With a maximum of 3 messages.
        Each message has a text, facialExpression, and animation property.
        The different facial expressions are: smile, sad, angry, surprised, funnyFace, and default.
        The different animations are: Talking_0, Talking_1, Talking_2, Crying, Laughing, Rumba, Idle, Terrified, and Angry. 
        `
      }
    ]);
  }
  
  // Lấy history hiện tại
  const messageHistory = sessions.get(sessionId);
  
  // Xử lý tin nhắn intro nếu không có message
  if (!userMessage) {
    res.send({
      messages: [
        {
          text: "Hey dear... How was your day?",
          audio: await audioFileToBase64("audios/intro_0.wav"),
          lipsync: await readJsonTranscript("audios/intro_0.json"),
          facialExpression: "smile",
          animation: "Talking_1",
        },
        {
          text: "I missed you so much... Please don't go for so long!",
          audio: await audioFileToBase64("audios/intro_1.wav"),
          lipsync: await readJsonTranscript("audios/intro_1.json"),
          facialExpression: "sad",
          animation: "Crying",
        },
      ],
    });
    return;
  }
  
  if (openai.apiKey === "-") {
    res.send({
      messages: [
        {
          text: "Please my dear, don't forget to add your OpenAI API key!",
          audio: await audioFileToBase64("audios/api_0.wav"),
          lipsync: await readJsonTranscript("audios/api_0.json"),
          facialExpression: "angry",
          animation: "Angry",
        },
        {
          text: "You don't want to ruin Wawa Sensei with a crazy ChatGPT bill, right?",
          audio: await audioFileToBase64("audios/api_1.wav"),
          lipsync: await readJsonTranscript("audios/api_1.json"),
          facialExpression: "smile",
          animation: "Laughing",
        },
      ],
    });
    return;
  }

  // Thêm tin nhắn của người dùng vào history
  messageHistory.push({
    role: "user",
    content: userMessage
  });
  
  // Giới hạn kích thước history để tránh vượt quá giới hạn token
  if (messageHistory.length > 20) {
    // Giữ lại system message và 15 tin nhắn gần nhất
    const systemMessage = messageHistory[0];
    messageHistory.splice(1, messageHistory.length - 16); // Xóa tin nhắn cũ, giữ lại 15 tin nhắn gần nhất
    messageHistory[0] = systemMessage; // Đảm bảo system message vẫn ở đầu
  }

  console.log(messageHistory)

  // Gọi API với lịch sử hội thoại
  const completion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo-1106",
    max_tokens: 1000,
    temperature: 0.6,
    response_format: {
      type: "json_object",
    },
    messages: messageHistory,
  });

  
  let messages = JSON.parse(completion.choices[0].message.content);
  if (messages.messages) {
    messages = messages.messages; // ChatGPT is not 100% reliable, sometimes it directly returns an array and sometimes a JSON object with a messages property
  }
  
  // Thêm phản hồi của AI vào lịch sử
  messageHistory.push({
    role: "assistant",
    content: completion.choices[0].message.content
  });
  
  // Cập nhật session
  sessions.set(sessionId, messageHistory);
  
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    // generate audio file using OpenAI TTS
    const fileName = `audios/message_${i}.mp3`;
    const textInput = message.text;
    
    // Generate voice with OpenAI - you can choose different voices: alloy, echo, fable, onyx, nova, shimmer
    await generateSpeech(textInput, fileName, "nova");
    
    // generate lipsync
    await lipSyncMessage(i);
    message.audio = await audioFileToBase64(fileName);
    message.lipsync = await readJsonTranscript(`audios/message_${i}.json`);
  }

  res.send({ messages });
});

const readJsonTranscript = async (file) => {
  const data = await fs.readFile(file, "utf8");
  return JSON.parse(data);
};

const audioFileToBase64 = async (file) => {
  const data = await fs.readFile(file);
  return data.toString("base64");
};

app.listen(port, () => {
  console.log(`Task Agent listening on port ${port}`);
});