import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { createOpenGradientClient } from "./lib/opengradient.js";
import { createSupabaseMemoryStore } from "./lib/supabase-memory.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "..", "public");

const config = {
  port: Number(process.env.PORT || 3000),
  model: process.env.OG_MODEL || "openai/gpt-4o",
  maxTokens: Number(process.env.OG_MAX_TOKENS || 350),
  settlementType: process.env.OG_SETTLEMENT_TYPE || "individual",
  apiBaseUrl: process.env.OG_API_BASE_URL || "https://llm.opengradient.ai",
  openGradientKey: process.env.OG_PRIVATE_KEY || "",
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  supabaseUserId: process.env.SUPABASE_USER_ID || "local-demo-user",
  supabaseMemoryTable: process.env.SUPABASE_MEMORY_TABLE || "gradient_memories",
  supabaseLookback: Number(process.env.SUPABASE_LOOKBACK || 120),
  supabaseRecallLimit: Number(process.env.SUPABASE_RECALL_LIMIT || 5)
};

const openGradientClient = config.openGradientKey
  ? createOpenGradientClient({
      privateKey: config.openGradientKey,
      model: config.model,
      maxTokens: config.maxTokens,
      settlementType: config.settlementType,
      baseUrl: config.apiBaseUrl
    })
  : null;

const memoryStore = createSupabaseMemoryStore({
  url: config.supabaseUrl,
  key: config.supabaseKey,
  userId: config.supabaseUserId,
  tableName: config.supabaseMemoryTable,
  lookback: config.supabaseLookback,
  recallLimit: config.supabaseRecallLimit
});

function getMimeType(filePath) {
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }

  if (filePath.endsWith(".js")) {
    return "application/javascript; charset=utf-8";
  }

  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }

  return "text/html; charset=utf-8";
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((item) => item && typeof item.content === "string")
    .map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: item.content.trim()
    }))
    .filter((item) => item.content.length > 0)
    .slice(-8);
}

function buildSystemPrompt(memorySearchResult) {
  const basePrompt = [
    "You are Gradient Recall, a practical assistant powered by OpenGradient's verified inference.",
    "Be concise, clear, and helpful.",
    "If memories are provided, use them only when relevant.",
    "Treat episodic memories as possibly time-bound and mention uncertainty when needed."
  ];

  if (!memorySearchResult || !memorySearchResult.memories?.length) {
    return basePrompt.join("\n");
  }

  const memoryLines = memorySearchResult.memories.map((memory, index) => {
    const categories = Array.isArray(memory.categories) ? memory.categories.join(", ") : "uncategorized";
    return `${index + 1}. ${memory.memory} [${memory.type || "unknown"} | ${categories}]`;
  });

  return [
    ...basePrompt,
    "",
    "Known user bio:",
    memorySearchResult.user_bio || "No bio available.",
    "",
    "Relevant memories:",
    ...memoryLines
  ].join("\n");
}

async function serveStatic(requestPath, response) {
  const relativePath = requestPath === "/" ? "index.html" : requestPath.slice(1);
  const safePath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const fullPath = path.join(publicDir, safePath);

  if (!fullPath.startsWith(publicDir)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  try {
    const file = await readFile(fullPath);
    response.writeHead(200, { "Content-Type": getMimeType(fullPath) });
    response.end(file);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

async function handleChat(request, response) {
  if (!openGradientClient) {
    sendJson(response, 500, {
      error: "OG_PRIVATE_KEY is not configured yet. Add it to .env before sending chat requests."
    });
    return;
  }

  const body = await readJsonBody(request);
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const history = normalizeHistory(body.history);
  const incomingThreadId = typeof body.threadId === "string" ? body.threadId.trim() : "";
  const threadId = incomingThreadId || randomUUID();

  if (!message) {
    sendJson(response, 400, { error: "Message is required." });
    return;
  }

  let memorySearchResult = null;
  let memoryStatus = "disabled";

  if (memoryStore.isConfigured()) {
    try {
      memorySearchResult = await memoryStore.search(message);
      memoryStatus = "ok";
    } catch (error) {
      memoryStatus = error.message;
    }
  }

  const messages = [
    {
      role: "system",
      content: buildSystemPrompt(memorySearchResult)
    },
    ...history,
    {
      role: "user",
      content: message
    }
  ];

  try {
    const result = await openGradientClient.chat(messages);

    if (memoryStore.isConfigured()) {
      try {
        await memoryStore.storeConversation({
          threadId,
          messages: [
            { role: "user", content: message },
            { role: "assistant", content: result.content }
          ]
        });
      } catch (error) {
        memoryStatus = memoryStatus === "ok" ? error.message : memoryStatus;
      }
    }

    sendJson(response, 200, {
      threadId,
      answer: result.content,
      usage: result.usage,
      model: config.model,
      settlementType: config.settlementType,
      memoryStatus,
      userBio: memorySearchResult?.user_bio || "",
      insights: memorySearchResult?.insights || [],
      memories: memorySearchResult?.memories || []
    });
  } catch (error) {
    sendJson(response, 502, { error: error.message });
  }
}

async function handleProfile(response) {
  if (!memoryStore.isConfigured()) {
    sendJson(response, 200, {
      enabled: false,
      user_bio: "",
      insights: [],
      recent_memories: []
    });
    return;
  }

  try {
    const profile = await memoryStore.getProfile();
    sendJson(response, 200, {
      enabled: true,
      ...profile
    });
  } catch (error) {
    sendJson(response, 502, { error: error.message });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        model: config.model,
        settlementType: config.settlementType
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/config") {
      sendJson(response, 200, {
        model: config.model,
        settlementType: config.settlementType,
        apiBaseUrl: config.apiBaseUrl,
        hasOpenGradientKey: Boolean(config.openGradientKey),
        hasSupabase: memoryStore.isConfigured(),
        memoryUserId: memoryStore.getUserId()
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/profile") {
      await handleProfile(response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      await handleChat(request, response);
      return;
    }

    if (request.method === "GET") {
      await serveStatic(url.pathname, response);
      return;
    }

    sendJson(response, 404, { error: "Route not found." });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Unexpected server error." });
  }
});

server.listen(config.port, () => {
  console.log(`Gradient Recall is running at http://localhost:${config.port}`);
});

export { server };
