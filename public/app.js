const promptChips = [...document.querySelectorAll(".prompt-chip")];

const chatLog = document.getElementById("chatLog");
const composer = document.getElementById("composer");
const promptInput = document.getElementById("promptInput");
const composerNote = document.getElementById("composerNote");
const sendButton = document.getElementById("sendButton");
const walletActionButton = document.getElementById("walletActionButton");
const threadChip = document.getElementById("threadChip");
const identityBadgeValue = document.getElementById("identityBadgeValue");
const sessionSummary = document.getElementById("sessionSummary");
const modeBadge = document.getElementById("modeBadge");
const memoryModeBadge = document.getElementById("memoryModeBadge");
const memorySummary = document.getElementById("memorySummary");
const memoryList = document.getElementById("memoryList");

const INITIAL_ASSISTANT_COPY =
  "Start in guest mode any time. Connect a wallet if you want this conversation and its memory lane to stay tied to you.";

const state = {
  threadId: "",
  history: [],
  ready: false,
  config: null,
  profile: null,
  session: null,
  walletBusy: false,
  note: "",
  providerAvailable: Boolean(window.ethereum?.request)
};

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "Just now";
  }

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString("en-GB", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function shortAddress(address) {
  if (!address) {
    return "Wallet";
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getSessionLabel() {
  if (!state.session) {
    return "Guest";
  }

  return state.session.isWallet ? shortAddress(state.session.address) : state.session.displayName;
}

function getThreadStorageKey(session = state.session) {
  return `recall-thread:${session?.storageKey || "guest:bootstrap"}`;
}

function getDefaultNote() {
  if (!state.ready) {
    return "The chat is being configured right now. Please try again shortly.";
  }

  return state.session?.isWallet
    ? "Private memory is connected and ready."
    : "Guest mode is ready.";
}

function setNote(value) {
  state.note = value;
  composerNote.textContent = value;
}

function resetChatLog() {
  const introCopy = state.session?.isWallet
    ? `Wallet ${shortAddress(state.session.address)} is connected. This conversation now keeps its own private memory lane.`
    : INITIAL_ASSISTANT_COPY;

  chatLog.innerHTML = `
    <article class="message message-assistant">
      <p class="message-role">assistant</p>
      <p class="message-body">${introCopy}</p>
    </article>
  `;
}

function applySession(session, { resetConversation = true } = {}) {
  const previousStorageKey = state.session?.storageKey || "";
  const nextStorageKey = session?.storageKey || "";
  const shouldReset = resetConversation || previousStorageKey !== nextStorageKey;

  state.session = session;

  if (shouldReset) {
    state.threadId = window.localStorage.getItem(getThreadStorageKey(session)) || "";
    state.history = [];
    state.profile = null;
    resetChatLog();
  }

  renderThread();
  renderFromState();
}

function persistThread() {
  if (!state.threadId || !state.session?.storageKey) {
    return;
  }

  window.localStorage.setItem(getThreadStorageKey(), state.threadId);
}

function renderThread() {
  threadChip.textContent = state.threadId ? "Saved thread" : "Fresh chat";
}

function setBusy(isBusy) {
  promptInput.disabled = isBusy || !state.ready;
  sendButton.disabled = isBusy || !state.ready;
  composerNote.textContent = isBusy ? "Thinking..." : state.note || getDefaultNote();
}

function setWalletBusy(isBusy, label = "") {
  state.walletBusy = isBusy;
  walletActionButton.disabled = isBusy;

  if (isBusy && label) {
    walletActionButton.textContent = label;
    return;
  }

  updateWalletActionButton();
}

function appendMessage(role, content) {
  const article = document.createElement("article");
  article.className = `message message-${role}`;

  const roleLabel = document.createElement("p");
  roleLabel.className = "message-role";
  roleLabel.textContent = role;

  const body = document.createElement("p");
  body.className = "message-body";
  body.textContent = content;

  article.append(roleLabel, body);
  chatLog.append(article);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function updateWalletActionButton() {
  if (state.walletBusy) {
    return;
  }

  if (state.session?.isWallet) {
    walletActionButton.textContent = "Disconnect";
    return;
  }

  walletActionButton.textContent = state.providerAvailable ? "Connect Wallet" : "Wallet App Needed";
}

function renderMemoryPanel() {
  const memories = state.profile?.recent_memories || [];
  const storedTurns = Number(state.profile?.stats?.storedMessages || 0);
  const defaultSummary = state.session?.isWallet
    ? "This lane is private to your connected wallet and follows this conversation."
    : "Guest mode starts instantly. Connect a wallet if you want a private lane tied to you.";

  identityBadgeValue.textContent = getSessionLabel();
  modeBadge.textContent = state.session?.isWallet ? "Private memory" : "Guest mode";
  memoryModeBadge.textContent = state.session?.isWallet ? "Private lane" : "Guest lane";

  sessionSummary.textContent = storedTurns
    ? `${defaultSummary} It already remembers ${storedTurns} previous turn${storedTurns === 1 ? "" : "s"}.`
    : defaultSummary;

  const bio = typeof state.profile?.user_bio === "string" ? state.profile.user_bio.trim() : "";
  memorySummary.textContent = bio || (storedTurns
    ? "The latest useful pieces of the conversation appear below."
    : "Useful moments from the conversation will gather here so you can keep the thread without restating yourself.");

  if (!memories.length) {
    memoryList.innerHTML = `
      <article class="memory-item is-empty">
        <p>${
          state.session?.isWallet
            ? "Your private lane is ready. Say a few things and it will start holding onto the thread."
            : "Nothing saved yet. Send a few messages and Recall will start keeping the thread for you."
        }</p>
      </article>
    `;
    return;
  }

  memoryList.innerHTML = memories
    .slice(0, 4)
    .map(
      (memory) => `
        <article class="memory-item">
          <div class="memory-head">
            <span>${memory.role === "assistant" ? "Assistant" : "You"}</span>
            <strong>${formatTimestamp(memory.created_at)}</strong>
          </div>
          <p>${memory.content || memory.memory || ""}</p>
        </article>
      `
    )
    .join("");
}

function renderFromState() {
  updateWalletActionButton();
  renderThread();
  renderMemoryPanel();

  promptInput.placeholder = state.session?.isWallet
    ? "Continue the thread. Your private lane will keep the useful context."
    : "Message Recall about what you are building, writing, or deciding.";
}

function toFriendlyError(message) {
  if (!message) {
    return "Something went wrong. Please try again.";
  }

  const lower = message.toLowerCase();

  if (lower.includes("og_private_key") || lower.includes("configured")) {
    return "The assistant is still being configured right now. Please try again shortly.";
  }

  if (
    lower.includes("opg") ||
    lower.includes("permit2") ||
    lower.includes("base sepolia") ||
    lower.includes("402 payment required")
  ) {
    return "The assistant is temporarily unavailable while the shared wallet is being refreshed. Please try again soon.";
  }

  if (lower.includes("wallet signature")) {
    return "Wallet verification failed. Please try signing the message again.";
  }

  if (lower.includes("challenge")) {
    return "The wallet check expired. Try connecting again.";
  }

  return message;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

async function loadSession({ resetConversation = true } = {}) {
  const payload = await fetchJson("/api/auth/session");
  applySession(payload.session, { resetConversation });
  return payload;
}

async function loadConfig({ syncSession = false } = {}) {
  const payload = await fetchJson("/api/config");
  state.config = payload;
  state.ready = Boolean(payload.hasOpenGradientKey);

  if (syncSession && payload.session) {
    applySession(payload.session, { resetConversation: false });
    return;
  }

  renderFromState();
}

async function loadProfile({ syncSession = false } = {}) {
  const profile = await fetchJson("/api/profile");

  if (syncSession && profile.session) {
    applySession(profile.session, { resetConversation: false });
  }

  state.profile = profile.enabled
    ? profile
    : {
        enabled: false,
        user_bio: "",
        stats: null,
        recent_memories: []
      };

  renderFromState();
}

async function signWalletMessage(address, message) {
  try {
    return await window.ethereum.request({
      method: "personal_sign",
      params: [message, address]
    });
  } catch {
    return window.ethereum.request({
      method: "personal_sign",
      params: [address, message]
    });
  }
}

async function connectWallet() {
  if (!window.ethereum?.request) {
    setNote("Install MetaMask, Rabby, or another EVM wallet to connect a private lane.");
    return;
  }

  setWalletBusy(true, "Open wallet...");

  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    const address = Array.isArray(accounts) ? accounts[0] : "";

    if (!address) {
      throw new Error("No wallet account was returned.");
    }

    setWalletBusy(true, "Sign message...");
    const challenge = await fetchJson("/api/auth/challenge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ address })
    });

    const signature = await signWalletMessage(address, challenge.message);
    const payload = await fetchJson("/api/auth/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        address,
        signature,
        challenge: challenge.challenge
      })
    });

    applySession(payload.session);
    setNote(`Wallet ${shortAddress(payload.session.address)} connected. This lane is now private to you.`);
    await loadConfig({ syncSession: true });
    await loadProfile({ syncSession: true });
  } catch (error) {
    setNote(toFriendlyError(error.message));
  } finally {
    setWalletBusy(false);
  }
}

async function switchToGuestMode(note = "You are back in guest mode.") {
  setWalletBusy(true, "Switching...");

  try {
    const payload = await fetchJson("/api/auth/logout", { method: "POST" });
    applySession(payload.session);
    setNote(note);
    await loadConfig({ syncSession: true });
    await loadProfile({ syncSession: true });
  } catch (error) {
    setNote(toFriendlyError(error.message));
  } finally {
    setWalletBusy(false);
  }
}

async function handleWalletAction() {
  if (state.session?.isWallet) {
    await switchToGuestMode("Private lane disconnected. You are back in guest mode.");
    return;
  }

  await connectWallet();
}

async function handleAccountsChanged(accounts) {
  state.providerAvailable = Boolean(window.ethereum?.request);
  const nextAddress = Array.isArray(accounts) && accounts[0] ? String(accounts[0]).toLowerCase() : "";

  if (!state.session?.isWallet) {
    updateWalletActionButton();
    return;
  }

  if (!nextAddress) {
    await switchToGuestMode("Wallet disconnected in the provider. You are back in guest mode.");
    return;
  }

  if (state.session.address?.toLowerCase() !== nextAddress) {
    await switchToGuestMode("Wallet account changed. Connect again to move into a new private lane.");
  }
}

function attachWalletProviderListeners() {
  if (!window.ethereum?.on) {
    return;
  }

  window.ethereum.on("accountsChanged", handleAccountsChanged);
}

for (const chip of promptChips) {
  chip.addEventListener("click", () => {
    promptInput.value = chip.dataset.prompt || "";
    promptInput.focus();
  });
}

walletActionButton.addEventListener("click", handleWalletAction);

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
    const payload = await fetchJson("/api/chat", {
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

    if (payload.session) {
      applySession(payload.session, { resetConversation: false });
    }

    state.threadId = payload.threadId;
    persistThread();
    renderThread();

    appendMessage("assistant", payload.answer);
    state.history.push({ role: "assistant", content: payload.answer });

    setNote(payload.memoryStatus === "ok" ? "Saved. Keep going." : "Reply received.");
    await loadProfile({ syncSession: true });
  } catch (error) {
    const friendlyError = toFriendlyError(error.message);
    appendMessage("assistant", friendlyError);
    state.history.pop();
    setNote(friendlyError);
  } finally {
    setBusy(false);
  }
});

resetChatLog();
renderThread();
updateWalletActionButton();
attachWalletProviderListeners();
setBusy(true);

await loadSession();
await loadConfig({ syncSession: true });
await loadProfile({ syncSession: true });
setNote(getDefaultNote());
setBusy(false);
