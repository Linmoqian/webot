import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, User, Sparkles, ChevronDown, ChevronRight, Loader2, QrCode, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { QRCodeSVG } from "qrcode.react";
import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";
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
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrData, setQrData] = useState<string>("");
  const [qrStatus, setQrStatus] = useState<"loading" | "waiting" | "scanned" | "confirmed" | "expired" | "error">("loading");
  const [qrError, setQrError] = useState("");
  const qrIdRef = useRef<string>("");
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const stopQrPoll = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const pollQrStatus = useCallback(() => {
    const id = qrIdRef.current;
    if (!id) return;

    invoke<{ status?: string; bot_token?: string }>("poll_qr_status", { qrcodeId: id })
      .then(data => {
        const status = data.status;
        if (status === "confirmed") {
          setQrStatus("confirmed");
          stopQrPoll();
          setTimeout(() => closeQrModal(), 800);
        } else if (status === "expired") {
          setQrStatus("expired");
          stopQrPoll();
        } else if (status === "scaned_but_redirect") {
          setQrStatus("scanned");
          pollTimerRef.current = setTimeout(pollQrStatus, 1500);
        } else {
          pollTimerRef.current = setTimeout(pollQrStatus, 1500);
        }
      })
      .catch(() => {
        pollTimerRef.current = setTimeout(pollQrStatus, 2000);
      });
  }, [stopQrPoll]);

  const openQrModal = useCallback(() => {
    setShowQrModal(true);
    setQrStatus("loading");
    setQrError("");
    setQrData("");

    invoke<{ qrcode_img_content?: string; qrcode?: string }>("fetch_wechat_qr")
      .then(data => {
        const content = data.qrcode_img_content || data.qrcode || "";
        if (!content) {
          setQrStatus("error");
          setQrError("未获取到二维码数据");
          return;
        }
        qrIdRef.current = data.qrcode || "";
        setQrData(content);
        setQrStatus("waiting");
        pollTimerRef.current = setTimeout(pollQrStatus, 1500);
      })
      .catch(err => {
        setQrStatus("error");
        setQrError(String(err));
      });
  }, [pollQrStatus]);

  const closeQrModal = useCallback(() => {
    stopQrPoll();
    setShowQrModal(false);
    setQrData("");
    qrIdRef.current = "";
  }, [stopQrPoll]);

  const sendChatMessage = async (userMessage: string) => {
    setMessages(prev => [
      ...prev,
      { role: "user" as const, content: userMessage },
      { role: "agent" as const, content: "", reasoning_content: "", isThinking: false, isFinished: false, showReasoning: false }
    ]);

    const cleanup = { current: () => {} };

    try {
      const unlistenThinking = await listen<{ content: string }>("chat-thinking", (event) => {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = {
            ...last,
            reasoning_content: (last.reasoning_content || "") + (event.payload.content || ""),
            isThinking: true,
            showReasoning: true,
          };
          return updated;
        });
      });

      const unlistenText = await listen<{ content: string }>("chat-text", (event) => {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = {
            ...last,
            content: last.content + (event.payload.content || ""),
            isThinking: false,
          };
          return updated;
        });
      });

      const unlistenDone = await listen("chat-done", () => {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = { ...last, isFinished: true, isThinking: false };
          return updated;
        });
        setIsLoading(false);
        cleanup.current();
      });

      const unlistenError = await listen<{ message: string }>("chat-error", (event) => {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: "错误: " + (event.payload.message || "未知错误"),
            isFinished: true,
            isThinking: false,
          };
          return updated;
        });
        setIsLoading(false);
        cleanup.current();
      });

      cleanup.current = () => {
        unlistenThinking();
        unlistenText();
        unlistenDone();
        unlistenError();
      };

      await invoke("start_chat", { message: userMessage });
    } catch {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content: "连接失败，请检查 Tauri 后端",
          isFinished: true,
          isThinking: false,
        };
        return updated;
      });
      setIsLoading(false);
      cleanup.current();
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
          <button className="qr-header-btn" onClick={openQrModal} title="微信登录">
            <QrCode size={20} />
          </button>
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
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm, remarkMath]}
                              rehypePlugins={[rehypeHighlight, rehypeKatex]}
                            >
                              {msg.reasoning_content || ""}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {msg.content && (
                      <div className="message-text">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[rehypeHighlight, rehypeKatex]}
                        >
                          {msg.content}
                        </ReactMarkdown>
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

      {showQrModal && (
        <div className="qr-modal-overlay" onClick={closeQrModal}>
          <div className="qr-modal" onClick={e => e.stopPropagation()}>
            <button className="qr-modal-close" onClick={closeQrModal}>
              <X size={18} />
            </button>
            <h3 className="qr-modal-title">微信扫码登录</h3>
            <div className="qr-modal-body">
              {qrStatus === "loading" && (
                <div className="qr-loading">
                  <Loader2 size={32} className="spinner" />
                  <p>获取二维码中...</p>
                </div>
              )}
              {qrStatus === "waiting" && qrData && (
                <div className="qr-code-wrapper">
                  <QRCodeSVG value={qrData} size={200} level="M" />
                  <p className="qr-hint">请使用微信扫描二维码</p>
                </div>
              )}
              {qrStatus === "scanned" && (
                <div className="qr-status-info scanned">
                  <p>已扫描，请在手机上确认登录</p>
                </div>
              )}
              {qrStatus === "confirmed" && (
                <div className="qr-status-info confirmed">
                  <p>登录成功</p>
                </div>
              )}
              {qrStatus === "expired" && (
                <div className="qr-status-info expired">
                  <p>二维码已过期</p>
                  <button className="qr-refresh-btn" onClick={openQrModal}>刷新二维码</button>
                </div>
              )}
              {qrStatus === "error" && (
                <div className="qr-status-info error">
                  <p>{qrError || "获取二维码失败"}</p>
                  <button className="qr-refresh-btn" onClick={openQrModal}>重试</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
