# Gradient Recall

Gradient Recall is a lightweight demo project built from the OpenGradient docs. It keeps OpenGradient as the verified LLM provider, now through the official Python SDK bridge, and uses Supabase as the cloud memory layer.

## Why this architecture

- OpenGradient handles paid, TEE-verified inference over x402.
- The Node app calls the official Python SDK, which currently works more reliably than the stale JS hostname path.
- Supabase gives us a cheap cloud database with a generous free tier and a simple server-side client.
- This keeps the core OpenGradient flow intact while replacing the paid MemSync dependency with a cloud store you control.

## What it does

- Sends chat requests to `OpenGradient` through the official Python SDK
- Stores conversation turns in `Supabase`
- Recalls relevant recent context from Supabase before each reply
- Shows cloud-memory status, usage hints, and recalled context in a small local UI

## Prerequisites

1. Node.js 22 or newer
2. Python 3.11 or newer
3. A Base Sepolia wallet private key
4. Base Sepolia ETH for gas
5. `$OPG` testnet tokens from the OpenGradient faucet
6. A Supabase project

Useful docs:

- [OpenGradient x402 overview](https://docs.opengradient.ai/developers/x402/)
- [OpenGradient Python SDK](https://pypi.org/project/opengradient/)
- [Supabase JavaScript client](https://supabase.com/docs/reference/javascript/initializing)
- [Supabase API keys](https://supabase.com/docs/guides/api/api-keys)

## Setup

1. Install dependencies:

   ```powershell
   npm.cmd install
   ```

2. Create a local Python environment for the OpenGradient bridge:

   ```powershell
   py -3.11 -m venv .venv-og
   .\.venv-og\Scripts\python.exe -m pip install --upgrade pip
   .\.venv-og\Scripts\python.exe -m pip install opengradient==0.9.4
   ```

3. Create a Supabase project.

4. Open the Supabase SQL Editor and run the schema from [supabase/schema.sql](/C:/Users/alexe/Downloads/OpenGradient/supabase/schema.sql).

5. Copy your credentials from Supabase:

   - `Project URL`
   - `secret` key or `service_role` key from `Settings > API Keys`

6. Create a local env file:

   ```powershell
   Copy-Item .env.example .env
   ```

7. Fill in `.env`:

   - `OG_PRIVATE_KEY`: private key for the Base Sepolia wallet that will pay for inference
   - `OG_MODEL`: supported OpenGradient model such as `anthropic/claude-haiku-4-5` or `openai/gpt-5-mini`
   - `OG_SETTLEMENT_TYPE`: `individual`, `batch`, or `private`
   - `OG_RPC_URL`: defaults to `https://ogevmdevnet.opengradient.ai`
   - `OG_TEE_REGISTRY_ADDRESS`: defaults to the current OpenGradient LLM registry contract
   - `OG_PYTHON_EXECUTABLE`: optional override if you are not using `.venv-og`
   - `SUPABASE_URL`: your Supabase project URL
   - `SUPABASE_SECRET_KEY`: preferred server-side secret key
   - `SUPABASE_SERVICE_ROLE_KEY`: optional fallback if you are using the legacy service-role key instead
   - `SUPABASE_USER_ID`: logical user namespace for saved memories
   - `SUPABASE_MEMORY_TABLE`: defaults to `gradient_memories`

8. Run the one-time OPG approval check:

   ```powershell
   npm.cmd run og:approve -- 1
   ```

   This only sends a transaction if your Permit2 allowance is still too low. Using `1 OPG` is a safer headroom than `0.1` for repeated tests.

9. Start the app:

   ```powershell
   npm.cmd run dev
   ```

10. Open [http://localhost:3000](http://localhost:3000)

## Project structure

```text
public/
  app.js
  index.html
  styles.css
scripts/
  ensure-og-approval.mjs
  opengradient_bridge.py
src/
  lib/
    opengradient.js
    supabase-memory.js
  server.js
supabase/
  schema.sql
```

## Notes

- OpenGradient remains the LLM provider in this project.
- The Node server talks to OpenGradient through the official Python SDK bridge.
- Supabase is only used for cloud memory storage and recall.
- Supabase keys in this demo are server-side only. Do not expose `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in frontend code.
- If your older env still says `openai/gpt-4o`, the app will transparently map it to `openai/gpt-5-mini`.
- If you hit `402 Payment Required`, run `npm.cmd run og:wallet` first. The most common cause is simply not having enough `OPG` left on Base Sepolia.

## Good next steps

- Add semantic recall with `pgvector`
- Add authenticated multi-user memory instead of a fixed `SUPABASE_USER_ID`
- Add streaming OpenGradient responses
- Add a memory pinning workflow for important user facts
