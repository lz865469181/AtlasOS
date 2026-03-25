import https from "node:https";
import http from "node:http";
import { spawn } from "node:child_process";
import { log } from "./logger.js";

export interface STTConfig {
  provider: "whisper" | "groq";
  apiKey: string;
  baseUrl?: string;
  model?: string;
  language?: string;
}

export interface SpeechToText {
  transcribe(audio: Buffer, format: string, language?: string): Promise<string>;
}

export class WhisperSTT implements SpeechToText {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private defaultLanguage: string;

  constructor(config: STTConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "whisper-1";
    this.defaultLanguage = config.language ?? "zh";
    if (config.provider === "groq") {
      this.baseUrl = config.baseUrl ?? "https://api.groq.com/openai/v1";
    } else {
      this.baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
    }
  }

  async transcribe(audio: Buffer, format: string, language?: string): Promise<string> {
    let audioData = audio;
    let audioFormat = format;
    if (needsConversion(format)) {
      audioData = await convertToMp3(audio, format);
      audioFormat = "mp3";
    }

    const boundary = `----FormBoundary${Date.now()}`;
    const lang = language ?? this.defaultLanguage;
    const body = buildMultipartBody(boundary, audioData, audioFormat, this.model, lang);

    const url = new URL(`${this.baseUrl}/audio/transcriptions`);
    const isHttps = url.protocol === "https:";
    const httpModule = isHttps ? https : http;

    return new Promise((resolve, reject) => {
      const req = httpModule.request({
        hostname: url.hostname, port: url.port, path: url.pathname, method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            const result = JSON.parse(data);
            if (result.text) resolve(result.text);
            else reject(new Error(`STT failed: ${data}`));
          } catch { resolve(data.trim()); }
        });
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
}

function needsConversion(format: string): boolean {
  const supported = ["mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm", "ogg"];
  return !supported.includes(format.toLowerCase());
}

async function convertToMp3(audio: Buffer, format: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-i", "pipe:0", "-f", "mp3", "-acodec", "libmp3lame", "-q:a", "2", "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`ffmpeg conversion failed with code ${code}`));
      else resolve(Buffer.concat(chunks));
    });
    child.on("error", reject);
    child.stdin.write(audio);
    child.stdin.end();
  });
}

function buildMultipartBody(boundary: string, audio: Buffer, format: string, model: string, language: string): Buffer {
  const parts: Buffer[] = [];
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${format}"\r\nContent-Type: audio/${format}\r\n\r\n`));
  parts.push(audio);
  parts.push(Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${language}\r\n`));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(parts);
}
