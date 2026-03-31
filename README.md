# Gradient Recall

Gradient Recall is a lightweight demo project built from the OpenGradient docs. It keeps OpenGradient as the verified LLM provider and uses Supabase as the cloud memory layer.

## Why this architecture

- OpenGradient handles paid, TEE-verified inference over x402.
- Supabase gives us a cheap cloud database with a generous free tier and a simple JavaScript client.
- This keeps the core OpenGradient flow intact while replacing the paid MemSync dependency with a cloud store you control.

## What it does

- Sends chat requests to `OpenGradient` via x402
- Stores conversation turns in `Supabase`
- Recalls relevant recent context from Supabase before each reply
- Shows cloud-memory status, usage hints, and recalled context in a small local UI

## Prerequisites

1. Node.js 24 or newer
2. A Base Sepolia wallet private key
3. Base Sepolia ETH for gas
4. `$OPG` testnet tokens from the OpenGradient faucet
5. A Supabase project

Useful docs:

- [OpenGradient x402 overview](https://docs.opengradient.ai/developers/x402/)
- [OpenGradient x402 examples](https://docs.opengradient.ai/developers/x402/examples.html)
- [Supabase JavaScript client](https://supabase.com/docs/reference/javascript/initializing)
- [Supabase API keys](https://supabase.com/docs/guides/api/api-keys)

## Setup

1. Install dependencies:

   ```powershell
   npm.cmd install
   ```

2. Create a Supabase project.

3. Open the Supabase SQL Editor and run the schema from [supabase/schema.sql](/C:/Users/alexe/Downloads/OpenGradient/supabase/schema.sql).

4. Copy your credentials from Supabase:

   - `Project URL`
   - `secret` key or `service_role` key from `Settings > API Keys`

5. Create a local env file:

   ```powershell
   Copy-Item .env.example .env
   ```

6. Fill in `.env`:

   - `OG_PRIVATE_KEY`: private key for the Base Sepolia wallet that will pay for inference
   - `OG_MODEL`: supported OpenGradient model such as `openai/gpt-4o`
   - `OG_SETTLEMENT_TYPE`: `individual`, `batch`, or `private`
   - `OG_API_BASE_URL`: defaults to `https://llm.opengradient.ai`
   - `SUPABASE_URL`: your Supabase project URL
   - `SUPABASE_SECRET_KEY`: preferred server-side secret key
   - `SUPABASE_SERVICE_ROLE_KEY`: optional fallback if you are using the legacy service-role key instead
   - `SUPABASE_USER_ID`: logical user namespace for saved memories
   - `SUPABASE_MEMORY_TABLE`: defaults to `gradient_memories`

7. Start the app:

   ```powershell
   npm.cmd run dev
   ```

8. Open [http://localhost:3000](http://localhost:3000)

## Project structure

```text
public/
  app.js
  index.html
  styles.css
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
- Supabase is only used for cloud memory storage and recall.
- Supabase keys in this demo are server-side only. Do not expose `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in frontend code.

## Good next steps

- Add semantic recall with `pgvector`
- Add authenticated multi-user memory instead of a fixed `SUPABASE_USER_ID`
- Add streaming OpenGradient responses
- Add a memory pinning workflow for important user facts
