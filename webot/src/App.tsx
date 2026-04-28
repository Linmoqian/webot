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

  const simulateStream = async (userMessage: string) => {
    setMessages((prev) => [
      ...prev,
      { role: "user", content: userMessage },
      { role: "agent", content: "", reasoning_content: "", isThinking: true, isFinished: false, showReasoning: true }
    ]);

    const thoughts = [
      "分析用户的输入意图...",
      "搜索系统上下文中相关的概念...",
      "结合业务场景进行多维度的论证...",
      "提取核心要点，准备组织回答...",
      "思绪整理完毕，开始准备最终的文字。"
    ];
    
    const responseText = "您好！这是一段模拟了现代 AI 推理流的交互。在呈现内容前，我会在内部进行一段详细的「思维链」梳理，帮助我给您更准确、更有逻辑的回答。希望这个现代化的界面能够满足您的需求！";

    // Simulate thinking stream
    for (let i = 0; i < thoughts.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      setMessages((prev) => {
        const newMsg = [...prev];
        const lastMsg = newMsg[newMsg.length - 1];
        lastMsg.reasoning_content = (lastMsg.reasoning_content || "") + thoughts[i] + "\n";
        return newMsg;
      });
    }

    // Thinking ends
    setMessages((prev) => {
      const newMsg = [...prev];
      const lastMsg = newMsg[newMsg.length - 1];
      lastMsg.isThinking = false;
      lastMsg.showReasoning = false; // Auto collapse when done thinking
      return newMsg;
    });

    const chars = responseText.split("");
    for (let i = 0; i < chars.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      setMessages((prev) => {
        const newMsg = [...prev];
        const lastMsg = newMsg[newMsg.length - 1];
        lastMsg.content += chars[i];
        return newMsg;
      });
    }

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
            ))}
            <div ref={messagesEndRef} className="scroll-anchor" />
          </div>
        </div>

        <div className="input-dock">
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
  );
}

export default App;
