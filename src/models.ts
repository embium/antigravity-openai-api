export interface ModelDefinition {
  id: string;
  name: string;
  runtimeModel: string;
  maxTokens: number;
  supportsThinking: boolean;
  ownedBy: string;
}

export const PRESET_MODELS: ModelDefinition[] = [
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6 (Antigravity)",
    runtimeModel: "claude-sonnet-4-6",
    maxTokens: 64000,
    supportsThinking: true,
    ownedBy: "anthropic",
  },
  {
    id: "claude-3-7-sonnet",
    name: "Claude 3.7 Sonnet (Alias for 4.6)",
    runtimeModel: "claude-sonnet-4-6",
    maxTokens: 64000,
    supportsThinking: true,
    ownedBy: "anthropic",
  },
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6 (Thinking)",
    runtimeModel: "claude-opus-4-6-thinking",
    maxTokens: 64000,
    supportsThinking: true,
    ownedBy: "anthropic",
  },
  {
    id: "gemini-3.7-flash",
    name: "Gemini 3.7 Flash",
    runtimeModel: "gemini-3.7-flash-medium",
    maxTokens: 65536,
    supportsThinking: true,
    ownedBy: "google",
  },
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    runtimeModel: "gemini-3.8-flash-medium",
    maxTokens: 65536,
    supportsThinking: true,
    ownedBy: "google",
  },
  {
    id: "gemini-3.1-pro",
    name: "Gemini 3.1 Pro",
    runtimeModel: "gemini-pro-agent",
    maxTokens: 65535,
    supportsThinking: true,
    ownedBy: "google",
  },
  {
    id: "gemini-pro",
    name: "Gemini Pro (Alias for 3.1 Pro Agent)",
    runtimeModel: "gemini-pro-agent",
    maxTokens: 65535,
    supportsThinking: true,
    ownedBy: "google",
  },
  {
    id: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash",
    runtimeModel: "gemini-3.6-flash-medium",
    maxTokens: 65536,
    supportsThinking: true,
    ownedBy: "google",
  },
  {
    id: "gpt-oss-120b",
    name: "GPT-OSS 120B",
    runtimeModel: "gpt-oss-120b-medium",
    maxTokens: 32768,
    supportsThinking: true,
    ownedBy: "openai",
  },
  // Runtime specific variants for fine-grained control
  {
    id: "gemini-3.7-flash-low",
    name: "Gemini 3.7 Flash (Low Thinking)",
    runtimeModel: "gemini-3.7-flash-low",
    maxTokens: 65536,
    supportsThinking: true,
    ownedBy: "google",
  },
  {
    id: "gemini-3.7-flash-high",
    name: "Gemini 3.7 Flash (High Thinking)",
    runtimeModel: "gemini-3.7-flash-high",
    maxTokens: 65536,
    supportsThinking: true,
    ownedBy: "google",
  },
  {
    id: "gemini-3.8-flash-low",
    name: "Gemini 3.8 Flash (Low Thinking)",
    runtimeModel: "gemini-3.8-flash-low",
    maxTokens: 65536,
    supportsThinking: true,
    ownedBy: "google",
  },
  {
    id: "gemini-3.8-flash-high",
    name: "Gemini 3.8 Flash (High Thinking)",
    runtimeModel: "gemini-3.8-flash-high",
    maxTokens: 65536,
    supportsThinking: true,
    ownedBy: "google",
  },
  {
    id: "gemini-pro-agent",
    name: "Gemini Pro Agent",
    runtimeModel: "gemini-pro-agent",
    maxTokens: 65535,
    supportsThinking: true,
    ownedBy: "google",
  },
];

/** Model aliases map */
const MODEL_ALIASES: Record<string, string> = {
  "claude-3-7-sonnet": "claude-sonnet-4-6",
  "claude-sonnet": "claude-sonnet-4-6",
  "claude-3.7-sonnet": "claude-sonnet-4-6",
  "claude-3-5-sonnet": "claude-sonnet-4-6",
  "claude-3-opus": "claude-opus-4-6-thinking",
  "claude-opus": "claude-opus-4-6-thinking",
  "gemini-flash": "gemini-3.7-flash-medium",
  "gemini-2.5-flash": "gemini-3.7-flash-medium",
  "gemini-pro": "gemini-pro-agent",
  "gemini-2.5-pro": "gemini-pro-agent",
  "gemini-3.1-pro": "gemini-pro-agent",
  "gemini-3.7-flash": "gemini-3.7-flash-medium",
  "gemini-3.8-flash": "gemini-3.8-flash-medium",
  "gemini-3.6-flash": "gemini-3.6-flash-medium",
  "gpt-oss": "gpt-oss-120b-medium",
  "gpt-oss-120b": "gpt-oss-120b-medium",
};

/** Resolve any requested model ID to the best Antigravity runtime ID */
export function resolveRuntimeModel(requestedId: string): string {
  const normalized = requestedId.trim().toLowerCase();

  // Check aliases
  if (MODEL_ALIASES[normalized]) {
    return MODEL_ALIASES[normalized];
  }

  // Check preset definitions
  const preset = PRESET_MODELS.find((m) => m.id.toLowerCase() === normalized);
  if (preset) return preset.runtimeModel;

  // Direct pass-through if it's already a valid Antigravity model ID
  if (/^(gemini-|claude-|gpt-oss-)/i.test(normalized)) {
    return normalized;
  }

  // Default fallback
  return "claude-sonnet-4-6";
}

/** Get max output tokens for a runtime model */
export function getMaxOutputTokens(runtimeModel: string): number {
  if (runtimeModel.startsWith("claude-")) return 64000;
  if (runtimeModel.startsWith("gpt-oss-")) return 32768;
  if (runtimeModel.startsWith("gemini-3.1-pro") || runtimeModel === "gemini-pro-agent") return 65535;
  if (runtimeModel.startsWith("gemini-")) return 65536;
  return 8192;
}

/** Get thinking configuration for a runtime model */
export function getThinkingConfig(runtimeModel: string, enableThinking = true): any {
  if (!enableThinking) return undefined;

  if (runtimeModel.startsWith("claude-")) {
    return { includeThoughts: true, thinkingBudget: 1024 };
  }
  if (runtimeModel.startsWith("gpt-oss-")) {
    return { includeThoughts: true, thinkingBudget: 8192 };
  }
  if (runtimeModel.startsWith("gemini-3.1-pro") || runtimeModel === "gemini-pro-agent") {
    return { includeThoughts: true, thinkingBudget: 4000 };
  }
  if (runtimeModel.startsWith("gemini-")) {
    if (runtimeModel.endsWith("-high")) return { includeThoughts: true, thinkingBudget: -1 };
    if (runtimeModel.endsWith("-low")) return { includeThoughts: true, thinkingBudget: 1000 };
    return { includeThoughts: true, thinkingBudget: 4000 };
  }
  return undefined;
}

/** Format models in OpenAI /v1/models response format */
export function formatOpenAIModelList(dynamicIds: string[] = []): any {
  const seenIds = new Set<string>();
  const data: any[] = [];

  // Add preset models first
  for (const model of PRESET_MODELS) {
    if (!seenIds.has(model.id)) {
      seenIds.add(model.id);
      data.push({
        id: model.id,
        object: "model",
        created: 1700000000,
        owned_by: model.ownedBy,
        permission: [],
        root: model.id,
        parent: null,
      });
    }
  }

  // Add any discovered dynamic models not yet in the list
  for (const id of dynamicIds) {
    if (!seenIds.has(id) && /^(gemini-|claude-|gpt-oss-)/i.test(id)) {
      seenIds.add(id);
      data.push({
        id,
        object: "model",
        created: 1700000000,
        owned_by: id.startsWith("claude-") ? "anthropic" : id.startsWith("gpt-") ? "openai" : "google",
        permission: [],
        root: id,
        parent: null,
      });
    }
  }

  return {
    object: "list",
    data,
  };
}
