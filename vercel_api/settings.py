from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_OPEN_GRADIENT_MODEL = "anthropic/claude-haiku-4-5"
DEFAULT_OG_RPC_URL = "https://ogevmdevnet.opengradient.ai"
DEFAULT_TEE_REGISTRY_ADDRESS = "0x4e72238852f3c918f4E4e57AeC9280dDB0c80248"
SUPPORTED_SETTLEMENT_TYPES = {"private", "batch", "individual"}
MODEL_ALIASES = {
    "openai/gpt-4o": "anthropic/claude-haiku-4-5",
    "openai/gpt-4.1": "openai/gpt-4.1-2025-04-14",
}


def normalize_model(model: str | None) -> str:
    raw_model = (model or "").strip()

    if not raw_model:
        return DEFAULT_OPEN_GRADIENT_MODEL

    return MODEL_ALIASES.get(raw_model, raw_model)


def normalize_settlement_type(settlement_type: str | None) -> str:
    normalized = (settlement_type or "").strip().lower()
    return normalized if normalized in SUPPORTED_SETTLEMENT_TYPES else "individual"


@dataclass(slots=True)
class AppConfig:
    model: str
    max_tokens: int
    settlement_type: str
    rpc_url: str
    tee_registry_address: str
    open_gradient_key: str
    session_secret: str
    supabase_url: str
    supabase_key: str
    supabase_user_id: str
    supabase_memory_table: str
    supabase_lookback: int
    supabase_recall_limit: int

    @classmethod
    def from_env(cls) -> "AppConfig":
        return cls(
            model=normalize_model(os.environ.get("OG_MODEL")),
            max_tokens=int(os.environ.get("OG_MAX_TOKENS", "350")),
            settlement_type=normalize_settlement_type(os.environ.get("OG_SETTLEMENT_TYPE")),
            rpc_url=os.environ.get("OG_RPC_URL", DEFAULT_OG_RPC_URL),
            tee_registry_address=os.environ.get("OG_TEE_REGISTRY_ADDRESS", DEFAULT_TEE_REGISTRY_ADDRESS),
            open_gradient_key=os.environ.get("OG_PRIVATE_KEY", ""),
            session_secret=(
                os.environ.get("APP_SESSION_SECRET")
                or os.environ.get("OG_PRIVATE_KEY", "")
                or os.environ.get("SUPABASE_SECRET_KEY")
                or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
                or "recall-chat-dev-secret"
            ),
            supabase_url=os.environ.get("SUPABASE_URL", ""),
            supabase_key=os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
            supabase_user_id=os.environ.get("SUPABASE_USER_ID", "local-demo-user"),
            supabase_memory_table=os.environ.get("SUPABASE_MEMORY_TABLE", "gradient_memories"),
            supabase_lookback=int(os.environ.get("SUPABASE_LOOKBACK", "120")),
            supabase_recall_limit=int(os.environ.get("SUPABASE_RECALL_LIMIT", "5")),
        )
