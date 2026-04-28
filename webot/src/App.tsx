import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Sparkles, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import "./App.css";

interface Message {
  role: "user" | "agent";
  content: string;
  reasoning_content?: string;
  isThinking?: boolean;
  isFinished?: boolean;
  showReasoning?: boolean;
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

  const toggleReasoning = (index: number) => {
    setMessages(prev => prev.map((msg, i) => 
      i === index ? { ...msg, showReasoning: !msg.showReasoning } : msg
    ));
  };

  const API_URL = "http://localhost:18180/chat";

  const sendChatMessage = async (userMessage: string) => {
    setMessages(prev => [
      ...prev,
      { role: "user" as const, content: userMessage },
      { role: "agent" as const, content: "", reasoning_content: "", isThinking: false, isFinished: false, showReasoning: false }
    ]);

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage }),
      });

      if (!response.ok || !response.body) throw new Error("请求失败");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          if (!part.trim()) continue;
          let eventType = "";
          let eventData = "{}";

          for (const line of part.split("\n")) {
            if (line.startsWith("event: ")) eventType = line.slice(7);
            else if (line.startsWith("data: ")) eventData = line.slice(6);
          }

          try {
            const data = JSON.parse(eventData);
            switch (eventType) {
              case "text":
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  updated[updated.length - 1] = { ...last, content: last.content + (data.content || "") };
                  return updated;
                });
                break;
              case "thinking":
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  updated[updated.length - 1] = {
                    ...last,
                    reasoning_content: (last.reasoning_content || "") + (data.content || ""),
                    isThinking: true,
                    showReasoning: true,
                  };
                  return updated;
                });
                break;
              case "done":
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  updated[updated.length - 1] = {
                    ...last,
                    isFinished: true,
                    isThinking: false,
                    showReasoning: false,
                  };
                  return updated;
                });
                setIsLoading(false);
                break;
              case "error":
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    ...updated[updated.length - 1],
                    content: "错误: " + (data.message || "未知错误"),
                    isFinished: true,
                    isThinking: false,
                  };
                  return updated;
                });
                setIsLoading(false);
                break;
            }
          } catch {
            // JSON 解析失败，跳过
          }
        }
      }
    } catch {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content: "连接失败，请检查后端服务是否启动 (http://localhost:18180)",
          isFinished: true,
          isThinking: false,
        };
        return updated;
      });
      setIsLoading(false);
    }
  };

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    const userText = input.trim();
    setInput("");
    setIsLoading(true);
    sendChatMessage(userText);
  };

  return (
    <div className="layout-container">
      <div className="main-content">
        <header className="app-header">
          <div className="header-brand">
            <div className="logo-box"><Sparkles size={20} className="logo-icon" /></div>
            <h2>Nexus AI</h2>
            <span className="badge">Beta</span>
          </div>
        </header>
        
        <div className="chat-scroll-area">
          {messages.length === 0 && (
            <div className="hero-welcome">
              <div className="hero-icon-wrapper">
                <Sparkles size={48} className="hero-icon" />
              </div>
              <h1 className="hero-title">今天能帮您解答些什么？</h1>
              <p className="hero-subtitle">Nexus AI 拥有深度思考能力，能够洞察复杂问题。</p>
            </div>
          )}
          
          <div className="message-list">
            {messages.map((msg, index) => (
              <div key={index} className={`message-row ${msg.role}`}>
                <div className="message-inner">
                  <div className="message-avatar-box">
                    {msg.role === "user" ? <User size={18} /> : <Bot size={18} />}
                  </div>
                  
                  <div className="message-content-box">
                    <div className="message-sender-name">
                      {msg.role === "user" ? "You" : "Nexus"}
                    </div>

                    {msg.role === "agent" && msg.reasoning_content && (
                      <div className={`reasoning-block ${msg.isThinking ? "is-thinking" : ""}`}>
                        <button 
                          className="reasoning-toggle" 
                          onClick={() => toggleReasoning(index)}
                        >
                          {msg.showReasoning ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <span className="reasoning-label">
                            {msg.isThinking ? "Thinking Process" : "Thought Process"}
                          </span>
                          {msg.isThinking && <Loader2 size={12} className="spinner" />}
                        </button>
                        
                        {msg.showReasoning && (
                          <div className="reasoning-content">
                            {msg.reasoning_content}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {msg.content && (
                      <div className="message-text">
                        {msg.content}
                      </div>
                    )}
                    
                    {msg.role === "agent" && !msg.content && msg.isThinking && (
                      <div className="typing-dot-indicator">
                        <span></span><span></span><span></span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} className="scroll-anchor" />
          </div>
        </div>

        <div className="input-dock">
          <div className="input-dock-inner">
            <div className="input-wrapper">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Ask anything..."
                disabled={isLoading}
                rows={1}
              />
              <button 
                className={`send-button ${input.trim() && !isLoading ? 'active' : ''}`}
                onClick={handleSend} 
                disabled={isLoading || !input.trim()}
              >
                {isLoading ? <Loader2 size={18} className="spinner" /> : <Send size={18} />}
              </button>
            </div>
            <div className="input-footer-text">
              Nexus AI can make mistakes. Consider verifying critical information.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
