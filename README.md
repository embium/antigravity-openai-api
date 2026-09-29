# Google Antigravity OpenAI-Compatible Endpoint

A lightweight, standalone OpenAI-compatible local API server that connects directly to your Google Antigravity account.

This allows you to use your Google Antigravity subscription (Claude Sonnet 4.6, Claude Opus 4.6, Gemini 3.8/3.7/3.6/3.1, GPT-OSS 120B) with chat clients like **Jan**, **Open WebUI**, **LibreChat**, **Continue**, **Cursor**, **Cline**, or any OpenAI-compatible application.

---

## Features

- **Zero Heavy Dependencies**: Built with native Node.js / Bun standard modules and standard `fetch`.
- **Automatic Authentication & Refresh**:
  - Automatically reuses your existing Pi login credentials from `~/.pi/agent/auth.json` if available.
  - Automatically refreshes expired OAuth access tokens in the background.
  - Includes an interactive login flow (`bun run login`) for standalone setup.
- **Full OpenAI Compatibility**:
  - `GET /v1/models` - Lists all available Antigravity models dynamically from Google.
  - `POST /v1/chat/completions` - Handles both streaming (`stream: true` via SSE) and non-streaming responses.
  - Reasoning / Thinking: Emits `delta.reasoning_content` so Jan displays live collapsible thinking blocks.
  - Multimodal: Supports image attachments via base64 data URLs.
  - Tool Calling: Converts OpenAI function calling to Antigravity tools.
- **CORS Enabled**: Works seamlessly with browser-based web UIs.

---

## Quick Start

### 1. Start the Server

Using **Bun** (recommended):
```bash
cd endpoint
bun run start
```

Or using **Node.js**:
```bash
cd endpoint
npm run build
node dist/index.js
```

By default, the server runs at:
```
http://127.0.0.1:8042/v1
```

### 2. Login (If not already logged into Pi)

If you have already logged into Antigravity in Pi (`/login antigravity`), **no action is required** — your credentials will be discovered and refreshed automatically!

To log in from scratch:
```bash
bun run login
```
This opens your browser to authenticate with Google, captures the OAuth token, and saves it locally. You can also trigger login by visiting `http://localhost:8042/login` in your browser.

---

## Configuring Chat Clients

### Jan (https://jan.ai)

1. Open **Jan** and click the **Gear (Settings)** icon in the bottom left.
2. In the sidebar, select **Model Providers**.
3. Scroll down and click **Add Provider** (or select OpenAI-compatible custom provider).
4. Enter the following details:
   - **Provider Name**: `Antigravity`
   - **Base URL**: `http://127.0.0.1:8042/v1`
   - **API Key**: `sk-antigravity` *(any dummy key works)*
5. Click **Save**.
6. When starting a chat, pick any Antigravity model from the dropdown (or type one below).

---

## Supported Models

You can use standard Antigravity model names or convenient aliases:

| Model ID | Details | Thinking / Reasoning |
| :--- | :--- | :--- |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | Supported |
| `claude-3-7-sonnet` | Alias for Claude Sonnet 4.6 | Supported |
| `claude-opus-4-6` | Claude Opus 4.6 | Supported |
| `gemini-3.7-flash` | Gemini 3.7 Flash | Supported |
| `gemini-3.8-flash` | Gemini 3.8 Flash | Supported |
| `gemini-3.6-flash` | Gemini 3.6 Flash | Supported |
| `gemini-pro` | Gemini 3.1 Pro Agent | Supported |
| `gpt-oss-120b` | GPT-OSS 120B | Supported |

You can also use fine-grained runtime IDs directly, such as:
- `gemini-3.7-flash-high`
- `gemini-3.7-flash-medium`
- `gemini-3.7-flash-low`
- `gemini-3.8-flash-low`
- `gemini-3.8-flash-high`
- `gemini-pro-agent`

---

## Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `8042` | Port for the HTTP server |
| `HOST` | `127.0.0.1` | Host address to bind to |
| `ANTIGRAVITY_REFRESH_TOKEN` | *(auto-detected)* | Custom Google OAuth refresh token |
| `ANTIGRAVITY_PROJECT_ID` | `aicode-consumers` | Cloud Code Assist project ID |

---

## Verifying with curl

Test that the endpoint is running:
```bash
curl http://127.0.0.1:8042/health
```

List models:
```bash
curl http://127.0.0.1:8042/v1/models
```

Send a test chat completion:
```bash
curl http://127.0.0.1:8042/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [
      {"role": "user", "content": "Say hello!"}
    ]
  }'
```
