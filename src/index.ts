import { createOpenAIServer } from "./server.js";
import { loadCredentials } from "./auth.js";

const PORT = Number(process.env.PORT) || 8042;
const HOST = process.env.HOST || "127.0.0.1";

const server = createOpenAIServer();

server.listen(PORT, HOST, () => {
  const loaded = loadCredentials();
  const accountInfo = loaded?.creds?.email
    ? `Logged in as: ${loaded.creds.email}`
    : loaded?.creds?.refresh
      ? "Credentials found"
      : "No credentials found yet (run 'bun run login' or visit /login)";

  console.log(`
┌──────────────────────────────────────────────────────────────┐
│  Google Antigravity OpenAI-Compatible Endpoint               │
├──────────────────────────────────────────────────────────────┤
│  Status:   Running                                           │
│  Base URL: http://${HOST}:${PORT}/v1                              │
│  Account:  ${accountInfo.padEnd(46)} │
├──────────────────────────────────────────────────────────────┤
│  How to use in Jan (https://jan.ai):                         │
│  1. Open Jan Settings -> Model Providers                     │
│  2. Add Custom Provider (OpenAI Compatible)                  │
│  3. Provider Name: Antigravity                               │
│  4. Base URL:      http://localhost:${PORT}/v1                 │
│  5. API Key:       any-dummy-key (e.g. sk-antigravity)       │
│                                                              │
│  Available models include:                                   │
│  - claude-sonnet-4-6 (Claude Sonnet 4.6 Thinking)            │
│  - claude-opus-4-6   (Claude Opus 4.6 Thinking)              │
│  - gemini-3.7-flash  (Gemini 3.7 Flash)                      │
│  - gemini-3.8-flash  (Gemini 3.8 Flash)                      │
│  - gemini-pro        (Gemini 3.1 Pro Agent)                  │
│  - gpt-oss-120b      (GPT-OSS 120B)                          │
└──────────────────────────────────────────────────────────────┘
`);
});

const shutdown = () => {
  console.log("\nShutting down server...");
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
