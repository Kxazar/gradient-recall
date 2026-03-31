from __future__ import annotations

from .settings import AppConfig
from .supabase_memory import SupabaseMemoryStore

config = AppConfig.from_env()
memory_store = SupabaseMemoryStore(config)


def normalize_history(history):
    if not isinstance(history, list):
        return []

    normalized = []
    for item in history[-8:]:
        if not isinstance(item, dict):
            continue
        content = item.get("content")
        if not isinstance(content, str):
            continue
        content = content.strip()
        if not content:
            continue
        normalized.append(
            {
                "role": "assistant" if item.get("role") == "assistant" else "user",
                "content": content,
            }
        )
    return normalized


def build_system_prompt(memory_search_result):
    base_prompt = [
        "You are Recall, a practical assistant powered by OpenGradient's verified inference.",
        "Be concise, clear, and helpful.",
        "If memories are provided, use them only when relevant.",
        "Treat episodic memories as possibly time-bound and mention uncertainty when needed.",
    ]

    memories = memory_search_result.get("memories", []) if memory_search_result else []

    if not memories:
        return "\n".join(base_prompt)

    memory_lines = [
        f"{index + 1}. {memory.get('memory', '')} [{memory.get('type', 'unknown')}]"
        for index, memory in enumerate(memories)
    ]

    return "\n".join(
        base_prompt
        + [
            "",
            "Known user bio:",
            memory_search_result.get("user_bio", "No bio available."),
            "",
            "Relevant memories:",
            *memory_lines,
        ]
    )
