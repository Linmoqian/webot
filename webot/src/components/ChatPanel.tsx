import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, User, Sparkles, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "../i18n";
import { useChatStream } from "../hooks/useChatStream";
import { renderMarkdown, renderMessageContent } from "./Markdown";
import { ToolResultCard } from "./ToolResultCard";
import type { PluginManifest } from "../types";

interface ChatPanelProps {
  installedPlugins: PluginManifest[];
  onToolResult?: (event: { name: string; msgIndex: number }) => void;
}

export function ChatPanel({ installedPlugins, onToolResult }: ChatPanelProps) {
  const { t } = useI18n();
  const toolIds = installedPlugins.length > 0 ? installedPlugins.map(p => p.id) : undefined;
  const { messages, isLoading, sendChatMessage, toggleReasoning } = useChatStream(t, toolIds);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaDirRef = useRef<string>("");

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    invoke<{ wechat: { media_dir: string | null } }>("get_settings")
      .then(s => { mediaDirRef.current = s.wechat.media_dir || ""; })
      .catch(() => {});
  }, []);

  const msgCountRef = useRef(0);
  useEffect(() => {
    if (onToolResult) {
      const prevCount = msgCountRef.current;
      for (let mi = prevCount; mi < messages.length; mi++) {
        const msg = messages[mi];
        if (msg.toolResults) {
          for (const tr of msg.toolResults) {
            onToolResult({ name: tr.name, msgIndex: mi });
          }
        }
      }
    }
    msgCountRef.current = messages.length;
  }, [messages, onToolResult]);

  const handleSend = useCallback(() => {
    if (!input.trim() || isLoading) return;
    const userText = input.trim();
    setInput("");
    sendChatMessage(userText);
  }, [input, isLoading, sendChatMessage]);

  return (
    <>
      <div className="chat-scroll-area">
        {messages.length === 0 && (
          <div className="hero-welcome">
            <div className="hero-icon-wrapper">
              <Sparkles size={48} className="hero-icon" />
            </div>
            <h1 className="hero-title">{t("heroTitle")}</h1>
            <p className="hero-subtitle">{t("heroSubtitle")}</p>
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
                    {msg.role === "user" ? t("senderUser") : t("senderBot")}
                  </div>

                  {msg.role === "agent" && msg.reasoning_content && (
                    <div className={`reasoning-block ${msg.isThinking ? "is-thinking" : ""}`}>
                      <button className="reasoning-toggle" onClick={() => toggleReasoning(index)}>
                        {msg.showReasoning ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span className="reasoning-label">
                          {msg.isThinking ? t("thinkingActive") : t("thinkingProcess")}
                        </span>
                        {msg.isThinking && <Loader2 size={12} className="spinner" />}
                      </button>
                      {msg.showReasoning && (
                        <div className="reasoning-content">
                          {renderMarkdown(msg.reasoning_content || "", mediaDirRef.current)}
                        </div>
                      )}
                    </div>
                  )}

                  {msg.toolResults && msg.toolResults.length > 0 && (
                    <div className="tool-results-container">
                      {msg.toolResults.map((tr, i) => (
                        <ToolResultCard key={i} event={tr} />
                      ))}
                    </div>
                  )}

                  {msg.content && (
                    <div className="message-text">
                      {renderMessageContent(msg, mediaDirRef.current)}
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
              placeholder={t("inputPlaceholder")}
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
            {t("inputFooter")}
          </div>
        </div>
      </div>
    </>
  );
}
