import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import * as crypto from "node:crypto";
import { getValidAuth, performOAuthLogin } from "./auth.js";
import { fetchAvailableModels, streamGenerateContent } from "./client.js";
import { formatOpenAIModelList, resolveRuntimeModel } from "./models.js";
import { translateRequest, type OpenAIChatRequest } from "./translator.js";

const DEFAULT_PORT = 8042;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept",
};

let cachedDynamicModels: { models: string[]; expiresAt: number } | null = null;

async function getCachedDynamicModels(token: string, projectId: string): Promise<string[]> {
  if (cachedDynamicModels && cachedDynamicModels.expiresAt > Date.now()) {
    return cachedDynamicModels.models;
  }
  try {
    const models = await fetchAvailableModels(token, projectId);
    cachedDynamicModels = {
      models,
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
    return models;
  } catch {
    return [];
  }
}

function sendJson(res: ServerResponse, status: number, data: any): void {
  const json = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...CORS_HEADERS,
  });
  res.end(json);
}

function sendOpenAIError(res: ServerResponse, status: number, message: string, type = "invalid_request_error"): void {
  sendJson(res, status, {
    error: {
      message,
      type,
      code: status,
    },
  });
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf-8");
      if (body.length > 20 * 1024 * 1024) {
        reject(new Error("Request body too large (max 20MB)"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error("Malformed JSON in request body"));
      }
    });
    req.on("error", reject);
  });
}

export function createOpenAIServer(): import("node:http").Server {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    // 1. CORS Preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    // 2. Health & Info Endpoints
    if (req.method === "GET" && (pathname === "" || pathname === "/" || pathname === "/health")) {
      sendJson(res, 200, {
        status: "ok",
        service: "Google Antigravity OpenAI Endpoint",
        models_url: `${url.origin}/v1/models`,
        chat_url: `${url.origin}/v1/chat/completions`,
        instructions: {
          jan: {
            provider: "Custom (OpenAI-Compatible)",
            baseUrl: `${url.origin}/v1`,
            apiKey: "dummy-key-not-needed",
          },
        },
      });
      return;
    }

    // 3. Optional browser login trigger: /login
    if (req.method === "GET" && pathname === "/login") {
      try {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...CORS_HEADERS });
        res.write("<h2>Starting Google Antigravity OAuth Login...</h2><p>Check your browser and terminal.</p>");
        performOAuthLogin()
          .then((creds) => {
            res.end(`<p style="color: green;"><b>Login successful! Logged in as ${creds.email || "Google Account"}.</b> You can now use Jan.</p>`);
          })
          .catch((err) => {
            res.end(`<p style="color: red;"><b>Login failed:</b> ${err.message}</p>`);
          });
      } catch (err: any) {
        sendOpenAIError(res, 500, err.message);
      }
      return;
    }

    // 4. Models Listing: GET /v1/models or GET /models
    if (req.method === "GET" && (pathname === "/v1/models" || pathname === "/models")) {
      try {
        let dynamicIds: string[] = [];
        try {
          const auth = await getValidAuth();
          dynamicIds = await getCachedDynamicModels(auth.accessToken, auth.projectId);
        } catch {
          // If auth isn't configured yet, still return preset models
        }
        const modelList = formatOpenAIModelList(dynamicIds);
        sendJson(res, 200, modelList);
      } catch (err: any) {
        sendOpenAIError(res, 500, err.message);
      }
      return;
    }

    // 5. Single Model Details: GET /v1/models/:model or GET /models/:model
    const modelMatch = pathname.match(/^\/(?:v1\/)?models\/([^/]+)$/);
    if (req.method === "GET" && modelMatch) {
      const modelId = decodeURIComponent(modelMatch[1]);
      sendJson(res, 200, {
        id: modelId,
        object: "model",
        created: 1700000000,
        owned_by: "google-antigravity",
        permission: [],
        root: modelId,
        parent: null,
      });
      return;
    }

    // 6. Chat Completions: POST /v1/chat/completions or POST /chat/completions
    if (
      req.method === "POST" &&
      (pathname === "/v1/chat/completions" || pathname === "/chat/completions")
    ) {
      let openAIReq: OpenAIChatRequest;
      try {
        openAIReq = await readJsonBody(req);
      } catch (err: any) {
        sendOpenAIError(res, 400, err.message);
        return;
      }

      if (!openAIReq.messages || !Array.isArray(openAIReq.messages) || openAIReq.messages.length === 0) {
        sendOpenAIError(res, 400, "Missing or invalid 'messages' array in request body");
        return;
      }

      if (!openAIReq.model) {
        sendOpenAIError(res, 400, "Missing 'model' string in request body");
        return;
      }

      // Authenticate
      let auth: { accessToken: string; projectId: string };
      try {
        auth = await getValidAuth();
      } catch (err: any) {
        sendOpenAIError(
          res,
          401,
          `Authentication failed: ${err.message}. Please login via 'bun run login' or visit http://localhost:${DEFAULT_PORT}/login`,
          "authentication_error",
        );
        return;
      }

      const stream = Boolean(openAIReq.stream);
      const completionId = `chatcmpl-${crypto.randomUUID()}`;
      const created = Math.floor(Date.now() / 1000);

      // Translate request to Antigravity format
      const { runtimeModel, contents, systemInstruction, generationConfig, tools } =
        translateRequest(openAIReq);

      const abortController = new AbortController();
      req.on("close", () => {
        if (!res.writableEnded) abortController.abort();
      });

      let agyRes: Response;
      try {
        agyRes = await streamGenerateContent({
          token: auth.accessToken,
          projectId: auth.projectId,
          model: runtimeModel,
          contents,
          systemInstruction,
          generationConfig,
          tools,
          signal: abortController.signal,
        });
      } catch (err: any) {
        sendOpenAIError(res, 502, err.message, "api_error");
        return;
      }

      if (!agyRes.body) {
        sendOpenAIError(res, 502, "No response body received from Antigravity API");
        return;
      }

      const reader = agyRes.body.getReader();
      const decoder = new TextDecoder();

      if (stream) {
        // SSE STREAMING MODE
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          ...CORS_HEADERS,
        });

        // First chunk sends role: "assistant"
        const firstChunk = {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model: openAIReq.model,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "" },
              finish_reason: null,
            },
          ],
        };
        res.write(`data: ${JSON.stringify(firstChunk)}\n\n`);

        let buffer = "";
        let finishReason = "stop";
        let usage: any = null;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const jsonStr = trimmed.slice(5).trim();
              if (!jsonStr || jsonStr === "[DONE]") continue;

              let chunkData: any;
              try {
                chunkData = JSON.parse(jsonStr);
              } catch {
                continue;
              }

              if (chunkData.error) {
                const errChunk = {
                  error: {
                    message: chunkData.error.message || "Antigravity streaming error",
                    type: "api_error",
                  },
                };
                res.write(`data: ${JSON.stringify(errChunk)}\n\n`);
                continue;
              }

              const responseData = chunkData.response || chunkData;
              const candidate = responseData.candidates?.[0];

              if (candidate?.finishReason) {
                const fr = candidate.finishReason;
                finishReason = fr === "MAX_TOKENS" ? "length" : "stop";
              }

              if (responseData.usageMetadata) {
                usage = {
                  prompt_tokens: responseData.usageMetadata.promptTokenCount || 0,
                  completion_tokens:
                    (responseData.usageMetadata.candidatesTokenCount || 0) +
                    (responseData.usageMetadata.thoughtsTokenCount || 0),
                  total_tokens: responseData.usageMetadata.totalTokenCount || 0,
                };
              }

              for (const part of candidate?.content?.parts || []) {
                // Reasoning / Thinking Delta
                if (part.thought && part.text) {
                  const sseChunk = {
                    id: completionId,
                    object: "chat.completion.chunk",
                    created,
                    model: openAIReq.model,
                    choices: [
                      {
                        index: 0,
                        delta: {
                          reasoning_content: part.text,
                        },
                        finish_reason: null,
                      },
                    ],
                  };
                  res.write(`data: ${JSON.stringify(sseChunk)}\n\n`);
                }
                // Content Delta
                else if (part.text && !part.thought) {
                  const sseChunk = {
                    id: completionId,
                    object: "chat.completion.chunk",
                    created,
                    model: openAIReq.model,
                    choices: [
                      {
                        index: 0,
                        delta: {
                          content: part.text,
                        },
                        finish_reason: null,
                      },
                    ],
                  };
                  res.write(`data: ${JSON.stringify(sseChunk)}\n\n`);
                }
                // Function Call Delta
                else if (part.functionCall) {
                  finishReason = "tool_calls";
                  const sseChunk = {
                    id: completionId,
                    object: "chat.completion.chunk",
                    created,
                    model: openAIReq.model,
                    choices: [
                      {
                        index: 0,
                        delta: {
                          tool_calls: [
                            {
                              index: 0,
                              id: part.functionCall.id || `call_${crypto.randomUUID().slice(0, 8)}`,
                              type: "function",
                              function: {
                                name: part.functionCall.name,
                                arguments: JSON.stringify(part.functionCall.args || {}),
                              },
                            },
                          ],
                        },
                        finish_reason: null,
                      },
                    ],
                  };
                  res.write(`data: ${JSON.stringify(sseChunk)}\n\n`);
                }
              }
            }
          }

          // Final chunk with finish_reason
          const finalChunk: any = {
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model: openAIReq.model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: finishReason,
              },
            ],
          };
          if (usage) finalChunk.usage = usage;

          res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
        } catch (err: any) {
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
            res.end();
          }
        }
      } else {
        // NON-STREAMING MODE
        let buffer = "";
        let fullContent = "";
        let fullReasoning = "";
        const toolCalls: any[] = [];
        let finishReason = "stop";
        let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const jsonStr = trimmed.slice(5).trim();
              if (!jsonStr || jsonStr === "[DONE]") continue;

              let chunkData: any;
              try {
                chunkData = JSON.parse(jsonStr);
              } catch {
                continue;
              }

              const responseData = chunkData.response || chunkData;
              const candidate = responseData.candidates?.[0];

              if (candidate?.finishReason) {
                const fr = candidate.finishReason;
                finishReason = fr === "MAX_TOKENS" ? "length" : "stop";
              }

              if (responseData.usageMetadata) {
                usage = {
                  prompt_tokens: responseData.usageMetadata.promptTokenCount || 0,
                  completion_tokens:
                    (responseData.usageMetadata.candidatesTokenCount || 0) +
                    (responseData.usageMetadata.thoughtsTokenCount || 0),
                  total_tokens: responseData.usageMetadata.totalTokenCount || 0,
                };
              }

              for (const part of candidate?.content?.parts || []) {
                if (part.thought && part.text) {
                  fullReasoning += part.text;
                } else if (part.text && !part.thought) {
                  fullContent += part.text;
                } else if (part.functionCall) {
                  finishReason = "tool_calls";
                  toolCalls.push({
                    id: part.functionCall.id || `call_${crypto.randomUUID().slice(0, 8)}`,
                    type: "function",
                    function: {
                      name: part.functionCall.name,
                      arguments: JSON.stringify(part.functionCall.args || {}),
                    },
                  });
                }
              }
            }
          }

          const messageResponse: any = {
            role: "assistant",
            content: fullContent,
          };

          if (fullReasoning) {
            messageResponse.reasoning_content = fullReasoning;
          }
          if (toolCalls.length > 0) {
            messageResponse.tool_calls = toolCalls;
          }

          sendJson(res, 200, {
            id: completionId,
            object: "chat.completion",
            created,
            model: openAIReq.model,
            choices: [
              {
                index: 0,
                message: messageResponse,
                finish_reason: finishReason,
              },
            ],
            usage,
          });
        } catch (err: any) {
          sendOpenAIError(res, 502, err.message);
        }
      }
      return;
    }

    // 404 for any other path
    sendOpenAIError(res, 404, `Route ${req.method} ${pathname} not found`);
  });
}
