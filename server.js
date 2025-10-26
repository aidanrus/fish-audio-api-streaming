// server.js
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

/* ================================
   JANITORAI STREAM CHAT ENDPOINT
================================ */
app.post("/api/chat", async (req, res) => {
  const client = new OpenAI({
    baseURL: "https://janitorai.com/hackathon",
    apiKey: "calhacks2047", // JanitorAI key
  });

  try {
    const stream = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: req.body.messages,
      stream: true,
    });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error("❌ Error in stream:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================================
   FISH AUDIO REAL-TIME TTS PROXY
================================ */
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/fish-tts") {
    console.log("🔁 Browser requested /api/fish-tts upgrade");

    // Include voice & model query parameters
    const voiceId = "gpt-4o-mini-tts-en_us_female";
    const modelId = "gpt-4o-mini-tts";
    const fishWs = new WebSocket(
      `wss://api.fish.audio/v1/realtime-tts?voice=${voiceId}&model=${modelId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.FISH_AUDIO_API_KEY}`,
        },
      }
    );

    // Handle Fish Audio errors
    fishWs.on("error", (err) => {
      console.error("❌ Fish Audio WebSocket error:", err);
    });

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      console.log("🎤 Client connected to /api/fish-tts proxy");

      // Forward browser → Fish
      clientWs.on("message", (msg) => {
        if (fishWs.readyState === WebSocket.OPEN) fishWs.send(msg);
      });

      // Forward Fish → browser
      fishWs.on("message", (data) => {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
      });

      // Close handling
      clientWs.on("close", () => fishWs.close());
      fishWs.on("close", () => clientWs.close());

      // Browser WS errors
      clientWs.on("error", (err) => console.error("❌ Browser WS error:", err));
    });
  } else {
    socket.destroy();
  }
});

server.listen(3000, () =>
  console.log("✅ Proxy + WebSocket running on http://localhost:3000")
);
