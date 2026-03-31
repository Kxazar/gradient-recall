from __future__ import annotations

import asyncio
import uuid

from flask import Flask, jsonify, request

from vercel_api.auth import (
    create_challenge,
    create_guest_session,
    create_wallet_session_response,
    ensure_session,
    set_session_cookie,
    verify_wallet_signature,
)
from vercel_api.opengradient_runtime import chat as og_chat
from vercel_api.opengradient_runtime import format_payment_error, get_wallet_status
from vercel_api.server_state import build_system_prompt, config, memory_store, normalize_history

app = Flask(__name__, static_folder="public", static_url_path="")


@app.get("/")
def home_route():
    return app.send_static_file("index.html")


@app.get("/api/auth/session")
def auth_session_route():
    session, session_token = ensure_session(request, config)
    response = jsonify(
        {
            "session": session,
            "publicAccess": True,
            "identityMode": "guest-or-wallet",
        }
    )

    if session_token:
        set_session_cookie(response, session_token, request)

    return response


@app.post("/api/auth/challenge")
def auth_challenge_route():
    body = request.get_json(silent=True) or {}
    address = body.get("address", "").strip() if isinstance(body.get("address"), str) else ""

    if not address:
        return jsonify({"error": "Wallet address is required."}), 400

    try:
        return jsonify(create_challenge(address, request.host or "recall-chat.local", config))
    except Exception as error:
        return jsonify({"error": str(error)}), 400


@app.post("/api/auth/verify")
def auth_verify_route():
    body = request.get_json(silent=True) or {}
    address = body.get("address", "").strip() if isinstance(body.get("address"), str) else ""
    signature = body.get("signature", "").strip() if isinstance(body.get("signature"), str) else ""
    challenge_token = body.get("challenge", "").strip() if isinstance(body.get("challenge"), str) else ""

    if not address or not signature or not challenge_token:
        return jsonify({"error": "Address, signature, and challenge are required."}), 400

    try:
        verify_wallet_signature(address, signature, challenge_token, config)
        session, session_token = create_wallet_session_response(address, config)
        response = jsonify({"session": session})
        set_session_cookie(response, session_token, request)
        return response
    except Exception as error:
        return jsonify({"error": str(error)}), 400


@app.post("/api/auth/logout")
def auth_logout_route():
    session, session_token = create_guest_session(config)
    response = jsonify({"session": session})
    set_session_cookie(response, session_token, request)
    return response


@app.get("/api/config")
def config_route():
    session, session_token = ensure_session(request, config)
    wallet_status = get_wallet_status(config) if config.open_gradient_key else None
    response = jsonify(
        {
            "model": config.model,
            "settlementType": config.settlement_type,
            "openGradientRuntime": "python-sdk",
            "pythonExecutable": "vercel-python-runtime",
            "endpointStrategy": "registry-discovery",
            "publicAccess": True,
            "identityMode": "guest-or-wallet",
            "session": session,
            "hasOpenGradientKey": bool(config.open_gradient_key),
            "walletStatus": wallet_status,
            "hasSupabase": memory_store.is_configured(),
            "memoryUserId": session["userId"],
        }
    )

    if session_token:
        set_session_cookie(response, session_token, request)

    return response


@app.get("/api/profile")
def profile_route():
    session, session_token = ensure_session(request, config)

    if not memory_store.is_configured():
        response = jsonify(
            {
                "enabled": False,
                "session": session,
                "user_bio": "",
                "stats": None,
                "insights": [],
                "recent_memories": [],
            }
        )

        if session_token:
            set_session_cookie(response, session_token, request)

        return response

    try:
        profile = memory_store.get_profile(session["userId"])
        response = jsonify({"enabled": True, "session": session, **profile})

        if session_token:
            set_session_cookie(response, session_token, request)

        return response
    except Exception as error:
        return jsonify({"error": str(error)}), 502


@app.post("/api/chat")
def chat_route():
    session, session_token = ensure_session(request, config)

    if not config.open_gradient_key:
        response = jsonify(
            {
                "error": "OG_PRIVATE_KEY is not configured yet. Add it to your Vercel environment before sending chat requests."
            }
        )
        if session_token:
            set_session_cookie(response, session_token, request)
        return response, 500

    body = request.get_json(silent=True) or {}
    message = body.get("message", "").strip() if isinstance(body.get("message"), str) else ""
    thread_id = body.get("threadId", "").strip() if isinstance(body.get("threadId"), str) else ""
    history = normalize_history(body.get("history"))

    if not message:
        response = jsonify({"error": "Message is required."})
        if session_token:
            set_session_cookie(response, session_token, request)
        return response, 400

    if not thread_id:
        thread_id = str(uuid.uuid4())

    memory_search_result = None
    memory_status = "disabled"

    if memory_store.is_configured():
        try:
            memory_search_result = memory_store.search(message, session["userId"])
            memory_status = "ok"
        except Exception as error:
            memory_status = str(error)

    messages = [
        {"role": "system", "content": build_system_prompt(memory_search_result)},
        *history,
        {"role": "user", "content": message},
    ]

    try:
        result = asyncio.run(og_chat(config, messages))

        if memory_store.is_configured():
            try:
                memory_store.store_conversation(
                    thread_id,
                    [
                        {"role": "user", "content": message},
                        {"role": "assistant", "content": result["content"]},
                    ],
                    session["userId"],
                )
            except Exception as error:
                if memory_status == "ok":
                    memory_status = str(error)

        response = jsonify(
            {
                "session": session,
                "threadId": thread_id,
                "answer": result["content"],
                "usage": result.get("usage"),
                "model": result.get("model", config.model),
                "settlementType": result.get("settlementType", config.settlement_type),
                "memoryStatus": memory_status,
                "userBio": memory_search_result.get("user_bio", "") if memory_search_result else "",
                "stats": memory_search_result.get("stats") if memory_search_result else None,
                "insights": memory_search_result.get("insights", []) if memory_search_result else [],
                "memories": memory_search_result.get("memories", []) if memory_search_result else [],
            }
        )

        if session_token:
            set_session_cookie(response, session_token, request)

        return response
    except Exception as error:
        error_message = str(error) or "OpenGradient request failed."

        if "402 Payment Required" in error_message:
            wallet_status = get_wallet_status(config)
            response = jsonify(
                {
                    "error": format_payment_error(error_message, wallet_status),
                    "walletStatus": wallet_status,
                }
            )
            if session_token:
                set_session_cookie(response, session_token, request)
            return response, 402

        response = jsonify({"error": error_message})
        if session_token:
            set_session_cookie(response, session_token, request)
        return response, 502


@app.get("/api/health")
def health_route():
    return jsonify(
        {
            "ok": True,
            "model": config.model,
            "settlementType": config.settlement_type,
        }
    )
