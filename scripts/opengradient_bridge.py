#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any

from opengradient import LLM
from opengradient.types import TEE_LLM, x402SettlementMode
from web3 import Web3
from x402.mechanisms.evm.constants import PERMIT2_ADDRESS

DEFAULT_MODEL = "anthropic/claude-haiku-4-5"
DEFAULT_RPC_URL = "https://ogevmdevnet.opengradient.ai"
DEFAULT_TEE_REGISTRY_ADDRESS = "0x4e72238852f3c918f4E4e57AeC9280dDB0c80248"
BASE_SEPOLIA_RPC = "https://sepolia.base.org"
BASE_OPG_ADDRESS = "0x240b09731D96979f50B2C649C9CE10FcF9C7987F"

MODEL_ALIASES = {
    "openai/gpt-4o": "anthropic/claude-haiku-4-5",
    "openai/gpt-4.1": "openai/gpt-4.1-2025-04-14",
}

SUPPORTED_MODELS = {model.value for model in TEE_LLM}
SETTLEMENT_MODES = {mode.value: mode for mode in x402SettlementMode}

ERC20_BALANCE_ABI = [
    {
        "inputs": [{"name": "owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "spender", "type": "address"},
        ],
        "name": "allowance",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
]


def emit(payload: dict[str, Any]) -> None:
    json.dump(payload, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    sys.stdout.flush()


def fail(error: Exception | str) -> int:
    message = str(error).strip() or "Unknown OpenGradient bridge error."
    emit({"ok": False, "error": message})
    return 1


def read_payload() -> dict[str, Any]:
    raw = sys.stdin.read()

    if not raw.strip():
        return {}

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid JSON passed to OpenGradient bridge: {error}") from error

    if not isinstance(payload, dict):
        raise ValueError("OpenGradient bridge expects a JSON object payload.")

    return payload


def normalize_private_key() -> str:
    private_key = (os.environ.get("OG_PRIVATE_KEY") or "").strip()

    if not private_key:
        raise ValueError("OG_PRIVATE_KEY is missing.")

    return private_key if private_key.startswith("0x") else f"0x{private_key}"


def normalize_model(raw_model: Any) -> str:
    requested = str(raw_model or "").strip()
    aliased = MODEL_ALIASES.get(requested, requested) or DEFAULT_MODEL

    if aliased not in SUPPORTED_MODELS:
        supported = ", ".join(sorted(SUPPORTED_MODELS))
        raise ValueError(f"Unsupported OG_MODEL '{requested}'. Supported models: {supported}")

    return aliased


def normalize_settlement_type(raw_settlement_type: Any) -> x402SettlementMode:
    normalized = str(raw_settlement_type or "").strip().lower() or "individual"

    if normalized not in SETTLEMENT_MODES:
        supported = ", ".join(sorted(SETTLEMENT_MODES.keys()))
        raise ValueError(f"Unsupported OG_SETTLEMENT_TYPE '{normalized}'. Supported values: {supported}")

    return SETTLEMENT_MODES[normalized]


def normalize_messages(raw_messages: Any) -> list[dict[str, str]]:
    if not isinstance(raw_messages, list):
        raise ValueError("OpenGradient chat expects 'messages' to be an array.")

    messages: list[dict[str, str]] = []

    for item in raw_messages:
        if not isinstance(item, dict):
            continue

        role = str(item.get("role") or "user").strip().lower()
        content = item.get("content")

        if not isinstance(content, str):
            continue

        content = content.strip()

        if not content:
            continue

        if role not in {"system", "user", "assistant"}:
            role = "user"

        messages.append({"role": role, "content": content})

    if not messages:
        raise ValueError("OpenGradient chat payload must include at least one non-empty message.")

    return messages


def extract_content(raw_content: Any) -> str:
    if isinstance(raw_content, str):
        return raw_content

    if isinstance(raw_content, list):
        parts: list[str] = []

        for item in raw_content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())

        return "\n".join(parts).strip()

    return ""


def build_client() -> LLM:
    rpc_url = (os.environ.get("OG_RPC_URL") or DEFAULT_RPC_URL).strip()
    tee_registry_address = (os.environ.get("OG_TEE_REGISTRY_ADDRESS") or DEFAULT_TEE_REGISTRY_ADDRESS).strip()

    return LLM(
        private_key=normalize_private_key(),
        rpc_url=rpc_url,
        tee_registry_address=tee_registry_address,
    )


async def run_chat(payload: dict[str, Any]) -> dict[str, Any]:
    model = normalize_model(payload.get("model"))
    settlement_mode = normalize_settlement_type(payload.get("settlementType"))
    messages = normalize_messages(payload.get("messages"))

    try:
        max_tokens = int(payload.get("maxTokens", 350))
    except (TypeError, ValueError) as error:
        raise ValueError("maxTokens must be an integer.") from error

    client: LLM | None = None

    try:
        client = build_client()
        result = await client.chat(
            model=TEE_LLM(model),
            messages=messages,
            max_tokens=max_tokens,
            x402_settlement_mode=settlement_mode,
        )

        chat_output = result.chat_output or {}
        content = extract_content(chat_output.get("content"))

        if not content:
            raise RuntimeError(
                f"OpenGradient returned an empty assistant message for model '{model}'. "
                "Try anthropic/claude-haiku-4-5 or google/gemini-2.5-flash."
            )

        return {
            "ok": True,
            "content": content,
            "raw": chat_output,
            "usage": None,
            "model": model,
            "settlementType": settlement_mode.value,
            "finishReason": result.finish_reason,
            "teeEndpoint": result.tee_endpoint,
            "teeTimestamp": result.tee_timestamp,
            "teeId": result.tee_id,
            "teePaymentAddress": result.tee_payment_address,
        }
    finally:
        if client is not None:
            await client.close()


async def run_approval(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        min_allowance = float(payload.get("minAllowance", 0.1))
    except (TypeError, ValueError) as error:
        raise ValueError("minAllowance must be a number.") from error

    raw_approve_amount = payload.get("approveAmount", min_allowance)

    try:
        approve_amount = float(raw_approve_amount) if raw_approve_amount is not None else None
    except (TypeError, ValueError) as error:
        raise ValueError("approveAmount must be a number or null.") from error

    client: LLM | None = None

    try:
        client = build_client()
        result = client.ensure_opg_approval(min_allowance=min_allowance, approve_amount=approve_amount)

        return {
            "ok": True,
            "minAllowance": min_allowance,
            "approveAmount": approve_amount,
            "allowanceBefore": str(result.allowance_before),
            "allowanceAfter": str(result.allowance_after),
            "txHash": result.tx_hash,
        }
    finally:
        if client is not None:
            await client.close()


async def run_wallet_status() -> dict[str, Any]:
    client: LLM | None = None

    try:
        client = build_client()
        wallet_address = client._wallet_account.address
        base_sepolia = Web3(Web3.HTTPProvider(BASE_SEPOLIA_RPC))
        owner = Web3.to_checksum_address(wallet_address)
        spender = Web3.to_checksum_address(PERMIT2_ADDRESS)
        opg_token = base_sepolia.eth.contract(
            address=Web3.to_checksum_address(BASE_OPG_ADDRESS),
            abi=ERC20_BALANCE_ABI,
        )

        eth_balance = base_sepolia.from_wei(base_sepolia.eth.get_balance(owner), "ether")
        opg_balance = opg_token.functions.balanceOf(owner).call() / 10**18
        permit2_allowance = opg_token.functions.allowance(owner, spender).call() / 10**18

        return {
            "ok": True,
            "address": wallet_address,
            "ethBalance": f"{eth_balance:.18f}".rstrip("0").rstrip("."),
            "opgBalance": f"{opg_balance:.18f}".rstrip("0").rstrip("."),
            "permit2Allowance": f"{permit2_allowance:.18f}".rstrip("0").rstrip("."),
        }
    finally:
        if client is not None:
            await client.close()


async def main() -> int:
    action = sys.argv[1].strip().lower() if len(sys.argv) > 1 else "chat"
    payload = read_payload()

    if action == "chat":
        emit(await run_chat(payload))
        return 0

    if action == "approve":
        emit(await run_approval(payload))
        return 0

    if action == "wallet":
        emit(await run_wallet_status())
        return 0

    raise ValueError(f"Unsupported bridge action '{action}'. Use 'chat', 'approve', or 'wallet'.")


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except Exception as error:  # pragma: no cover - CLI surface
        raise SystemExit(fail(error))
