import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

function normalizePrivateKey(privateKey) {
  if (!privateKey) {
    throw new Error("Missing OG_PRIVATE_KEY. Add a Base Sepolia wallet private key to .env.");
  }

  return privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
}

function extractAssistantText(payload) {
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        return typeof part?.text === "string" ? part.text : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  throw new Error("OpenGradient returned an unexpected response shape.");
}

export function createOpenGradientClient({
  privateKey,
  model = "openai/gpt-4o",
  maxTokens = 350,
  settlementType = "individual",
  baseUrl = "https://llm.opengradient.ai"
}) {
  const normalizedKey = normalizePrivateKey(privateKey);
  const account = privateKeyToAccount(normalizedKey);
  const x402Fetch = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: "eip155:84532",
        client: new ExactEvmScheme(account)
      }
    ]
  });

  return {
    async chat(messages) {
      const response = await x402Fetch(`${baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-SETTLEMENT-TYPE": settlementType
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens
        })
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const reason =
          payload?.error?.message ||
          payload?.message ||
          `OpenGradient request failed with status ${response.status}.`;
        throw new Error(reason);
      }

      return {
        content: extractAssistantText(payload),
        raw: payload,
        usage: payload?.usage ?? null
      };
    }
  };
}
