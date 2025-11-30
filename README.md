# Case Study Simulator (Pure Front-End)

A zero-build, static web app that simulates high-stakes business decisions. It works on GitHub Pages and any static host. Supabase login required to use the app; LLM calls use your OpenAI-compatible endpoint in the browser.

## What It Does
- Sign in with Supabase OAuth (Google) via popup; sign out via navbar
- Start new sessions from demo cards; continue/delete past sessions in Profile
- Chat with an AI advisor; optional streaming; Markdown-like layout (basic)
- Configure Base URL, API Key, and model using bootstrap-llm-provider UI
- Persist advanced settings locally via saveform; reset to defaults any time
- Load demo cards and defaults from config.json

## Files
- index.html: single page UI (Bootstrap + Icons + dark theme toggle)
- script.js: all app logic (auth, chat, LLM, sessions, settings, demos)
- config.json: demo definitions and default LLM/system prompt

## Run Locally
- Open index.html in a modern browser. No build, no server required.
- Click Configure LLM and set your OpenAI-compatible Base URL and API key.

## Deploy (GitHub Pages)
- Commit these files to a public repo. Enable Pages (root). Done.

## Supabase Setup (Optional, to persist sessions)
1) Create a project, enable Google OAuth.
2) In Authentication > URL configuration, set your domain in Site URL and redirect URLs.
3) Create tables and RLS policies:

`sql
create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  demo_id text,
  created_at timestamptz default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  role text not null check (role in ('user','ai')),
  content text not null,
  created_at timestamptz default now()
);

alter table public.game_sessions enable row level security;
alter table public.chat_messages enable row level security;

create policy if not exists "manage own sessions"
  on public.game_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy if not exists "manage own messages"
  on public.chat_messages for all
  using (exists (select 1 from public.game_sessions s where s.id = session_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.game_sessions s where s.id = session_id and s.user_id = auth.uid()));
`

4) In script.js, update supabaseUrl and supabaseKey to your project URL and anon public key.

## Linting
We recommend these no-install commands (optional):

- dprint: dprint fmt -c https://raw.githubusercontent.com/sanand0/scripts/refs/heads/main/dprint.jsonc
- oxlint: 
px -y oxlint --fix

## Notes
- This is a pure front-end. Never put server secrets in the client.
- Streaming uses asyncllm. If streaming fails, we fall back to a single response.
- For better Markdown rendering and code blocks, add a client-side renderer later.

## License
MIT (update if needed)