const chatLog = document.getElementById("chatLog");
const composer = document.getElementById("composer");
const promptInput = document.getElementById("promptInput");
const composerNote = document.getElementById("composerNote");
const sendButton = document.getElementById("sendButton");
const threadChip = document.getElementById("threadChip");
const modelValue = document.getElementById("modelValue");
const settlementValue = document.getElementById("settlementValue");
const walletStatus = document.getElementById("walletStatus");
const memoryStatus = document.getElementById("memoryStatus");
const setupHint = document.getElementById("setupHint");
const userBio = document.getElementById("userBio");
const insightsList = document.getElementById("insightsList");
const memoryList = document.getElementById("memoryList");

const storedThreadId = window.localStorage.getItem("gradient-recall-thread") || "";
const state = {
  threadId: storedThreadId,
  history: [],
  ready: false
};

function renderThread() {
  threadChip.textContent = `Thread: ${state.threadId || "new session"}`;
}

function appendMessage(role, content) {
  const article = document.createElement("article");
  article.className = `message message-${role}`;

  const roleLabel = document.createElement("p");
  roleLabel.className = "message-role";
  roleLabel.textContent = role;

  const body = document.createElement("p");
  body.textContent = content;

  article.append(roleLabel, body);
  chatLog.append(article);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function setMemories(memories) {
  memoryList.innerHTML = "";

  if (!memories.length) {
    const empty = document.createElement("li");
    empty.textContent = "No relevant memories were returned for the latest prompt.";
    memoryList.append(empty);
    return;
  }

  for (const memory of memories) {
    const item = document.createElement("li");
    const role = typeof memory.role === "string" ? `${memory.role}: ` : "";
    const score = typeof memory.score === "number" ? ` [score ${memory.score}]` : "";
    item.textContent = `${role}${memory.memory}${score}`;
    memoryList.append(item);
  }
}

function setInsights(insights) {
  insightsList.innerHTML = "";

  if (!Array.isArray(insights) || insights.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No profile insights available yet.";
    insightsList.append(empty);
    return;
  }

  for (const insight of insights.slice(0, 6)) {
    const item = document.createElement("li");
    item.textContent = typeof insight === "string" ? insight : JSON.stringify(insight);
    insightsList.append(item);
  }
}

function setBusy(isBusy) {
  promptInput.disabled = isBusy || !state.ready;
  sendButton.disabled = isBusy || !state.ready;
  composerNote.textContent = isBusy ? "OpenGradient is generating a verified response..." : "Ready when you are.";
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const config = await response.json();

  modelValue.textContent = config.model;
  settlementValue.textContent = config.settlementType;
  walletStatus.textContent = config.hasOpenGradientKey ? "configured" : "missing";
  memoryStatus.textContent = config.hasSupabase ? "configured" : "missing";

  state.ready = Boolean(config.hasOpenGradientKey);
  setupHint.textContent = !config.hasOpenGradientKey
    ? "Add OG_PRIVATE_KEY to .env, fund the wallet on Base Sepolia, then refresh."
    : config.hasSupabase
      ? `Wallet + cloud memory are ready for ${config.memoryUserId}.`
      : "Add SUPABASE_URL and a server-side Supabase key to enable cloud memory.";

  renderThread();
  setBusy(false);
}

async function loadProfile() {
  const response = await fetch("/api/profile");
  const profile = await response.json();

  if (!profile.enabled) {
    userBio.textContent = "Supabase memory is not configured. Add SUPABASE_URL and a server-side key to unlock cloud recall.";
    setInsights([]);
    return;
  }

  userBio.textContent = profile.user_bio || "No memory summary available yet. Start chatting so Supabase can store context.";
  setInsights(profile.insights || []);
  setMemories((profile.recent_memories || []).map((memory) => ({
    memory: memory.content,
    role: memory.role
  })));
}

composer.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = promptInput.value.trim();

  if (!message || !state.ready) {
    return;
  }

  const historyBeforeRequest = [...state.history];
  appendMessage("user", message);
  state.history.push({ role: "user", content: message });
  promptInput.value = "";
  setBusy(true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message,
        threadId: state.threadId,
        history: historyBeforeRequest
      })
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Request failed.");
    }

    state.threadId = payload.threadId;
    window.localStorage.setItem("gradient-recall-thread", state.threadId);
    renderThread();

    appendMessage("assistant", payload.answer);
    state.history.push({ role: "assistant", content: payload.answer });

    userBio.textContent = payload.userBio || userBio.textContent;
    setInsights(payload.insights || []);
    setMemories(payload.memories || []);
    composerNote.textContent = payload.memoryStatus === "ok"
      ? "Verified response received. Supabase recall was applied."
      : payload.memoryStatus === "disabled"
        ? "Verified response received. Cloud memory is off."
        : `Verified response received. Memory note: ${payload.memoryStatus}`;
  } catch (error) {
    appendMessage("assistant", `Request failed: ${error.message}`);
    state.history.pop();
    composerNote.textContent = "The request failed. Check your .env values and wallet funding.";
  } finally {
    setBusy(false);
  }
});

renderThread();
setBusy(true);

await loadConfig();
await loadProfile();
