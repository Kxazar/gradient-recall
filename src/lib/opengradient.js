import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_OPEN_GRADIENT_MODEL = "anthropic/claude-haiku-4-5";
export const DEFAULT_OG_RPC_URL = "https://ogevmdevnet.opengradient.ai";
export const DEFAULT_TEE_REGISTRY_ADDRESS = "0x4e72238852f3c918f4E4e57AeC9280dDB0c80248";

const MODEL_ALIASES = new Map([
  ["openai/gpt-4o", "openai/gpt-5-mini"],
  ["openai/gpt-4.1", "openai/gpt-4.1-2025-04-14"]
]);

const SUPPORTED_SETTLEMENT_TYPES = new Set(["private", "batch", "individual"]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const bridgeScriptPath = path.join(projectRoot, "scripts", "opengradient_bridge.py");
const localWindowsPython = path.join(projectRoot, ".venv-og", "Scripts", "python.exe");
const localPosixPython = path.join(projectRoot, ".venv-og", "bin", "python");

function normalizePrivateKey(privateKey) {
  if (!privateKey) {
    throw new Error("Missing OG_PRIVATE_KEY. Add a funded OpenGradient wallet private key to .env.");
  }

  return privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function normalizeOpenGradientModel(model = DEFAULT_OPEN_GRADIENT_MODEL) {
  const rawModel = (model || "").trim();

  if (!rawModel) {
    return DEFAULT_OPEN_GRADIENT_MODEL;
  }

  return MODEL_ALIASES.get(rawModel) || rawModel;
}

export function normalizeOpenGradientSettlementType(settlementType = "individual") {
  const normalized = (settlementType || "").trim().toLowerCase();
  return SUPPORTED_SETTLEMENT_TYPES.has(normalized) ? normalized : "individual";
}

async function resolvePythonExecutable(explicitExecutable = "") {
  const configured = (explicitExecutable || "").trim();

  if (configured) {
    return configured;
  }

  if (await fileExists(localWindowsPython)) {
    return localWindowsPython;
  }

  if (await fileExists(localPosixPython)) {
    return localPosixPython;
  }

  return process.platform === "win32" ? "python" : "python3";
}

function parseBridgeResponse(stdout, stderr, exitCode) {
  const trimmedStdout = stdout.trim();
  const trimmedStderr = stderr.trim();

  if (!trimmedStdout) {
    if (exitCode !== 0) {
      throw new Error(trimmedStderr || `OpenGradient bridge exited with code ${exitCode}.`);
    }

    return {};
  }

  let payload;

  try {
    payload = JSON.parse(trimmedStdout);
  } catch {
    throw new Error(trimmedStderr || "OpenGradient bridge returned invalid JSON.");
  }

  if (exitCode !== 0 || payload?.ok === false) {
    throw new Error(payload?.error || trimmedStderr || `OpenGradient bridge exited with code ${exitCode}.`);
  }

  return payload;
}

async function runBridgeCommand({ action, payload, envOverrides, pythonExecutable }) {
  if (!(await fileExists(bridgeScriptPath))) {
    throw new Error("OpenGradient bridge script is missing from scripts/opengradient_bridge.py.");
  }

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn(pythonExecutable, [bridgeScriptPath, action], {
      cwd: projectRoot,
      env: {
        ...process.env,
        ...envOverrides,
        PYTHONIOENCODING: "utf-8"
      },
      windowsHide: true
    });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;

      if (error?.code === "ENOENT") {
        reject(
          new Error(
            `Python runtime not found at '${pythonExecutable}'. Install opengradient in .venv-og or set OG_PYTHON_EXECUTABLE.`
          )
        );
        return;
      }

      reject(error);
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;

      try {
        resolve(parseBridgeResponse(stdout, stderr, exitCode ?? 0));
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

export function createOpenGradientClient({
  privateKey,
  model = DEFAULT_OPEN_GRADIENT_MODEL,
  maxTokens = 350,
  settlementType = "individual",
  pythonExecutable = "",
  rpcUrl = DEFAULT_OG_RPC_URL,
  teeRegistryAddress = DEFAULT_TEE_REGISTRY_ADDRESS
}) {
  const normalizedKey = normalizePrivateKey(privateKey);
  const normalizedModel = normalizeOpenGradientModel(model);
  const normalizedSettlementType = normalizeOpenGradientSettlementType(settlementType);
  let runtimePromise;

  async function getRuntime() {
    if (runtimePromise) {
      return runtimePromise;
    }

    runtimePromise = (async () => ({
      pythonExecutable: await resolvePythonExecutable(pythonExecutable),
      envOverrides: {
        OG_PRIVATE_KEY: normalizedKey,
        OG_RPC_URL: rpcUrl,
        OG_TEE_REGISTRY_ADDRESS: teeRegistryAddress
      }
    }))();

    return runtimePromise;
  }

  return {
    async getStatus() {
      const runtime = await getRuntime();

      return {
        ok: true,
        runtime: "python-sdk",
        pythonExecutable: runtime.pythonExecutable,
        bridgeScript: bridgeScriptPath,
        model: normalizedModel,
        settlementType: normalizedSettlementType,
        endpointStrategy: "registry-discovery"
      };
    },

    async ensureApproval(minAllowance = 0.1, approveAmount = minAllowance) {
      const runtime = await getRuntime();

      return runBridgeCommand({
        action: "approve",
        payload: { minAllowance, approveAmount },
        envOverrides: runtime.envOverrides,
        pythonExecutable: runtime.pythonExecutable
      });
    },

    async getWalletStatus() {
      const runtime = await getRuntime();

      return runBridgeCommand({
        action: "wallet",
        payload: {},
        envOverrides: runtime.envOverrides,
        pythonExecutable: runtime.pythonExecutable
      });
    },

    async chat(messages) {
      const runtime = await getRuntime();
      let payload;

      try {
        payload = await runBridgeCommand({
          action: "chat",
          payload: {
            model: normalizedModel,
            maxTokens,
            settlementType: normalizedSettlementType,
            messages
          },
          envOverrides: runtime.envOverrides,
          pythonExecutable: runtime.pythonExecutable
        });
      } catch (error) {
        throw new Error(`OpenGradient network error: ${error.message || "Unknown bridge error."}`);
      }

      return {
        content: payload.content || "",
        raw: payload.raw || null,
        usage: payload.usage ?? null,
        model: payload.model || normalizedModel,
        settlementType: payload.settlementType || normalizedSettlementType,
        teeEndpoint: payload.teeEndpoint || "",
        teeTimestamp: payload.teeTimestamp || "",
        finishReason: payload.finishReason || null
      };
    }
  };
}
