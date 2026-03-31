# Gradient Recall

Gradient Recall is now a more product-shaped site built from the OpenGradient docs. It keeps OpenGradient as the verified LLM provider, uses Supabase as the cloud memory layer, and ships with a Vercel-ready Flask API surface so the site can deploy cleanly without relying on a local `spawn()` bridge.

## Why this architecture

- OpenGradient handles paid, TEE-verified inference over x402.
- Supabase gives us a cheap cloud database with a generous free tier and a simple server-side client.
- The local Node server stays available for fast development.
- Vercel deployment uses a root `app.py` Flask entrypoint plus shared helpers in `vercel_api/`, so the production site does not depend on a local child-process bridge.

## What it does

- Ships a multi-tab product surface: `Overview`, `Studio`, `Memory Atlas`, and `Launch`
- Supports public guest sessions for anyone on the internet and wallet-linked sessions for users who want a private memory lane
- Sends chat requests to `OpenGradient` through the official Python SDK
- Stores conversation turns in `Supabase`
- Recalls relevant recent context from Supabase before each reply
- Exposes the same `/api/auth/session`, `/api/auth/challenge`, `/api/auth/verify`, `/api/auth/logout`, `/api/config`, `/api/profile`, `/api/chat`, and `/api/health` contract in both local dev and Vercel deployment

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

2. Create a local Python environment for the OpenGradient bridge and Vercel Flask app:

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
   - `OG_MODEL`: supported OpenGradient model such as `anthropic/claude-haiku-4-5` or `google/gemini-2.5-flash`
   - `OG_SETTLEMENT_TYPE`: `individual`, `batch`, or `private`
   - `OG_RPC_URL`: defaults to `https://ogevmdevnet.opengradient.ai`
   - `OG_TEE_REGISTRY_ADDRESS`: defaults to the current OpenGradient LLM registry contract
   - `OG_PYTHON_EXECUTABLE`: optional override if you are not using `.venv-og`
   - `APP_SESSION_SECRET`: optional but recommended custom secret for signing guest and wallet session cookies
   - `SUPABASE_URL`: your Supabase project URL
   - `SUPABASE_SECRET_KEY`: preferred server-side secret key
   - `SUPABASE_SERVICE_ROLE_KEY`: optional fallback if you are using the legacy service-role key instead
   - `SUPABASE_USER_ID`: fallback namespace used only if no guest or wallet session is available
   - `SUPABASE_MEMORY_TABLE`: defaults to `gradient_memories`

8. Run the one-time OPG approval check:

   ```powershell
   npm.cmd run og:approve -- 1
   ```

   This only sends a transaction if your Permit2 allowance is still too low. Using `1 OPG` is a safer headroom than `0.1` for repeated tests.

9. Start the app locally:

   ```powershell
   npm.cmd run dev
   ```

10. Open [http://localhost:3000](http://localhost:3000)

## Vercel Deployment

1. Import the repository into Vercel or link it with the CLI.
2. Add these environment variables in Vercel for `Production`, `Preview`, and `Development` as needed:

   - `OG_PRIVATE_KEY`
   - `OG_MODEL`
   - `OG_MAX_TOKENS`
   - `OG_SETTLEMENT_TYPE`
   - `OG_RPC_URL`
   - `OG_TEE_REGISTRY_ADDRESS`
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_USER_ID`
   - `SUPABASE_MEMORY_TABLE`
   - `SUPABASE_LOOKBACK`
   - `SUPABASE_RECALL_LIMIT`

3. Deploy:

   ```powershell
   npm.cmd run deploy:vercel
   ```

4. For Vercel-local development with the same Python API shape:

   ```powershell
   npm.cmd run dev:vercel
   ```

## Project structure

```text
public/
  app.js
  index.html
  styles.css
app.py
vercel_api/
  auth.py
  http_utils.py
  opengradient_runtime.py
  server_state.py
  settings.py
  supabase_memory.py
requirements.txt
scripts/
  ensure-og-approval.mjs
  opengradient_bridge.py
src/
  lib/
    opengradient.js
    session-auth.js
    supabase-memory.js
  server.js
supabase/
  schema.sql
```

## Notes

- OpenGradient remains the LLM provider in this project.
- The local Node server talks to OpenGradient through the official Python SDK bridge.
- Vercel production uses the root Flask app in `app.py`, not the local bridge process.
- Supabase is only used for cloud memory storage and recall.
- The site is intentionally public: anyone can use guest mode immediately, and connected wallets get their own isolated memory scope.
- Supabase keys in this demo are server-side only. Do not expose `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in frontend code.
- Wallet connect uses an injected EVM wallet such as MetaMask or Rabby. The backend verifies a signed challenge before switching the visitor into a wallet-scoped memory lane.
- If your older env still says `openai/gpt-4o`, the app will transparently map it to `anthropic/claude-haiku-4-5`.
- Right now `anthropic/claude-haiku-4-5` and `google/gemini-2.5-flash` are the safest chat defaults for this demo.
- If you hit `402 Payment Required`, run `npm.cmd run og:wallet` first. The most common cause is simply not having enough `OPG` left on Base Sepolia.

## Good next steps

- Add semantic recall with `pgvector`
- Add streaming OpenGradient responses
- Add a memory pinning workflow for important user facts
