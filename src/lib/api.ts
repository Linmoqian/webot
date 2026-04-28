const API_BASE = "http://localhost:18180";

export interface ChatEvent {
  type: "text" | "tool_call" | "tool_result" | "done" | "error";
  data: Record<string, unknown>;
}

export async function* streamChat(message: string): AsyncGenerator<ChatEvent> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE 以 \n\n 分隔事件块
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";

    for (const block of blocks) {
      if (!block.trim()) continue;
      let eventType = "";
      let dataStr = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          dataStr = line.slice(6);
        }
      }
      if (eventType && dataStr) {
        try {
          const data = JSON.parse(dataStr);
          yield { type: eventType as ChatEvent["type"], data };
        } catch {
          // skip malformed
        }
      }
    }
  }

  // 处理 buffer 中剩余内容
  if (buffer.trim()) {
    let eventType = "";
    let dataStr = "";
    for (const line of buffer.split("\n")) {
      if (line.startsWith("event: ")) eventType = line.slice(7).trim();
      else if (line.startsWith("data: ")) dataStr = line.slice(6);
    }
    if (eventType && dataStr) {
      try {
        yield { type: eventType as ChatEvent["type"], data: JSON.parse(dataStr) };
      } catch {
        // skip
      }
    }
  }
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
