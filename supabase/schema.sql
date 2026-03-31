create table if not exists public.gradient_memories (
  id bigint generated always as identity primary key,
  user_id text not null,
  thread_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists gradient_memories_user_created_idx
  on public.gradient_memories (user_id, created_at desc);

create index if not exists gradient_memories_thread_created_idx
  on public.gradient_memories (thread_id, created_at desc);
