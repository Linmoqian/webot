<script lang="ts">
  import { streamChat, checkHealth } from "$lib/api";

  interface Message {
    role: "user" | "assistant";
    content: string;
    toolCalls?: { name: string; args: string; result?: string; error?: boolean }[];
    pending?: boolean;
  }

  let messages: Message[] = $state([]);
  let input = $state("");
  let connected = $state(false);
  let sending = $state(false);

  $effect(() => {
    checkHealth().then((ok) => (connected = ok));
    const id = setInterval(() => checkHealth().then((ok) => (connected = ok)), 5000);
    return () => clearInterval(id);
  });

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    input = "";
    sending = true;

    messages.push({ role: "user", content: text });
    const reply: Message = { role: "assistant", content: "", toolCalls: [], pending: true };
    messages.push(reply);

    try {
      let currentTool: Message["toolCalls"] extends (infer T)[] | undefined ? T : never | undefined;
      for await (const event of streamChat(text)) {
        if (event.type === "text") {
          reply.content += (event.data.content as string) || "";
        } else if (event.type === "tool_call") {
          currentTool = { name: (event.data.name as string) || "", args: JSON.stringify(event.data.arguments, null, 2) };
          reply.toolCalls!.push(currentTool);
        } else if (event.type === "tool_result" && currentTool) {
          currentTool.result = typeof event.data.output === "string" ? event.data.output : JSON.stringify(event.data.output, null, 2);
          currentTool.error = event.data.success !== true;
        } else if (event.type === "error") {
          reply.content += `[error] ${event.data.message || "unknown"}`;
        }
      }
    } catch (e) {
      reply.content += `[connection error] ${e instanceof Error ? e.message : e}`;
    }

    reply.pending = false;
    sending = false;
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
</script>

<main class="chat-container">
  <header class="chat-header">
    <h1>Webot</h1>
    <span class="status" class:connected class:disconnected={!connected}>
      {connected ? "connected" : "offline"}
    </span>
  </header>

  <div class="messages">
    {#each messages as msg}
      <div class="message {msg.role}">
        <div class="bubble">
          {#if msg.role === "user"}
            {msg.content}
          {:else}
            <div class="assistant-content">
              {#if msg.content}
                <div class="text-content">{msg.content}</div>
              {/if}

              {#if msg.toolCalls && msg.toolCalls.length > 0}
                {#each msg.toolCalls as tc, i}
                  <details class="tool-box" open={i === msg.toolCalls.length - 1 && !tc.result}>
                    <summary>
                      <span class="tool-icon">&#9881;</span>
                      {tc.name}
                    </summary>
                    <pre class="tool-args">{tc.args}</pre>
                    {#if tc.result}
                      <pre class="tool-result" class:error={tc.error}>{tc.result}</pre>
                    {/if}
                  </details>
                {/each}
              {/if}

              {#if msg.pending}
                <span class="cursor">|</span>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <div class="input-area">
    <textarea
      bind:value={input}
      onkeydown={handleKey}
      placeholder={connected ? "input message, Enter to send..." : "backend offline..."}
      disabled={!connected || sending}
      rows="1"
    ></textarea>
    <button onclick={send} disabled={!connected || sending || !input.trim()}>
      Send
    </button>
  </div>
</main>

<style>
  .chat-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    max-width: 800px;
    margin: 0 auto;
    padding: 0;
  }

  .chat-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    background: var(--surface);
    border-bottom: 1px solid var(--primary);
  }

  .chat-header h1 {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--accent);
  }

  .status {
    font-size: 0.75rem;
    padding: 2px 10px;
    border-radius: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .connected {
    background: #0a3d0a;
    color: #4caf50;
  }

  .disconnected {
    background: #3d0a0a;
    color: #f44336;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .message {
    display: flex;
    max-width: 85%;
  }

  .message.user {
    align-self: flex-end;
  }

  .message.assistant {
    align-self: flex-start;
  }

  .bubble {
    padding: 10px 14px;
    border-radius: var(--radius);
    line-height: 1.5;
    font-size: 0.9rem;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .message.user .bubble {
    background: var(--primary);
    color: var(--text);
  }

  .message.assistant .bubble {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--primary);
  }

  .assistant-content {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .text-content {
    white-space: pre-wrap;
  }

  .tool-box {
    background: rgba(255, 193, 7, 0.1);
    border: 1px solid rgba(255, 193, 7, 0.3);
    border-radius: 6px;
    padding: 8px;
    font-size: 0.8rem;
  }

  .tool-box summary {
    cursor: pointer;
    font-weight: 600;
    color: #ffc107;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .tool-icon {
    font-size: 0.9rem;
  }

  .tool-args {
    margin-top: 6px;
    padding: 6px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    font-size: 0.75rem;
    overflow-x: auto;
    color: var(--text-dim);
  }

  .tool-result {
    margin-top: 6px;
    padding: 6px;
    background: rgba(76, 175, 80, 0.1);
    border: 1px solid rgba(76, 175, 80, 0.3);
    border-radius: 4px;
    font-size: 0.75rem;
    overflow-x: auto;
    color: #4caf50;
  }

  .tool-result.error {
    background: rgba(244, 67, 54, 0.1);
    border-color: rgba(244, 67, 54, 0.3);
    color: #f44336;
  }

  .cursor {
    animation: blink 1s step-end infinite;
    color: var(--accent);
  }

  @keyframes blink {
    50% { opacity: 0; }
  }

  .input-area {
    display: flex;
    gap: 8px;
    padding: 12px 20px;
    background: var(--surface);
    border-top: 1px solid var(--primary);
  }

  textarea {
    flex: 1;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--primary);
    border-radius: var(--radius);
    padding: 10px 14px;
    font-size: 0.9rem;
    font-family: inherit;
    resize: none;
    outline: none;
    transition: border-color 0.2s;
  }

  textarea:focus {
    border-color: var(--accent);
  }

  textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  button {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: var(--radius);
    padding: 10px 20px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
  }

  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  button:hover:not(:disabled) {
    opacity: 0.85;
  }
</style>
