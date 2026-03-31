import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import {
  createOpenGradientClient,
  DEFAULT_OG_RPC_URL,
  DEFAULT_OPEN_GRADIENT_MODEL,
  DEFAULT_TEE_REGISTRY_ADDRESS,
  normalizeOpenGradientModel,
  normalizeOpenGradientSettlementType
} from "./lib/opengradient.js";
import {
  createChallenge,
  createGuestSession,
  createWalletSession,
  ensureSession,
  serializeSessionCookie,
  verifyWalletSignature
} from "./lib/session-auth.js";
import { createSupabaseMemoryStore } from "./lib/supabase-memory.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "..", "public");

const config = {
  port: Number(process.env.PORT || 3000),
  model: normalizeOpenGradientModel(process.env.OG_MODEL || DEFAULT_OPEN_GRADIENT_MODEL),
  maxTokens: Number(process.env.OG_MAX_TOKENS || 350),
  settlementType: normalizeOpenGradientSettlementType(process.env.OG_SETTLEMENT_TYPE || "individual"),
  rpcUrl: process.env.OG_RPC_URL || DEFAULT_OG_RPC_URL,
  teeRegistryAddress: process.env.OG_TEE_REGISTRY_ADDRESS || DEFAULT_TEE_REGISTRY_ADDRESS,
  pythonExecutable: process.env.OG_PYTHON_EXECUTABLE || "",
  openGradientKey: process.env.OG_PRIVATE_KEY || "",
  sessionSecret:
    process.env.APP_SESSION_SECRET ||
    process.env.OG_PRIVATE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "recall-chat-dev-secret",
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
      pythonExecutable: config.pythonExecutable,
      rpcUrl: config.rpcUrl,
      teeRegistryAddress: config.teeRegistryAddress
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

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers
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
    "You are Recall, a practical assistant powered by OpenGradient's verified inference.",
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

function parseBalance(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatOpenGradientPaymentError(errorMessage, walletStatus) {
  if (!walletStatus) {
    return errorMessage;
  }

  const opgBalance = parseBalance(walletStatus.opgBalance);
  const ethBalance = parseBalance(walletStatus.ethBalance);
  const permit2Allowance = parseBalance(walletStatus.permit2Allowance);

  if (opgBalance !== null && opgBalance < 0.1) {
    return `OpenGradient payment failed because wallet ${walletStatus.address} only has ${walletStatus.opgBalance} OPG. Top up more OPG from the faucet, then try again.`;
  }

  if (permit2Allowance !== null && permit2Allowance < 0.1) {
    return `OpenGradient payment failed because Permit2 allowance is only ${walletStatus.permit2Allowance} OPG. Run npm.cmd run og:approve -- 1, then try again.`;
  }

  if (ethBalance !== null && ethBalance < 0.001) {
    return `OpenGradient payment failed because wallet ${walletStatus.address} is low on Base Sepolia ETH (${walletStatus.ethBalance}). Add more gas and try again.`;
  }

  return `${errorMessage} Wallet diagnostics: ${walletStatus.opgBalance} OPG, ${walletStatus.ethBalance} ETH, allowance ${walletStatus.permit2Allowance} OPG.`;
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

function isSecureRequest(request) {
  return (request.headers["x-forwarded-proto"] || "").split(",")[0]?.trim() === "https";
}

function getSessionHeaders(request, sessionToken) {
  if (!sessionToken) {
    return {};
  }

  return {
    "Set-Cookie": serializeSessionCookie(sessionToken, isSecureRequest(request))
  };
}

async function handleChat(request, response) {
  const { session, token: sessionToken } = ensureSession(request.headers.cookie || "", config.sessionSecret);

  if (!openGradientClient) {
    sendJson(
      response,
      500,
      {
        error: "OG_PRIVATE_KEY is not configured yet. Add it to .env before sending chat requests."
      },
      getSessionHeaders(request, sessionToken)
    );
    return;
  }

  const body = await readJsonBody(request);
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const history = normalizeHistory(body.history);
  const incomingThreadId = typeof body.threadId === "string" ? body.threadId.trim() : "";
  const threadId = incomingThreadId || randomUUID();

  if (!message) {
    sendJson(response, 400, { error: "Message is required." }, getSessionHeaders(request, sessionToken));
    return;
  }

  let memorySearchResult = null;
  let memoryStatus = "disabled";

  if (memoryStore.isConfigured()) {
    try {
      memorySearchResult = await memoryStore.search(message, session.userId);
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
          ],
          userId: session.userId
        });
      } catch (error) {
        memoryStatus = memoryStatus === "ok" ? error.message : memoryStatus;
      }
    }

    sendJson(response, 200, {
      session,
      threadId,
      answer: result.content,
      usage: result.usage,
      model: result.model || config.model,
      settlementType: result.settlementType || config.settlementType,
      memoryStatus,
      userBio: memorySearchResult?.user_bio || "",
      stats: memorySearchResult?.stats || null,
      insights: memorySearchResult?.insights || [],
      memories: memorySearchResult?.memories || []
    }, getSessionHeaders(request, sessionToken));
  } catch (error) {
    const errorMessage = error.message || "OpenGradient request failed.";

    if (errorMessage.includes("402 Payment Required")) {
      const walletStatus = await openGradientClient.getWalletStatus().catch(() => null);
      sendJson(
        response,
        402,
        {
          error: formatOpenGradientPaymentError(errorMessage, walletStatus),
          walletStatus
        },
        getSessionHeaders(request, sessionToken)
      );
      return;
    }

    sendJson(response, 502, { error: errorMessage }, getSessionHeaders(request, sessionToken));
  }
}

async function handleProfile(request, response) {
  const { session, token: sessionToken } = ensureSession(request.headers.cookie || "", config.sessionSecret);

  if (!memoryStore.isConfigured()) {
    sendJson(
      response,
      200,
      {
        enabled: false,
        session,
        user_bio: "",
        insights: [],
        recent_memories: []
      },
      getSessionHeaders(request, sessionToken)
    );
    return;
  }

  try {
    const profile = await memoryStore.getProfile(session.userId);
    sendJson(response, 200, {
      enabled: true,
      session,
      ...profile
    }, getSessionHeaders(request, sessionToken));
  } catch (error) {
    sendJson(response, 502, { error: error.message }, getSessionHeaders(request, sessionToken));
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

    if (request.method === "GET" && url.pathname === "/api/auth/session") {
      const { session, token } = ensureSession(request.headers.cookie || "", config.sessionSecret);
      sendJson(
        response,
        200,
        {
          session,
          publicAccess: true,
          identityMode: "guest-or-wallet"
        },
        getSessionHeaders(request, token)
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/challenge") {
      const body = await readJsonBody(request);
      const address = typeof body.address === "string" ? body.address.trim() : "";

      if (!address) {
        sendJson(response, 400, { error: "Wallet address is required." });
        return;
      }

      try {
        sendJson(response, 200, createChallenge(address, request.headers.host || "localhost", config.sessionSecret));
      } catch (error) {
        sendJson(response, 400, { error: error.message || "Failed to create challenge." });
      }

      return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/verify") {
      const body = await readJsonBody(request);
      const address = typeof body.address === "string" ? body.address.trim() : "";
      const signature = typeof body.signature === "string" ? body.signature.trim() : "";
      const challenge = typeof body.challenge === "string" ? body.challenge.trim() : "";

      if (!address || !signature || !challenge) {
        sendJson(response, 400, { error: "Address, signature, and challenge are required." });
        return;
      }

      try {
        await verifyWalletSignature({
          address,
          signature,
          challenge,
          secret: config.sessionSecret
        });

        const { session, token } = createWalletSession(address, config.sessionSecret);
        sendJson(response, 200, { session }, getSessionHeaders(request, token));
      } catch (error) {
        sendJson(response, 400, { error: error.message || "Wallet verification failed." });
      }

      return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      const { session, token } = createGuestSession(config.sessionSecret);
      sendJson(response, 200, { session }, getSessionHeaders(request, token));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/config") {
      const { session, token } = ensureSession(request.headers.cookie || "", config.sessionSecret);
      const openGradientStatus = openGradientClient ? await openGradientClient.getStatus() : null;
      const walletStatus = openGradientClient ? await openGradientClient.getWalletStatus().catch(() => null) : null;

      sendJson(response, 200, {
        model: config.model,
        settlementType: config.settlementType,
        openGradientRuntime: openGradientStatus?.runtime || "",
        pythonExecutable: openGradientStatus?.pythonExecutable || "",
        endpointStrategy: openGradientStatus?.endpointStrategy || "disabled",
        publicAccess: true,
        identityMode: "guest-or-wallet",
        session,
        hasOpenGradientKey: Boolean(config.openGradientKey),
        walletStatus,
        hasSupabase: memoryStore.isConfigured(),
        memoryUserId: session.userId
      }, getSessionHeaders(request, token));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/profile") {
      await handleProfile(request, response);
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
  console.log(`Recall is running at http://localhost:${config.port}`);
});

export { server };
