import * as crypto from "node:crypto";

export const DEFAULT_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
export const ENDPOINT_FALLBACKS = [
  DEFAULT_ENDPOINT,
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
  "https://cloudcode-pa.googleapis.com",
];

const DEFAULT_USER_AGENT =
  "antigravity/cli/1.1.23 (aidev_client; os_type=linux; arch=amd64; cl=974125021; auth_method=consumer)";

export function antigravityHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": process.env.ANTIGRAVITY_USER_AGENT || DEFAULT_USER_AGENT,
  };
}

export function buildEnvelope(
  runtimeModel: string,
  stepCount = 1,
): {
  requestId: string;
  sessionId: string;
  labels: Record<string, string>;
} {
  const isClaude = runtimeModel.startsWith("claude-");
  const isNonGemini = isClaude || runtimeModel.startsWith("gpt-oss-");
  const agentId = crypto.randomUUID();
  const trajectoryId = crypto.randomUUID();
  const step = Math.max(1, stepCount);
  const lastStepIndex = String(Math.max(0, step - 1));

  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const sessionId = String(new DataView(bytes.buffer, bytes.byteOffset, 8).getBigInt64(0, true));

  const claudeLabel = isClaude ? "true" : "false";
  const nonGeminiLabel = isNonGemini ? "true" : "false";

  const labels: Record<string, string> = {
    last_step_index: lastStepIndex,
    request_id: `${trajectoryId}-0`,
    trajectory_id: trajectoryId,
    used_claude: claudeLabel,
    used_claude_conservative: claudeLabel,
    used_non_gemini_model: nonGeminiLabel,
  };

  return {
    requestId: `agent/${agentId}/${Date.now()}/${trajectoryId}/${step}`,
    sessionId,
    labels,
  };
}

export interface AntigravityGenerateParams {
  token: string;
  projectId: string;
  model: string;
  contents: any[];
  systemInstruction?: any;
  generationConfig?: any;
  tools?: any[];
  toolConfig?: any;
  signal?: AbortSignal;
}

/** Execute streaming generateContent against Antigravity API */
export async function streamGenerateContent(params: AntigravityGenerateParams): Promise<Response> {
  const { token, projectId, model, contents, systemInstruction, generationConfig, tools, toolConfig, signal } = params;

  const envelope = buildEnvelope(model, contents.length);

  const requestPayload: any = {
    contents,
    sessionId: envelope.sessionId,
    labels: envelope.labels,
  };

  if (systemInstruction) {
    requestPayload.systemInstruction = systemInstruction;
  }
  if (generationConfig && Object.keys(generationConfig).length > 0) {
    requestPayload.generationConfig = generationConfig;
  }
  if (tools && tools.length > 0) {
    requestPayload.tools = tools;
  }
  if (toolConfig) {
    requestPayload.toolConfig = toolConfig;
  }

  const fullBody = {
    project: projectId,
    model,
    request: requestPayload,
    requestType: "agent",
    userAgent: "antigravity",
    requestId: envelope.requestId,
  };

  const bodyStr = JSON.stringify(fullBody);
  const headers = antigravityHeaders(token);
  let lastErrorText = "";
  let lastStatus = 0;

  for (const endpoint of ENDPOINT_FALLBACKS) {
    try {
      const url = `${endpoint}/v1internal:streamGenerateContent?alt=sse`;
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: bodyStr,
        signal,
      });

      if (res.ok) {
        return res;
      }

      lastStatus = res.status;
      lastErrorText = await res.text();

      // If quota exceeded or bad request that won't change on another endpoint, stop
      if (res.status === 400 || (res.status === 429 && /quota/i.test(lastErrorText))) {
        break;
      }
    } catch (err: any) {
      if (signal?.aborted) throw err;
      lastErrorText = err.message || String(err);
    }
  }

  let errorMessage = lastErrorText;
  try {
    const parsed = JSON.parse(lastErrorText);
    if (parsed.error?.message) errorMessage = parsed.error.message;
  } catch {}

  throw new Error(`Antigravity API error (${lastStatus}): ${errorMessage}`);
}

/** Fetch available models catalog from Antigravity */
export async function fetchAvailableModels(
  token: string,
  projectId: string,
): Promise<string[]> {
  for (const endpoint of ENDPOINT_FALLBACKS) {
    try {
      const res = await fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
        method: "POST",
        headers: antigravityHeaders(token),
        body: JSON.stringify({ project: projectId }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) continue;
      const data = (await res.json()) as any;
      if (data?.models && typeof data.models === "object") {
        return Object.keys(data.models);
      }
    } catch {}
  }
  return [];
}
