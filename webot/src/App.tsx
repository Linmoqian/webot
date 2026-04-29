import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, User, Sparkles, ChevronDown, ChevronRight, Loader2, QrCode, X, Settings, MessageCircle } from "lucide-react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { QRCodeSVG } from "qrcode.react";
import { useI18n, type Theme } from "./i18n";
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

const THEME_KEY = "webot-theme";

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "tiff", "ico"]);

function preprocessMediaMarkers(text: string, mediaDir: string): string {
  return text.replace(/\[media:\s*([^\]]+)\]/g, (_match, filename: string) => {
    const trimmed = filename.trim();
    const filePath = `${mediaDir}/${trimmed}`;
    const url = convertFileSrc(filePath);
    const ext = trimmed.split(".").pop()?.toLowerCase() || "";
    if (IMAGE_EXTS.has(ext)) {
      return `![${trimmed}](${url})`;
    }
    return `[${trimmed}](${url})`;
  });
}

function applyTheme(theme: Theme) {
  if (theme === "system") {
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

function App() {
  const { lang, setLang, t } = useI18n();

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
  const mediaDirRef = useRef<string>("");
  const [wechatConnected, setWechatConnected] = useState(false);
  const [wechatMessages, setWechatMessages] = useState<{ from: string; text: string; time: string }[]>([]);
  const [showWechatLog, setShowWechatLog] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    base_url: "", model: "", api_key: "", system_prompt: "", max_context_messages: 20,
  });
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(THEME_KEY) as Theme) || "system"
  );

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_KEY, theme);

    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyTheme("system");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [theme]);

  useEffect(() => {
    invoke<{ wechat: { media_dir: string | null } }>("get_settings")
      .then((s) => {
        mediaDirRef.current = s.wechat.media_dir || "";
      })
      .catch(() => {});
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const unlistenStatus = listen<{ status: string }>("wechat-status", event => {
      setWechatConnected(event.payload.status === "connected");
    });
    const unlistenMsg = listen<{ from: string; text: string }>("wechat-message", event => {
      const now = new Date();
      const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
      setWechatMessages(prev => [...prev.slice(-99), { from: event.payload.from, text: event.payload.text, time }]);
    });
    return () => { unlistenStatus.then(fn => fn()); unlistenMsg.then(fn => fn()); };
  }, []);

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

    invoke<{ status?: string; bot_token?: string; baseurl?: string }>("poll_qr_status", { qrcodeId: id })
      .then(data => {
        const status = data.status;
        if (status === "confirmed") {
          setQrStatus("confirmed");
          stopQrPoll();
          const token = data.bot_token || "";
          if (token) {
            invoke("save_wechat_token", { token, baseUrl: data.baseurl || null })
              .then(() => invoke("start_wechat_listener"))
              .catch(() => {});
          }
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
          setQrError(t("qrNoData"));
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
  }, [pollQrStatus, t]);

  const closeQrModal = useCallback(() => {
    stopQrPoll();
    setShowQrModal(false);
    setQrData("");
    qrIdRef.current = "";
  }, [stopQrPoll]);

  const openSettingsModal = useCallback(() => {
    invoke<{
      provider: { base_url: string; model: string; api_key: string };
      agent: { system_prompt: string; max_context_messages: number };
      wechat: { base_url: string; token: string };
    }>("get_settings").then(s => {
      setSettingsForm({
        base_url: s.provider.base_url,
        model: s.provider.model,
        api_key: s.provider.api_key,
        system_prompt: s.agent.system_prompt,
        max_context_messages: s.agent.max_context_messages,
      });
      setShowSettingsModal(true);
    }).catch(() => {});
  }, []);

  const saveSettings = useCallback(() => {
    setSettingsSaving(true);
    invoke<{
      provider: { base_url: string; model: string; api_key: string; verify_ssl: boolean; timeout: number };
      agent: { system_prompt: string; max_context_messages: number };
      wechat: { base_url: string; token: string };
    }>("get_settings").then(current => {
      const updated = {
        ...current,
        provider: { ...current.provider, base_url: settingsForm.base_url, model: settingsForm.model, api_key: settingsForm.api_key },
        agent: { ...current.agent, system_prompt: settingsForm.system_prompt, max_context_messages: settingsForm.max_context_messages },
      };
      invoke("update_settings", { settings: updated }).then(() => {
        setSettingsSaving(false);
        setShowSettingsModal(false);
      }).catch(() => setSettingsSaving(false));
    }).catch(() => setSettingsSaving(false));
  }, [settingsForm]);

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
            content: t("errorPrefix") + ": " + (event.payload.message || t("connectionError")),
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
          content: t("connectionError"),
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

  const themeOptions: { value: Theme; label: string }[] = [
    { value: "light", label: t("themeLight") },
    { value: "dark", label: t("themeDark") },
    { value: "system", label: t("themeSystem") },
  ];

  return (
    <div className="layout-container">
      <div className="main-content">
        <header className="app-header">
          <div className="header-brand">
            <div className="logo-box"><Sparkles size={20} className="logo-icon" /></div>
            <h2>Nexus AI</h2>
            <span className="badge">Beta</span>
          </div>
          <button className="qr-header-btn" onClick={openQrModal} title={t("tooltipWechatLogin")}>
            <QrCode size={20} />
          </button>
          <button className="settings-header-btn" onClick={openSettingsModal} title={t("tooltipSettings")}>
            <Settings size={20} />
          </button>
          <button
            className={`wechat-toggle-btn ${wechatConnected ? "connected" : ""}`}
            onClick={() => setShowWechatLog(true)}
            title={wechatConnected ? t("tooltipWechatLog") : t("tooltipWechatNotConnected")}
          >
            <span className="wechat-dot" />
          </button>
        </header>

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
                        <button
                          className="reasoning-toggle"
                          onClick={() => toggleReasoning(index)}
                        >
                          {msg.showReasoning ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <span className="reasoning-label">
                            {msg.isThinking ? t("thinkingActive") : t("thinkingProcess")}
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
                          {msg.role === "agent" && mediaDirRef.current
                            ? preprocessMediaMarkers(msg.content, mediaDirRef.current)
                            : msg.content}
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
      </div>

      {showQrModal && (
        <div className="qr-modal-overlay" onClick={closeQrModal}>
          <div className="qr-modal" onClick={e => e.stopPropagation()}>
            <button className="qr-modal-close" onClick={closeQrModal}>
              <X size={18} />
            </button>
            <h3 className="qr-modal-title">{t("qrTitle")}</h3>
            <div className="qr-modal-body">
              {qrStatus === "loading" && (
                <div className="qr-loading">
                  <Loader2 size={32} className="spinner" />
                  <p>{t("qrLoading")}</p>
                </div>
              )}
              {qrStatus === "waiting" && qrData && (
                <div className="qr-code-wrapper">
                  <QRCodeSVG value={qrData} size={200} level="M" />
                  <p className="qr-hint">{t("qrHint")}</p>
                </div>
              )}
              {qrStatus === "scanned" && (
                <div className="qr-status-info scanned">
                  <p>{t("qrScanned")}</p>
                </div>
              )}
              {qrStatus === "confirmed" && (
                <div className="qr-status-info confirmed">
                  <p>{t("qrConfirmed")}</p>
                </div>
              )}
              {qrStatus === "expired" && (
                <div className="qr-status-info expired">
                  <p>{t("qrExpired")}</p>
                  <button className="qr-refresh-btn" onClick={openQrModal}>{t("qrRefresh")}</button>
                </div>
              )}
              {qrStatus === "error" && (
                <div className="qr-status-info error">
                  <p>{qrError || t("qrError")}</p>
                  <button className="qr-refresh-btn" onClick={openQrModal}>{t("qrRetry")}</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showSettingsModal && (
        <div className="qr-modal-overlay" onClick={() => setShowSettingsModal(false)}>
          <div className="qr-modal settings-modal" onClick={e => e.stopPropagation()}>
            <button className="qr-modal-close" onClick={() => setShowSettingsModal(false)}>
              <X size={18} />
            </button>
            <h3 className="qr-modal-title">{t("settingsTitle")}</h3>
            <div className="settings-form">
              <div className="settings-section-title">{t("sectionAppearance")}</div>
              <div className="settings-row">
                <span className="settings-label">{t("labelTheme")}</span>
                <div className="settings-segmented">
                  {themeOptions.map(opt => (
                    <button
                      key={opt.value}
                      className={theme === opt.value ? "active" : ""}
                      onClick={() => setTheme(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <span className="settings-label">{t("labelLanguage")}</span>
                <div className="settings-segmented">
                  <button className={lang === "zh" ? "active" : ""} onClick={() => setLang("zh")}>中文</button>
                  <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>English</button>
                </div>
              </div>

              <div className="settings-section-title" style={{ marginTop: 12 }}>{t("sectionModel")}</div>
              <label className="settings-label">
                <span>{t("labelBaseUrl")}</span>
                <input
                  type="text"
                  value={settingsForm.base_url}
                  onChange={e => setSettingsForm(prev => ({ ...prev, base_url: e.target.value }))}
                  placeholder="https://api.openai.com/v1"
                />
              </label>
              <label className="settings-label">
                <span>{t("labelModel")}</span>
                <input
                  type="text"
                  value={settingsForm.model}
                  onChange={e => setSettingsForm(prev => ({ ...prev, model: e.target.value }))}
                  placeholder="gpt-4o"
                />
              </label>
              <label className="settings-label">
                <span>{t("labelApiKey")}</span>
                <input
                  type="password"
                  value={settingsForm.api_key}
                  onChange={e => setSettingsForm(prev => ({ ...prev, api_key: e.target.value }))}
                  placeholder="sk-..."
                />
              </label>
              <label className="settings-label">
                <span>{t("labelSystemPrompt")}</span>
                <textarea
                  value={settingsForm.system_prompt}
                  onChange={e => setSettingsForm(prev => ({ ...prev, system_prompt: e.target.value }))}
                  placeholder="You are a helpful assistant."
                  rows={3}
                />
              </label>
              <label className="settings-label">
                <span>{t("labelContextMessages")}</span>
                <input
                  type="number"
                  value={settingsForm.max_context_messages}
                  onChange={e => setSettingsForm(prev => ({ ...prev, max_context_messages: Number(e.target.value) || 20 }))}
                  min={1}
                  max={100}
                />
              </label>
              <button
                className="settings-save-btn"
                onClick={saveSettings}
                disabled={settingsSaving}
              >
                {settingsSaving ? <Loader2 size={16} className="spinner" /> : t("btnSave")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showWechatLog && (
        <div className="qr-modal-overlay" onClick={() => setShowWechatLog(false)}>
          <div className="qr-modal wechat-log-modal" onClick={e => e.stopPropagation()}>
            <button className="qr-modal-close" onClick={() => setShowWechatLog(false)}>
              <X size={18} />
            </button>
            <h3 className="qr-modal-title">{t("wechatLogTitle")}</h3>
            <div className="wechat-log-list">
              {wechatMessages.length === 0 ? (
                <div className="wechat-log-empty">
                  <MessageCircle size={32} />
                  <p>{wechatConnected ? t("noMessages") : t("wechatNotConnected")}</p>
                </div>
              ) : (
                wechatMessages.map((msg, i) => (
                  <div key={i} className="wechat-log-row">
                    <span className="wechat-log-time">{msg.time}</span>
                    <span className="wechat-log-arrow">&#8594;</span>
                    <span className="wechat-log-from">{msg.from.slice(-8)}</span>
                    <span className="wechat-log-text">{msg.text}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
