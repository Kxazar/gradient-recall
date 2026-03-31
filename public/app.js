const tabButtons = [...document.querySelectorAll(".tab-trigger")];
const tabPanels = [...document.querySelectorAll(".tab-panel")];
const promptChips = [...document.querySelectorAll(".prompt-chip")];

const chatLog = document.getElementById("chatLog");
const composer = document.getElementById("composer");
const promptInput = document.getElementById("promptInput");
const composerNote = document.getElementById("composerNote");
const sendButton = document.getElementById("sendButton");
const walletActionButton = document.getElementById("walletActionButton");
const threadChip = document.getElementById("threadChip");
const modelValue = document.getElementById("modelValue");
const settlementValue = document.getElementById("settlementValue");
const walletStatus = document.getElementById("walletStatus");
const memoryStatus = document.getElementById("memoryStatus");
const identityBadgeValue = document.getElementById("identityBadgeValue");
const runtimeValue = document.getElementById("runtimeValue");
const setupHint = document.getElementById("setupHint");
const readinessTitle = document.getElementById("readinessTitle");
const statusStack = document.getElementById("statusStack");
const overviewMetrics = document.getElementById("overviewMetrics");
const userBio = document.getElementById("userBio");
const insightsList = document.getElementById("insightsList");
const memoryList = document.getElementById("memoryList");
const railMemoryPreview = document.getElementById("railMemoryPreview");
const studioDetails = document.getElementById("studioDetails");
const launchChecklist = document.getElementById("launchChecklist");
const endpointList = document.getElementById("endpointList");
const studioModeTag = document.getElementById("studioModeTag");

const INITIAL_ASSISTANT_COPY = "Anyone can use the studio in guest mode. Connect a wallet if you want a persistent, private memory lane bound to your address.";

const state = {
  threadId: "",
  history: [],
  ready: false,
  activeTab: "overview",
  config: null,
  profile: null,
  session: null,
  walletBusy: false,
  providerAvailable: Boolean(window.ethereum?.request)
};

function formatBalance(value, digits = 4) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : value || "n/a";
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "No activity yet";
  }

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString("en-GB", {
    year: "numeric",
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

function getOperatorWalletMeta() {
  const wallet = state.config?.walletStatus || null;
  const opgBalance = Number(wallet?.opgBalance);
  const ethBalance = Number(wallet?.ethBalance);
  const allowance = Number(wallet?.permit2Allowance);

  return {
    wallet,
    opgBalance,
    ethBalance,
    allowance,
    hasHealthyOpg: Number.isFinite(opgBalance) && opgBalance >= 0.1,
    hasHealthyEth: Number.isFinite(ethBalance) && ethBalance >= 0.001,
    hasAllowance: Number.isFinite(allowance) && allowance >= 0.1
  };
}

function getProfileStats() {
  return state.profile?.stats || null;
}

function getSessionLabel() {
  if (!state.session) {
    return "Guest";
  }

  return state.session.isWallet ? shortAddress(state.session.address) : state.session.displayName;
}

function getSessionModeLabel() {
  if (!state.session) {
    return "guest mode";
  }

  return state.session.isWallet ? "wallet lane" : "guest lane";
}

function getThreadStorageKey(session = state.session) {
  return `gradient-recall-thread:${session?.storageKey || "guest:bootstrap"}`;
}

function resetChatLog() {
  const introCopy = state.session?.isWallet
    ? `Wallet ${shortAddress(state.session.address)} is connected. Your prompts will now write into a private memory lane scoped to this address.`
    : INITIAL_ASSISTANT_COPY;

  chatLog.innerHTML = `
    <article class="message message-assistant">
      <p class="message-role">assistant</p>
      <p>${introCopy}</p>
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
    resetChatLog();
    state.profile = null;
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

function setActiveTab(tabId) {
  state.activeTab = tabId;

  for (const button of tabButtons) {
    const isActive = button.dataset.tab === tabId;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  }

  for (const panel of tabPanels) {
    const isActive = panel.dataset.panel === tabId;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  }
}

function renderThread() {
  threadChip.textContent = `Thread: ${state.threadId || "new session"}`;
}

function setBusy(isBusy) {
  promptInput.disabled = isBusy || !state.ready;
  sendButton.disabled = isBusy || !state.ready;
  composerNote.textContent = isBusy ? "OpenGradient is generating a verified response..." : composerNote.textContent || "Ready for the next move.";
}

function setWalletBusy(isBusy, label = "") {
  state.walletBusy = isBusy;
  walletActionButton.disabled = isBusy;

  if (isBusy && label) {
    walletActionButton.textContent = label;
  } else {
    updateWalletActionButton();
  }
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

function updateWalletActionButton() {
  if (state.walletBusy) {
    return;
  }

  if (state.session?.isWallet) {
    walletActionButton.textContent = "Disconnect Wallet";
    walletActionButton.disabled = false;
    return;
  }

  walletActionButton.textContent = state.providerAvailable ? "Connect Wallet" : "Wallet App Needed";
  walletActionButton.disabled = false;
}

function renderStatusStack() {
  const walletMeta = getOperatorWalletMeta();
  const profileStats = getProfileStats();
  const tiles = [
    {
      label: "Audience access",
      value: state.session?.isWallet
        ? `${getSessionLabel()} with private memory`
        : "Public guest mode is live"
    },
    {
      label: "Cloud recall",
      value: state.config?.hasSupabase
        ? `${profileStats?.storedMessages || 0} stored turns across ${profileStats?.threadsSeen || 0} threads`
        : "Supabase not configured"
    },
    {
      label: "Operator wallet",
      value: walletMeta.wallet
        ? `${formatBalance(walletMeta.wallet.opgBalance)} OPG / ${formatBalance(walletMeta.wallet.ethBalance, 3)} ETH`
        : "Waiting for operator wallet"
    }
  ];

  statusStack.innerHTML = tiles
    .map(
      (tile) => `
        <article class="status-tile">
          <span>${tile.label}</span>
          <strong>${tile.value}</strong>
        </article>
      `
    )
    .join("");
}

function renderOverviewMetrics() {
  const profileStats = getProfileStats();
  const metrics = [
    {
      label: "Identity",
      value: getSessionLabel(),
      note: state.session?.isWallet ? "Wallet-linked memory lane" : "Public guest lane"
    },
    {
      label: "Stored turns",
      value: `${profileStats?.storedMessages || 0}`,
      note: "Saved in Supabase for recall"
    },
    {
      label: "Threads",
      value: `${profileStats?.threadsSeen || 0}`,
      note: "Conversation groups remembered"
    },
    {
      label: "Latest memory",
      value: profileStats?.latestActivity ? formatTimestamp(profileStats.latestActivity) : "No activity yet",
      note: profileStats?.latestUserNote || "No recent user note"
    }
  ];

  overviewMetrics.innerHTML = metrics
    .map(
      (metric) => `
        <article class="metric-card">
          <span>${metric.label}</span>
          <strong>${metric.value}</strong>
          <p>${metric.note}</p>
        </article>
      `
    )
    .join("");
}

function renderInsights() {
  const insights = state.profile?.insights || [];

  if (!insights.length) {
    insightsList.innerHTML = '<article class="insight-pill">No profile insights available yet.</article>';
    return;
  }

  insightsList.innerHTML = insights
    .map((insight) => `<article class="insight-pill">${typeof insight === "string" ? insight : JSON.stringify(insight)}</article>`)
    .join("");
}

function renderMemories(memories = []) {
  if (!memories.length) {
    const emptyCopy = state.session?.isWallet
      ? "Your wallet lane is empty for now. Send a few prompts and this atlas will start mapping your private recall."
      : "Guest mode is live, but this lane is still empty. Send a few prompts or connect a wallet for persistent recall.";
    memoryList.innerHTML = `<article class="memory-item">${emptyCopy}</article>`;
    railMemoryPreview.innerHTML = '<article class="mini-memory">Memory preview is waiting for the first successful recall.</article>';
    return;
  }

  memoryList.innerHTML = memories
    .map(
      (memory) => `
        <article class="memory-item">
          <div class="memory-head">
            <span>${memory.role || "memory"}</span>
            <strong>${memory.score ? `score ${memory.score}` : formatTimestamp(memory.created_at)}</strong>
          </div>
          <p>${memory.memory || memory.content || ""}</p>
        </article>
      `
    )
    .join("");

  railMemoryPreview.innerHTML = memories
    .slice(0, 3)
    .map(
      (memory) => `
        <article class="mini-memory">
          <strong>${memory.role || "memory"}</strong>
          <p>${memory.memory || memory.content || ""}</p>
        </article>
      `
    )
    .join("");
}

function renderStudioDetails() {
  const walletMeta = getOperatorWalletMeta();
  const details = [
    `Identity lane: ${state.session?.isWallet ? `wallet ${state.session.address}` : "guest mode"}`,
    `Scoped memory user: ${state.session?.userId || "pending"}`,
    `Model lane: ${state.config?.model || "unknown"}`,
    `Settlement mode: ${state.config?.settlementType || "unknown"}`,
    `Endpoint strategy: ${state.config?.endpointStrategy || "unknown"}`,
    walletMeta.wallet
      ? `Operator wallet: ${formatBalance(walletMeta.wallet.opgBalance)} OPG / ${formatBalance(walletMeta.wallet.ethBalance, 3)} ETH`
      : "Operator wallet diagnostics pending",
    state.profile?.stats?.latestUserNote
      ? `Latest note: ${state.profile.stats.latestUserNote}`
      : "Latest note: none yet"
  ];

  studioDetails.innerHTML = details.map((item) => `<li>${item}</li>`).join("");
  studioModeTag.textContent = state.ready ? (state.session?.isWallet ? "Wallet lane armed" : "Guest lane armed") : "Awaiting env";
}

function renderLaunch() {
  const walletMeta = getOperatorWalletMeta();
  const checks = [
    {
      title: "Public access",
      status: true,
      note: "Anyone can use the site in guest mode over the public Vercel URL."
    },
    {
      title: "Identity mode",
      status: true,
      note: state.session?.isWallet
        ? `Wallet lane active for ${shortAddress(state.session.address)}`
        : "Guest lane active. Connect a wallet for persistent memory."
    },
    {
      title: "OpenGradient key",
      status: state.config?.hasOpenGradientKey,
      note: state.config?.hasOpenGradientKey ? "Backend signing key is available." : "Add OG_PRIVATE_KEY in env."
    },
    {
      title: "Supabase memory",
      status: state.config?.hasSupabase,
      note: state.config?.hasSupabase ? "Cloud memory routes are online." : "Add SUPABASE_URL and a server-side key."
    },
    {
      title: "Operator wallet funded",
      status: walletMeta.hasHealthyOpg && walletMeta.hasHealthyEth,
      note: walletMeta.wallet
        ? `${formatBalance(walletMeta.wallet.opgBalance)} OPG / ${formatBalance(walletMeta.wallet.ethBalance, 3)} ETH`
        : "Operator wallet status unavailable"
    },
    {
      title: "Permit2 allowance",
      status: walletMeta.hasAllowance,
      note: walletMeta.wallet ? `${formatBalance(walletMeta.wallet.permit2Allowance)} OPG approved` : "Allowance unavailable"
    }
  ];

  launchChecklist.innerHTML = checks
    .map(
      (check) => `
        <article class="check-card ${check.status ? "is-good" : "is-warn"}">
          <div class="check-state">${check.status ? "Ready" : "Needs attention"}</div>
          <strong>${check.title}</strong>
          <p>${check.note}</p>
        </article>
      `
    )
    .join("");

  const routes = [
    { method: "GET", path: "/api/auth/session", note: "Resolve guest or wallet identity for any visitor" },
    { method: "POST", path: "/api/auth/challenge", note: "Create a wallet signature challenge" },
    { method: "POST", path: "/api/auth/verify", note: "Verify signature and bind a wallet lane" },
    { method: "POST", path: "/api/auth/logout", note: "Return to guest mode" },
    { method: "GET", path: "/api/config", note: "Runtime, operator wallet, and deployment posture" },
    { method: "GET", path: "/api/profile", note: "Profile + memory scoped to the current lane" },
    { method: "POST", path: "/api/chat", note: "Memory-augmented verified inference for the current session" }
  ];

  endpointList.innerHTML = routes
    .map(
      (route) => `
        <article class="endpoint-card">
          <div class="endpoint-head">
            <span>${route.method}</span>
            <strong>${route.path}</strong>
          </div>
          <p>${route.note}</p>
        </article>
      `
    )
    .join("");
}

function renderReadinessNarrative() {
  const walletMeta = getOperatorWalletMeta();
  const profileStats = getProfileStats();

  if (!state.config?.hasOpenGradientKey) {
    readinessTitle.textContent = "Waiting for credentials";
    setupHint.textContent = "Add OG_PRIVATE_KEY to your environment, then refresh. The public studio will unlock once the backend can sign OpenGradient requests.";
    return;
  }

  if (!walletMeta.hasHealthyOpg) {
    readinessTitle.textContent = "Operator wallet needs fuel";
    setupHint.textContent = `The shared OpenGradient payment wallet ${walletMeta.wallet?.address || ""} is low on OPG. Top it up before inviting more public usage.`;
    return;
  }

  if (!state.config?.hasSupabase) {
    readinessTitle.textContent = "Memory layer offline";
    setupHint.textContent = "Inference is ready, but Supabase memory is not configured. Add the project URL and a server-side key to unlock recall for both guests and wallet-linked users.";
    return;
  }

  if (state.session?.isWallet) {
    readinessTitle.textContent = "Wallet-linked lane active";
    setupHint.textContent = `${shortAddress(state.session.address)} is connected. Your prompts and recalled memory are now scoped to this wallet identity.`;
    return;
  }

  readinessTitle.textContent = "Public guest mode is live";
  setupHint.textContent = `Anyone can use the site right now. Current lane: guest mode, with ${profileStats?.storedMessages || 0} stored turns in this session. Connect a wallet to keep memory tied to one identity.`;
}

function renderFromState() {
  const operatorWallet = state.config?.walletStatus || null;

  modelValue.textContent = state.config?.model || "Unknown";
  settlementValue.textContent = state.config?.settlementType || "Unknown";
  memoryStatus.textContent = state.config?.hasSupabase ? getSessionModeLabel() : "offline";
  walletStatus.textContent = operatorWallet ? `${formatBalance(operatorWallet.opgBalance)} OPG` : "missing";
  identityBadgeValue.textContent = getSessionLabel();
  runtimeValue.textContent = state.config?.openGradientRuntime || "n/a";

  updateWalletActionButton();
  renderThread();
  renderStatusStack();
  renderOverviewMetrics();
  renderInsights();
  renderMemories((state.profile?.recent_memories || []).map((memory) => ({ ...memory, memory: memory.content })));
  renderStudioDetails();
  renderLaunch();
  renderReadinessNarrative();

  userBio.textContent = state.profile?.user_bio || "No scoped memory summary loaded yet.";
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
  } else {
    renderFromState();
  }
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
        user_bio: state.session?.isWallet
          ? `Wallet lane ${shortAddress(state.session.address)} is ready, but no memory has been stored yet.`
          : "Guest mode is active. Connect a wallet for a persistent memory lane or start chatting to seed this guest session.",
        stats: null,
        insights: [],
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
  } catch (error) {
    return window.ethereum.request({
      method: "personal_sign",
      params: [address, message]
    });
  }
}

async function connectWallet() {
  if (!window.ethereum?.request) {
    composerNote.textContent = "Install MetaMask, Rabby, or another injected EVM wallet to connect a wallet lane.";
    return;
  }

  setWalletBusy(true, "Awaiting wallet...");

  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    const address = Array.isArray(accounts) ? accounts[0] : "";

    if (!address) {
      throw new Error("No wallet account was returned.");
    }

    setWalletBusy(true, "Awaiting signature...");
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
    composerNote.textContent = `Wallet ${shortAddress(payload.session.address)} connected. Your memory lane is now private to this address.`;
    await loadConfig({ syncSession: true });
    await loadProfile({ syncSession: true });
  } catch (error) {
    composerNote.textContent = error.message || "Wallet connection failed.";
  } finally {
    setWalletBusy(false);
  }
}

async function switchToGuestMode(note = "You are back in guest mode.") {
  setWalletBusy(true, "Switching...");

  try {
    const payload = await fetchJson("/api/auth/logout", { method: "POST" });
    applySession(payload.session);
    composerNote.textContent = note;
    await loadConfig({ syncSession: true });
    await loadProfile({ syncSession: true });
  } catch (error) {
    composerNote.textContent = error.message || "Failed to switch back to guest mode.";
  } finally {
    setWalletBusy(false);
  }
}

async function handleWalletAction() {
  if (state.session?.isWallet) {
    await switchToGuestMode("Wallet lane disconnected. Public guest mode is active again.");
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
    await switchToGuestMode("Wallet account changed. Connect again to bind a new memory lane.");
  }
}

function attachWalletProviderListeners() {
  if (!window.ethereum?.on) {
    return;
  }

  window.ethereum.on("accountsChanged", handleAccountsChanged);
}

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    setActiveTab(button.dataset.tab);
  });
}

for (const chip of promptChips) {
  chip.addEventListener("click", () => {
    promptInput.value = chip.dataset.prompt || "";
    setActiveTab("studio");
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
    composerNote.textContent = payload.memoryStatus === "ok"
      ? "Verified response received. Supabase recall was applied."
      : payload.memoryStatus === "disabled"
        ? "Verified response received. Cloud memory is off."
        : `Verified response received. Memory note: ${payload.memoryStatus}`;

    await loadProfile({ syncSession: true });

    const mergedRecentMemories = payload.memories?.length
      ? payload.memories
      : (state.profile?.recent_memories || []).map((memory) => ({ ...memory, memory: memory.content }));
    renderMemories(mergedRecentMemories);
  } catch (error) {
    appendMessage("assistant", `Request failed: ${error.message}`);
    state.history.pop();
    composerNote.textContent = error.message;
  } finally {
    setBusy(false);
  }
});

setActiveTab(state.activeTab);
resetChatLog();
renderThread();
updateWalletActionButton();
setBusy(true);
attachWalletProviderListeners();

await loadSession();
await loadConfig({ syncSession: true });
await loadProfile({ syncSession: true });

composerNote.textContent = state.session?.isWallet
  ? "Wallet lane is ready for the next move."
  : "Guest mode is ready. Connect a wallet if you want persistent recall.";
setBusy(false);
