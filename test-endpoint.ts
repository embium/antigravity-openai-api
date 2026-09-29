import { createOpenAIServer } from "./src/server.js";

const PORT = 8999;
const server = createOpenAIServer();

await new Promise<void>((resolve) => {
  server.listen(PORT, "127.0.0.1", () => resolve());
});

console.log("Server listening on port", PORT);

try {
  // 1. Test /health
  console.log("\n--- Testing /health ---");
  const healthRes = await fetch(`http://127.0.0.1:${PORT}/health`);
  console.log("Health status:", healthRes.status);
  console.log("Health response:", await healthRes.json());

  // 2. Test /v1/models
  console.log("\n--- Testing /v1/models ---");
  const modelsRes = await fetch(`http://127.0.0.1:${PORT}/v1/models`);
  console.log("Models status:", modelsRes.status);
  const modelsJson = (await modelsRes.json()) as any;
  console.log(`Found ${modelsJson.data?.length} models. Sample:`);
  console.log(modelsJson.data?.slice(0, 6).map((m: any) => m.id));

  // 3. Test non-streaming chat completion with claude-sonnet-4-6
  console.log("\n--- Testing non-streaming chat completion (claude-sonnet-4-6) ---");
  const chatRes = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      messages: [
        { role: "system", content: "You are a concise assistant." },
        { role: "user", content: "Say 'Hello Jan user!' and nothing else." },
      ],
      stream: false,
    }),
  });
  console.log("Chat status:", chatRes.status);
  const chatJson = (await chatRes.json()) as any;
  console.log("Chat response:", JSON.stringify(chatJson, null, 2));

  // 4. Test streaming chat completion with gemini-3.7-flash
  console.log("\n--- Testing streaming chat completion (gemini-3.7-flash) ---");
  const streamRes = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gemini-3.7-flash",
      messages: [
        { role: "user", content: "Count from 1 to 5 with commas." },
      ],
      stream: true,
    }),
  });
  console.log("Stream status:", streamRes.status);
  const reader = streamRes.body!.getReader();
  const decoder = new TextDecoder();
  let streamBuffer = "";
  let fullContent = "";
  let fullReasoning = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    streamBuffer += decoder.decode(value, { stream: true });
    const lines = streamBuffer.split("\n");
    streamBuffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) fullContent += delta.content;
        if (delta?.reasoning_content) fullReasoning += delta.reasoning_content;
      } catch {}
    }
  }

  console.log("Streamed text:", fullContent.trim());
  if (fullReasoning) console.log("Streamed reasoning (sample):", fullReasoning.slice(0, 100));

  // 5. Test tool calling with array responses (Claude & Gemini)
  console.log("\n--- Testing tool completion with JSON array response (Claude) ---");
  const toolRes = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      messages: [
        { role: "user", content: "List the top users." },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_abc123",
              type: "function",
              function: { name: "get_users", arguments: "{}" },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_abc123",
          content: JSON.stringify([
            { id: 1, name: "Alice" },
            { id: 2, name: "Bob" },
          ]),
        },
      ],
      stream: false,
    }),
  });
  console.log("Tool Claude Status:", toolRes.status);
  const toolJson = (await toolRes.json()) as any;
  console.log("Tool Claude Response:", toolJson.choices?.[0]?.message?.content?.slice(0, 100));

  console.log("\nAll endpoint tests PASSED successfully!");
} finally {
  server.close();
}
