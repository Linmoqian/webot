import { useState, useRef, useEffect } from "react";
import "./App.css";

interface Message {
  role: "user" | "agent";
  content: string;
  reasoning_content?: string;
  isThinking?: boolean;
  isFinished?: boolean;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const simulateStream = async (userMessage: string) => {
    // This is a simulation. In a real scenario, you'd process SSE or WebSockets from your backend.
    
    // Initial agent message state
    setMessages((prev) => [
      ...prev,
      { role: "user", content: userMessage },
      { role: "agent", content: "", reasoning_content: "", isThinking: true, isFinished: false }
    ]);

    const thoughts = [
      "收到用户消息...",
      "分析意图...",
      "搜索知识库...",
      "正在组织语言...",
      "思考完成。"
    ];
    
    const responseText = "您好！这是我的回答。这模拟了带有思考过程的流式输出！";

    // Simulate thinking stream
    for (let i = 0; i < thoughts.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      setMessages((prev) => {
        const newMsg = [...prev];
        const lastMsg = newMsg[newMsg.length - 1];
        lastMsg.reasoning_content = (lastMsg.reasoning_content || "") + thoughts[i] + "\n";
        return newMsg;
      });
    }

    // Thinking ends, start outputting content
    setMessages((prev) => {
      const newMsg = [...prev];
      newMsg[newMsg.length - 1].isThinking = false;
      return newMsg;
    });

    const chars = responseText.split("");
    for (let i = 0; i < chars.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      setMessages((prev) => {
        const newMsg = [...prev];
        const lastMsg = newMsg[newMsg.length - 1];
        lastMsg.content += chars[i];
        return newMsg;
      });
    }

    // Done
    setMessages((prev) => {
      const newMsg = [...prev];
      newMsg[newMsg.length - 1].isFinished = true;
      return newMsg;
    });
    setIsLoading(false);
  };

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    const userText = input.trim();
    setInput("");
    setIsLoading(true);
    simulateStream(userText);
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h2>智能助手 (含深度思考)</h2>
      </div>
      
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="empty-state">你可以问我任何问题～</div>
        )}
        
        {messages.map((msg, index) => (
          <div key={index} className={`message-bubble ${msg.role}`}>
            <div className="message-avatar">
              {msg.role === "user" ? "👤" : "🤖"}
            </div>
            <div className="message-content-wrapper">
              {/* 思考流展示区 */}
              {msg.role === "agent" && msg.reasoning_content && (
                <div className={`reasoning-box ${msg.isThinking ? "thinking" : ""}`}>
                  <div className="reasoning-header">
                    <span className="icon">💭</span>
                    <span>{msg.isThinking ? "思考中..." : "已深度思考"}</span>
                  </div>
                  <div className="reasoning-content">
                    {msg.reasoning_content.split('\n').map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* 正文展示区 */}
              {msg.content && <div className="message-content">{msg.content}</div>}
              {msg.role === "agent" && !msg.content && msg.isThinking && (
                 <div className="message-content typing-indicator"></div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="输入消息，按 Enter 发送..."
          disabled={isLoading}
        />
        <button onClick={handleSend} disabled={isLoading || !input.trim()}>
          {isLoading ? "发送中" : "发送"}
        </button>
      </div>
    </div>
  );
}

export default App;
