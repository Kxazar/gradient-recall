import crypto from "node:crypto";

import { getAddress, isAddress, recoverMessageAddress } from "viem";

export const SESSION_COOKIE_NAME = "gradient_recall_session";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const CHALLENGE_TTL_SECONDS = 60 * 10;

function base64UrlEncode(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url");
}

function jsonBytes(payload) {
  return Buffer.from(JSON.stringify(payload, Object.keys(payload).sort()), "utf8");
}

function signPayload(payload, secret) {
  const payloadValue = base64UrlEncode(jsonBytes(payload));
  const signature = crypto.createHmac("sha256", secret).update(payloadValue).digest();
  return `${payloadValue}.${base64UrlEncode(signature)}`;
}

function verifyToken(token, secret, expectedType) {
  if (!token || !token.includes(".")) {
    return null;
  }

  const [payloadValue, signatureValue] = token.split(".", 2);
  const expectedSignature = crypto.createHmac("sha256", secret).update(payloadValue).digest();

  let payload;

  try {
    const decodedSignature = base64UrlDecode(signatureValue);
    if (decodedSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(decodedSignature, expectedSignature)) {
      return null;
    }
    payload = JSON.parse(base64UrlDecode(payloadValue).toString("utf8"));
  } catch {
    return null;
  }

  if (payload.type !== expectedType || Number(payload.exp || 0) <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

function toIsoTimestamp(seconds) {
  return new Date(seconds * 1000).toISOString();
}

function shortAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function shortGuestId(value) {
  const compact = value.replaceAll("-", "");
  return `${compact.slice(0, 6)}...${compact.slice(-4)}`;
}

function sessionView(kind, subject) {
  if (kind === "wallet") {
    const address = getAddress(subject);
    const userId = `wallet:${address.toLowerCase()}`;
    return {
      kind: "wallet",
      address,
      userId,
      displayName: shortAddress(address),
      storageKey: userId,
      isGuest: false,
      isWallet: true
    };
  }

  const userId = `guest:${subject}`;
  return {
    kind: "guest",
    address: null,
    userId,
    displayName: `Guest ${shortGuestId(subject)}`,
    storageKey: userId,
    isGuest: true,
    isWallet: false
  };
}

export function buildWalletMessage(challengePayload) {
  return [
    "Gradient Recall Wallet Verification",
    "",
    "Sign this message to bind your wallet to a private memory lane.",
    `Domain: ${challengePayload.host}`,
    `Address: ${challengePayload.address}`,
    `Nonce: ${challengePayload.nonce}`,
    `Issued At: ${toIsoTimestamp(challengePayload.iat)}`,
    `Expires At: ${toIsoTimestamp(challengePayload.exp)}`
  ].join("\n");
}

export function createChallenge(address, host, secret) {
  const checksumAddress = getAddress(address);
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    type: "challenge",
    address: checksumAddress,
    host,
    nonce: crypto.randomUUID().replaceAll("-", ""),
    iat: now,
    exp: now + CHALLENGE_TTL_SECONDS
  };

  return {
    challenge: signPayload(payload, secret),
    message: buildWalletMessage(payload),
    expiresAt: toIsoTimestamp(payload.exp),
    address: checksumAddress
  };
}

function issueSessionToken(kind, subject, secret) {
  const now = Math.floor(Date.now() / 1000);
  return signPayload(
    {
      type: "session",
      kind,
      sub: subject,
      iat: now,
      exp: now + SESSION_TTL_SECONDS
    },
    secret
  );
}

export function createGuestSession(secret) {
  const guestId = crypto.randomUUID();
  return {
    session: sessionView("guest", guestId),
    token: issueSessionToken("guest", guestId, secret)
  };
}

export function createWalletSession(address, secret) {
  const checksumAddress = getAddress(address);
  return {
    session: sessionView("wallet", checksumAddress),
    token: issueSessionToken("wallet", checksumAddress, secret)
  };
}

export function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator < 0) {
          return [part, ""];
        }
        return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      })
  );
}

export function sessionFromCookies(cookieHeader, secret) {
  const cookies = parseCookies(cookieHeader);
  const payload = verifyToken(cookies[SESSION_COOKIE_NAME], secret, "session");

  if (!payload) {
    return null;
  }

  return sessionView(String(payload.kind || "guest"), String(payload.sub || ""));
}

export function ensureSession(cookieHeader, secret) {
  const session = sessionFromCookies(cookieHeader, secret);

  if (session) {
    return { session, token: null };
  }

  return createGuestSession(secret);
}

export function serializeSessionCookie(token, isSecure) {
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    isSecure ? "Secure" : null
  ]
    .filter(Boolean)
    .join("; ");
}

export function serializeClearedSessionCookie(isSecure) {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
    isSecure ? "Secure" : null
  ]
    .filter(Boolean)
    .join("; ");
}

export async function verifyWalletSignature({ address, signature, challenge, secret }) {
  if (!isAddress(address)) {
    throw new Error("Wallet address is invalid.");
  }

  const payload = verifyToken(challenge, secret, "challenge");

  if (!payload) {
    throw new Error("Challenge is invalid or expired. Request a fresh signature challenge.");
  }

  const checksumAddress = getAddress(address);

  if (payload.address !== checksumAddress) {
    throw new Error("Challenge address mismatch. Request a fresh signature challenge.");
  }

  const recovered = await recoverMessageAddress({
    message: buildWalletMessage(payload),
    signature
  });

  if (getAddress(recovered) !== checksumAddress) {
    throw new Error("Wallet signature verification failed.");
  }

  return payload;
}
