from __future__ import annotations

import re
from typing import Any

import requests

from .settings import AppConfig

TOKEN_PATTERN = re.compile(r"[0-9a-zA-ZА-Яа-яЁё_-]+", re.UNICODE)


def tokenize(text: str) -> list[str]:
    if not text:
        return []

    tokens = {token for token in TOKEN_PATTERN.findall(text.lower()) if len(token) >= 3}
    return sorted(tokens)


def format_relative_timestamp(timestamp: str) -> str:
    if not timestamp:
        return "No activity yet"

    return timestamp.replace("T", " ").replace("+00:00", " UTC")[:20]


def score_row(row: dict[str, Any], tokens: list[str], index: int) -> float:
    haystack = str(row.get("content", "")).lower()
    score = 0.0

    for token in tokens:
      if token in haystack:
          score += 2 if len(token) >= 6 else 1

    if not tokens:
        score += 0.25

    if row.get("role") == "user":
        score += 0.35

    score += max(0, 1.2 - index * 0.03)
    return score


def build_profile(rows: list[dict[str, Any]], total_count: int, user_id: str) -> dict[str, Any]:
    thread_count = len({row.get("thread_id") for row in rows if row.get("thread_id")})
    user_rows = [row for row in rows if row.get("role") == "user"]
    latest_activity = rows[0].get("created_at", "") if rows else ""
    latest_user_note = user_rows[0].get("content", "")[:96] if user_rows else ""

    return {
        "user_bio": (
            f"Cloud memory is enabled for {user_id}. Stored {total_count} messages across {thread_count or 1} "
            f"thread{'' if thread_count == 1 else 's'}."
            if total_count
            else f"Cloud memory is enabled for {user_id}, but nothing has been stored yet."
        ),
        "stats": {
            "storedMessages": total_count,
            "threadsSeen": thread_count,
            "latestActivity": latest_activity,
            "latestUserNote": latest_user_note,
        },
        "insights": [
            f"User ID: {user_id}",
            f"Stored messages: {total_count}",
            f"Threads seen: {thread_count}",
            f"Latest activity: {format_relative_timestamp(latest_activity)}",
            f"Latest user note: {latest_user_note}" if latest_user_note else "Latest user note: none yet",
        ],
    }


class SupabaseMemoryStore:
    def __init__(self, config: AppConfig):
        self.config = config
        self.base_url = f"{config.supabase_url}/rest/v1/{config.supabase_memory_table}" if config.supabase_url else ""

    def _resolve_user_id(self, user_id: str | None = None) -> str:
        return (user_id or self.config.supabase_user_id or "local-demo-user").strip()

    def is_configured(self) -> bool:
        return bool(self.config.supabase_url and self.config.supabase_key)

    def get_user_id(self, user_id: str | None = None) -> str:
        return self._resolve_user_id(user_id)

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers = {
            "apikey": self.config.supabase_key,
            "Authorization": f"Bearer {self.config.supabase_key}",
            "Content-Type": "application/json",
        }
        if extra:
            headers.update(extra)
        return headers

    def _request(self, method: str, params: dict[str, Any] | None = None, json_body: Any = None, headers: dict[str, str] | None = None):
        response = requests.request(
            method,
            self.base_url,
            params=params,
            json=json_body,
            headers=self._headers(headers),
            timeout=30,
        )
        response.raise_for_status()
        return response

    def fetch_recent_rows(self, limit: int, user_id: str | None = None) -> list[dict[str, Any]]:
        if not self.is_configured():
            return []

        resolved_user_id = self._resolve_user_id(user_id)

        response = self._request(
            "GET",
            params={
                "select": "id,thread_id,role,content,created_at",
                "user_id": f"eq.{resolved_user_id}",
                "order": "created_at.desc",
                "limit": str(limit),
            },
        )
        return response.json()

    def fetch_count(self, user_id: str | None = None) -> int:
        if not self.is_configured():
            return 0

        resolved_user_id = self._resolve_user_id(user_id)

        response = self._request(
            "GET",
            params={
                "select": "id",
                "user_id": f"eq.{resolved_user_id}",
                "limit": "1",
            },
            headers={
                "Prefer": "count=exact",
                "Range": "0-0",
            },
        )
        content_range = response.headers.get("content-range", "")

        if "/" not in content_range:
            return 0

        try:
            return int(content_range.split("/")[-1])
        except ValueError:
            return 0

    def search(self, query: str, user_id: str | None = None) -> dict[str, Any]:
        if not self.is_configured():
            return {"user_bio": "", "stats": None, "insights": [], "memories": []}

        resolved_user_id = self._resolve_user_id(user_id)
        rows = self.fetch_recent_rows(self.config.supabase_lookback, resolved_user_id)
        total_count = self.fetch_count(resolved_user_id)
        tokens = tokenize(query)

        ranked = [
            {"row": row, "score": score_row(row, tokens, index)}
            for index, row in enumerate(rows)
        ]
        ranked = [entry for entry in ranked if not tokens or entry["score"] > 1.1]
        ranked.sort(key=lambda entry: entry["score"], reverse=True)

        fallback_ranked = ranked or [
            {"row": row, "score": score_row(row, [], index)}
            for index, row in enumerate(rows)
        ]
        selected = [
            {
                "memory": entry["row"].get("content", ""),
                "type": "conversation_turn",
                "role": entry["row"].get("role"),
                "thread_id": entry["row"].get("thread_id"),
                "created_at": entry["row"].get("created_at"),
                "score": round(entry["score"], 2),
            }
            for entry in fallback_ranked[: self.config.supabase_recall_limit]
        ]

        return {
            **build_profile(rows, total_count, resolved_user_id),
            "memories": selected,
        }

    def store_conversation(self, thread_id: str, messages: list[dict[str, str]], user_id: str | None = None) -> None:
        if not self.is_configured():
            return

        resolved_user_id = self._resolve_user_id(user_id)

        rows = [
            {
                "user_id": resolved_user_id,
                "thread_id": thread_id or "default-thread",
                "role": "assistant" if message.get("role") == "assistant" else "user",
                "content": (message.get("content") or "").strip(),
            }
            for message in messages
            if isinstance(message, dict)
        ]
        rows = [row for row in rows if row["content"]]

        if not rows:
            return

        self._request("POST", json_body=rows, headers={"Prefer": "return=minimal"})

    def get_profile(self, user_id: str | None = None) -> dict[str, Any]:
        resolved_user_id = self._resolve_user_id(user_id)
        rows = self.fetch_recent_rows(12, resolved_user_id)
        total_count = self.fetch_count(resolved_user_id)
        profile = build_profile(rows, total_count, resolved_user_id)
        profile["recent_memories"] = [
            {
                "role": row.get("role"),
                "content": row.get("content"),
                "created_at": row.get("created_at"),
                "thread_id": row.get("thread_id"),
            }
            for row in rows[:5]
        ]
        return profile
