import https from "node:https";
import http from "node:http";
import { spawn } from "node:child_process";
import { log } from "./logger.js";

export interface TTSConfig {
  enabled: boolean;
  provider: "openai" | "edge";
  apiKey?: string;
  baseUrl?: string;
  voice?: string;
  model?: string;
  maxTextLen?: number;
}

export interface TextToSpeech {
  synthesize(text: string): Promise<{ audio: Buffer; format: string }>;
}

export class OpenAITTS implements TextToSpeech {
  private apiKey: string;
  private baseUrl: string;
  private voice: string;
  private model: string;
  private maxTextLen: number;

  constructor(config: TTSConfig) {
    this.apiKey = config.apiKey ?? "";
    this.baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
    this.voice = config.voice ?? "alloy";
    this.model = config.model ?? "tts-1";
    this.maxTextLen = config.maxTextLen ?? 4096;
  }

  async synthesize(text: string): Promise<{ audio: Buffer; format: string }> {
    const truncated = text.slice(0, this.maxTextLen);
    const body = JSON.stringify({ model: this.model, voice: this.voice, input: truncated });

    const url = new URL(`${this.baseUrl}/audio/speech`);
    const isHttps = url.protocol === "https:";
    const httpModule = isHttps ? https : http;

    return new Promise((resolve, reject) => {
      const req = httpModule.request({
        hostname: url.hostname, port: url.port, path: url.pathname, method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const audio = Buffer.concat(chunks);
          if (res.statusCode !== 200) reject(new Error(`TTS failed: ${res.statusCode} ${audio.toString()}`));
          else resolve({ audio, format: "mp3" });
        });
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
}

export class EdgeTTS implements TextToSpeech {
  private voice: string;
  private maxTextLen: number;

  constructor(config: TTSConfig) {
    this.voice = config.voice ?? "zh-CN-XiaoxiaoNeural";
    this.maxTextLen = config.maxTextLen ?? 4096;
  }

  async synthesize(text: string): Promise<{ audio: Buffer; format: string }> {
    const truncated = text.slice(0, this.maxTextLen);
    return new Promise((resolve, reject) => {
      const child = spawn("edge-tts", [
        "--voice", this.voice, "--text", truncated, "--write-media", "/dev/stdout",
      ], { stdio: ["pipe", "pipe", "pipe"] });
      const chunks: Buffer[] = [];
      child.stdout.on("data", (chunk) => chunks.push(chunk));
      child.on("close", (code) => {
        if (code !== 0) reject(new Error(`edge-tts failed with code ${code}`));
        else resolve({ audio: Buffer.concat(chunks), format: "mp3" });
      });
      child.on("error", (err) => {
        reject(new Error(`edge-tts not found. Install with: pip install edge-tts\n${err.message}`));
      });
    });
  }
}

export function createTTS(config: TTSConfig): TextToSpeech | null {
  if (!config.enabled) return null;
  switch (config.provider) {
    case "openai": return new OpenAITTS(config);
    case "edge": return new EdgeTTS(config);
    default:
      log("warn", `Unknown TTS provider: ${config.provider}`);
      return null;
  }
}
