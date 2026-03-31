from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from eth_account import Account
from eth_account.messages import encode_defunct
from flask import Request, Response
from web3 import Web3

from .settings import AppConfig

SESSION_COOKIE_NAME = "gradient_recall_session"
SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
CHALLENGE_TTL_SECONDS = 60 * 10


def _json_dumps(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(raw: str) -> bytes:
    padding = "=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode(f"{raw}{padding}".encode("ascii"))


def _sign(payload: dict[str, Any], config: AppConfig) -> str:
    payload_b64 = _b64url_encode(_json_dumps(payload))
    digest = hmac.new(config.session_secret.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).digest()
    return f"{payload_b64}.{_b64url_encode(digest)}"


def _verify(token: str | None, config: AppConfig, expected_type: str) -> dict[str, Any] | None:
    if not token or "." not in token:
        return None

    payload_b64, signature_b64 = token.split(".", 1)
    expected_signature = hmac.new(
        config.session_secret.encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).digest()

    try:
        signature = _b64url_decode(signature_b64)
    except Exception:
        return None

    if not hmac.compare_digest(signature, expected_signature):
        return None

    try:
        payload = json.loads(_b64url_decode(payload_b64))
    except Exception:
        return None

    if payload.get("type") != expected_type:
        return None

    if int(payload.get("exp", 0)) <= int(time.time()):
        return None

    return payload


def _isoformat(timestamp_seconds: int) -> str:
    return datetime.fromtimestamp(timestamp_seconds, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _short_guest_id(value: str) -> str:
    compact = value.replace("-", "")
    return f"{compact[:6]}...{compact[-4:]}"


def _short_address(address: str) -> str:
    return f"{address[:6]}...{address[-4:]}"


def _session_view(kind: str, subject: str) -> dict[str, Any]:
    if kind == "wallet":
        address = Web3.to_checksum_address(subject)
        user_id = f"wallet:{address.lower()}"
        return {
            "kind": "wallet",
            "address": address,
            "userId": user_id,
            "displayName": _short_address(address),
            "storageKey": user_id,
            "isGuest": False,
            "isWallet": True,
        }

    user_id = f"guest:{subject}"
    return {
        "kind": "guest",
        "address": None,
        "userId": user_id,
        "displayName": f"Guest {_short_guest_id(subject)}",
        "storageKey": user_id,
        "isGuest": True,
        "isWallet": False,
    }


def build_wallet_message(challenge_payload: dict[str, Any]) -> str:
    return "\n".join(
        [
            "Gradient Recall Wallet Verification",
            "",
            "Sign this message to bind your wallet to a private memory lane.",
            f"Domain: {challenge_payload['host']}",
            f"Address: {challenge_payload['address']}",
            f"Nonce: {challenge_payload['nonce']}",
            f"Issued At: {_isoformat(int(challenge_payload['iat']))}",
            f"Expires At: {_isoformat(int(challenge_payload['exp']))}",
        ]
    )


def create_challenge(address: str, host: str, config: AppConfig) -> dict[str, Any]:
    checksum_address = Web3.to_checksum_address(address)
    now = int(time.time())
    payload = {
        "type": "challenge",
        "address": checksum_address,
        "host": host,
        "nonce": uuid.uuid4().hex,
        "iat": now,
        "exp": now + CHALLENGE_TTL_SECONDS,
    }

    return {
        "challenge": _sign(payload, config),
        "message": build_wallet_message(payload),
        "expiresAt": _isoformat(payload["exp"]),
        "address": checksum_address,
    }


def _issue_session_token(kind: str, subject: str, config: AppConfig) -> str:
    now = int(time.time())
    payload = {
        "type": "session",
        "kind": kind,
        "sub": subject,
        "iat": now,
        "exp": now + SESSION_TTL_SECONDS,
    }
    return _sign(payload, config)


def create_guest_session(config: AppConfig) -> tuple[dict[str, Any], str]:
    guest_id = str(uuid.uuid4())
    return _session_view("guest", guest_id), _issue_session_token("guest", guest_id, config)


def create_wallet_session_response(address: str, config: AppConfig) -> tuple[dict[str, Any], str]:
    checksum_address = Web3.to_checksum_address(address)
    return _session_view("wallet", checksum_address), _issue_session_token("wallet", checksum_address, config)


def session_from_request(request: Request, config: AppConfig) -> dict[str, Any] | None:
    payload = _verify(request.cookies.get(SESSION_COOKIE_NAME), config, "session")

    if not payload:
        return None

    return _session_view(str(payload.get("kind", "guest")), str(payload.get("sub", "")))


def ensure_session(request: Request, config: AppConfig) -> tuple[dict[str, Any], str | None]:
    session = session_from_request(request, config)

    if session:
        return session, None

    guest_session, guest_token = create_guest_session(config)
    return guest_session, guest_token


def set_session_cookie(response: Response, token: str, request: Request) -> None:
    is_secure = request.is_secure or request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https"
    response.set_cookie(
        SESSION_COOKIE_NAME,
        token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        secure=is_secure,
        samesite="Lax",
        path="/",
    )


def clear_session_cookie(response: Response, request: Request) -> None:
    is_secure = request.is_secure or request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https"
    response.set_cookie(
        SESSION_COOKIE_NAME,
        "",
        max_age=0,
        httponly=True,
        secure=is_secure,
        samesite="Lax",
        path="/",
    )


def verify_wallet_signature(address: str, signature: str, challenge_token: str, config: AppConfig) -> dict[str, Any]:
    if not Web3.is_address(address):
        raise ValueError("Wallet address is invalid.")

    payload = _verify(challenge_token, config, "challenge")

    if not payload:
        raise ValueError("Challenge is invalid or expired. Request a fresh signature challenge.")

    checksum_address = Web3.to_checksum_address(address)

    if payload.get("address") != checksum_address:
        raise ValueError("Challenge address mismatch. Request a fresh signature challenge.")

    message = build_wallet_message(payload)
    recovered = Account.recover_message(encode_defunct(text=message), signature=signature)

    if Web3.to_checksum_address(recovered) != checksum_address:
        raise ValueError("Wallet signature verification failed.")

    return payload
