import { getMaxOutputTokens, getThinkingConfig, resolveRuntimeModel } from "./models.js";

export interface OpenAIMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content?: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  top_p?: number;
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description?: string;
      parameters?: any;
    };
  }>;
  tool_choice?: any;
  stop?: string | string[];
}

export interface GeminiPart {
  text?: string;
  thought?: boolean;
  inlineData?: {
    mimeType: string;
    data: string;
  };
  functionCall?: {
    name: string;
    args: Record<string, any>;
    id?: string;
  };
  functionResponse?: {
    name: string;
    response: Record<string, any>;
    id?: string;
  };
}

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const match = url.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    data: match[2],
  };
}

function normalizeSchema(schema: any): any {
  if (!schema || typeof schema !== "object") return { type: "OBJECT" };
  const copy = { ...schema };
  delete copy.$schema;
  delete copy.title;
  delete copy.default;

  if (copy.type && typeof copy.type === "string") {
    copy.type = copy.type.toUpperCase();
  } else if (!copy.type && copy.properties) {
    copy.type = "OBJECT";
  }

  if (copy.properties && typeof copy.properties === "object") {
    const props: Record<string, any> = {};
    for (const [key, val] of Object.entries(copy.properties)) {
      props[key] = normalizeSchema(val);
    }
    copy.properties = props;
  }

  if (copy.items) {
    copy.items = normalizeSchema(copy.items);
  }

  return copy;
}

function sanitizeToolCallId(id?: string, fallbackName?: string): string {
  if (!id) return `${fallbackName || "call"}_${Date.now()}`;
  const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return cleaned || `${fallbackName || "call"}_${Date.now()}`;
}

/**
 * Ensure the response field of functionResponse is ALWAYS a valid JSON object/dict (google.protobuf.Struct).
 * If the tool returns an array, string, number, boolean, or null, it must be wrapped in `{ output: ... }`.
 * Passing a raw Array causes: Proto field is not repeating, cannot start list.
 */
function toStructObject(content: unknown): Record<string, any> {
  if (content === null || content === undefined) {
    return { output: "" };
  }
  if (typeof content === "string") {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
      return { output: parsed };
    } catch {
      return { output: content };
    }
  }
  if (typeof content === "object" && !Array.isArray(content)) {
    return content as Record<string, any>;
  }
  return { output: content };
}

/** Translate OpenAI chat request to Antigravity Gemini request */
export function translateRequest(openAIReq: OpenAIChatRequest): {
  runtimeModel: string;
  contents: GeminiContent[];
  systemInstruction?: { role: "user"; parts: Array<{ text: string }> };
  generationConfig: Record<string, any>;
  tools?: any[];
} {
  const runtimeModel = resolveRuntimeModel(openAIReq.model);
  const isGemini = runtimeModel.startsWith("gemini-");

  // Map tool call IDs to function names from prior assistant turns
  const toolCallIdToName = new Map<string, string>();
  for (const msg of openAIReq.messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.id && tc.function?.name) {
          toolCallIdToName.set(tc.id, tc.function.name);
        }
      }
    }
  }

  // 1. Extract System Prompt
  const systemTexts: string[] = [];
  const nonSystemMessages: OpenAIMessage[] = [];

  for (const msg of openAIReq.messages) {
    if (msg.role === "system" || msg.role === "developer") {
      if (typeof msg.content === "string" && msg.content.trim()) {
        systemTexts.push(msg.content.trim());
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text" && part.text?.trim()) {
            systemTexts.push(part.text.trim());
          }
        }
      }
    } else {
      nonSystemMessages.push(msg);
    }
  }

  let systemInstruction: { role: "user"; parts: Array<{ text: string }> } | undefined;
  if (systemTexts.length > 0) {
    systemInstruction = {
      role: "user",
      parts: systemTexts.map((text) => ({ text })),
    };
  }

  // 2. Convert Messages to Gemini Contents
  const rawContents: GeminiContent[] = [];

  for (const msg of nonSystemMessages) {
    const parts: GeminiPart[] = [];

    // Parse content for user / assistant messages (tool messages have their content handled under tool response below)
    if (msg.role !== "tool") {
      if (typeof msg.content === "string" && msg.content.length > 0) {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const item of msg.content) {
          if (item.type === "text" && item.text) {
            parts.push({ text: item.text });
          } else if (item.type === "image_url" && item.image_url?.url) {
            const parsed = parseDataUrl(item.image_url.url);
            if (parsed) {
              parts.push({
                inlineData: parsed,
              });
            }
          }
        }
      }
    }

    // Parse assistant tool calls
    if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        let args: Record<string, any> = {};
        try {
          args = typeof tc.function.arguments === "string"
            ? JSON.parse(tc.function.arguments || "{}")
            : (tc.function.arguments || {});
        } catch {}

        if (isGemini) {
          // Gemini 3+ requires thought_signature on prior functionCall turns.
          // Standard OpenAI clients don't carry thought signatures, so convert
          // prior tool calls to descriptive text turns to avoid Antigravity 400.
          parts.push({
            text: `[Called tool \`${tc.function.name}\` with arguments: ${JSON.stringify(args)}]`,
          });
        } else {
          // Claude & GPT-OSS support native functionCall turns with id
          parts.push({
            functionCall: {
              name: tc.function.name,
              args,
              id: sanitizeToolCallId(tc.id, tc.function.name),
            },
          });
        }
      }
    }

    // Parse tool response
    if (msg.role === "tool") {
      const toolName =
        msg.name ||
        (msg.tool_call_id ? toolCallIdToName.get(msg.tool_call_id) : undefined) ||
        "tool";

      if (isGemini) {
        // Paired with Gemini text observation bridge
        const responseText =
          typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");
        parts.push({
          text: `[Observation from \`${toolName}\`:\n${responseText}]`,
        });
      } else {
        // Claude & GPT-OSS native functionResponse
        const responseStruct = toStructObject(msg.content);
        parts.push({
          functionResponse: {
            name: toolName,
            response: responseStruct,
            id: sanitizeToolCallId(msg.tool_call_id, toolName),
          },
        });
      }
    }

    if (parts.length === 0) continue;

    const geminiRole = msg.role === "assistant" ? "model" : "user";
    rawContents.push({
      role: geminiRole,
      parts,
    });
  }

  // 3. Normalize Turn Alternation (Gemini requires alternating user/model)
  const contents: GeminiContent[] = [];

  for (const turn of rawContents) {
    if (contents.length === 0) {
      // First turn MUST be user
      if (turn.role !== "user") {
        contents.push({
          role: "user",
          parts: [{ text: "Hello" }],
        });
      }
      contents.push({ ...turn });
    } else {
      const prev = contents[contents.length - 1];
      if (prev.role === turn.role) {
        // Merge adjacent same-role turns
        prev.parts.push(...turn.parts);
      } else {
        contents.push({ ...turn });
      }
    }
  }

  // Google Antigravity requires at least one user text part in the request.
  // If the conversation only contains functionResponses, add a continuation text part.
  const hasUserText = contents.some(
    (turn) =>
      turn.role === "user" &&
      turn.parts.some((part) => typeof part.text === "string" && Boolean(part.text.trim())),
  );
  if (!hasUserText) {
    const userTurn = contents.find((t) => t.role === "user");
    if (userTurn) {
      userTurn.parts.push({ text: "Apply the tool results and continue the active task." });
    } else {
      contents.unshift({
        role: "user",
        parts: [{ text: "Apply the tool results and continue the active task." }],
      });
    }
  }

  // 4. Generation Config
  const generationConfig: Record<string, any> = {};

  if (openAIReq.temperature !== undefined) {
    generationConfig.temperature = openAIReq.temperature;
  }

  const maxTokens = openAIReq.max_tokens ?? openAIReq.max_completion_tokens;
  const maxAllowed = getMaxOutputTokens(runtimeModel);
  if (maxTokens !== undefined) {
    generationConfig.maxOutputTokens = Math.min(maxTokens, maxAllowed);
  } else {
    generationConfig.maxOutputTokens = maxAllowed;
  }

  if (openAIReq.stop) {
    generationConfig.stopSequences = Array.isArray(openAIReq.stop)
      ? openAIReq.stop
      : [openAIReq.stop];
  }

  const thinking = getThinkingConfig(runtimeModel);
  if (thinking) {
    generationConfig.thinkingConfig = thinking;
  }

  // 5. Tools Translation (only if client passed active tools)
  let tools: any[] | undefined;
  if (openAIReq.tools && openAIReq.tools.length > 0) {
    const declarations = openAIReq.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description || "",
      parameters: normalizeSchema(t.function.parameters),
    }));
    tools = [{ functionDeclarations: declarations }];
  }

  return {
    runtimeModel,
    contents,
    systemInstruction,
    generationConfig,
    tools,
  };
}
