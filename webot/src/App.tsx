import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, User, Sparkles, ChevronDown, ChevronRight, Loader2, QrCode, X, Settings, MessageCircle, Store, Cloud, Search, Code, Languages, Newspaper, LayoutDashboard, Zap, PenTool, Users } from "lucide-react";
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

interface ToolResultEvent {
  name: string;
  result: string;
  renderer: "card" | "table" | "markdown" | "text";
}

interface Message {
  role: "user" | "agent";
  content: string;
  reasoning_content?: string;
  isThinking?: boolean;
  isFinished?: boolean;
  showReasoning?: boolean;
  toolResults?: ToolResultEvent[];
}

const THEME_KEY = "webot-theme";

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "tiff", "ico"]);

function getImageExt(value: string): string {
  const withoutQuery = value.split(/[?#]/)[0];
  return withoutQuery.split(".").pop()?.toLowerCase() || "";
}

function isImagePath(value: string): boolean {
  return IMAGE_EXTS.has(getImageExt(value));
}

function isPassThroughUrl(value: string): boolean {
  return /^(https?:|asset:|data:|blob:)/i.test(value);
}

function isLocalPath(value: string): boolean {
  return /^(file:|[a-zA-Z]:[\\/]|\\\\|\/)/.test(value);
}

function fileUrlToPath(value: string): string {
  try {
    const url = new URL(value);
    const pathname = decodeURIComponent(url.pathname);
    if (/^\/[a-zA-Z]:/.test(pathname)) {
      return pathname.slice(1);
    }
    return pathname;
  } catch {
    return value.replace(/^file:\/\//i, "");
  }
}

function resolveImageSrc(src: string | undefined, mediaDir = ""): string | undefined {
  if (!src) return src;

  const trimmed = src.trim();
  if (isPassThroughUrl(trimmed)) return trimmed;

  if (/^file:/i.test(trimmed)) {
    return convertFileSrc(fileUrlToPath(trimmed));
  }

  if (isLocalPath(trimmed)) {
    return convertFileSrc(trimmed);
  }

  if (mediaDir && isImagePath(trimmed)) {
    return convertFileSrc(`${mediaDir}/${trimmed}`);
  }

  return trimmed;
}

function transformMarkdownUrl(url: string, mediaDir = ""): string {
  if (isImagePath(url) || /^file:/i.test(url) || isLocalPath(url)) {
    return resolveImageSrc(url, mediaDir) || url;
  }
  return url;
}

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

function preprocessLocalImageLines(text: string, mediaDir = ""): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (
        trimmed &&
        !trimmed.startsWith("!") &&
        isImagePath(trimmed) &&
        (isLocalPath(trimmed) || (mediaDir && !/^[a-z]+:/i.test(trimmed)))
      ) {
        const url = resolveImageSrc(trimmed, mediaDir) || trimmed;
        return `${line.slice(0, line.indexOf(trimmed))}![${trimmed}](${url})`;
      }
      return line;
    })
    .join("\n");
}

function CardRenderer({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="result-card-grid">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="result-card-row">
          <span className="result-card-key">{key}</span>
          <span className="result-card-value">{String(value)}</span>
        </div>
      ))}
    </div>
  );
}

function TableRenderer({ data }: { data: Record<string, unknown>[] }) {
  if (data.length === 0) return <div className="tool-result-text">No data</div>;
  const columns = Object.keys(data[0]);
  return (
    <div className="result-table-wrapper">
      <table className="result-table">
        <thead>
          <tr>{columns.map(c => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>{columns.map(c => <td key={c}>{String(row[c] ?? "")}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ToolResultCard({ event }: { event: ToolResultEvent }) {
  let parsed: unknown = null;
  try { parsed = JSON.parse(event.result); } catch { /* not JSON */ }

  return (
    <div className="tool-result-card">
      <div className="tool-result-header">
        <Zap size={14} />
        <span>{event.name}</span>
      </div>
      <div className="tool-result-body">
        {event.renderer === "card" && parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? <CardRenderer data={parsed as Record<string, unknown>} />
          : event.renderer === "table" && Array.isArray(parsed)
          ? <TableRenderer data={parsed as Record<string, unknown>[]} />
          : event.renderer === "markdown"
          ? renderMarkdown(event.result)
          : <pre className="tool-result-text">{event.result}</pre>
        }
      </div>
    </div>
  );
}

function renderMarkdown(content: string, mediaDir = "") {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeHighlight, rehypeKatex]}
      urlTransform={(url) => transformMarkdownUrl(url, mediaDir)}
      components={{
        img: ({ src, alt, ...props }) => (
          <img
            {...props}
            src={resolveImageSrc(src, mediaDir)}
            alt={alt || ""}
            loading="lazy"
          />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function renderMessageContent(msg: Message, mediaDir: string) {
  const contentWithMedia = msg.role === "agent" && mediaDir
    ? preprocessMediaMarkers(msg.content, mediaDir)
    : msg.content;
  const content = preprocessLocalImageLines(contentWithMedia, mediaDir);

  return renderMarkdown(content, mediaDir);
}

interface PluginManifest {
  id: string;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  version: string;
  author: string;
  icon: string;
  type: "builtin" | "http";
  tool: Record<string, unknown>;
  endpoint: string | null;
  slots?: { tool_result?: { renderer: string }; page?: { icon: string; label: { zh: string; en: string } } };
  lab?: boolean;
}

const ICON_MAP: Record<string, React.ComponentType<{ size?: number }>> = {
  cloud: Cloud,
  search: Search,
  code: Code,
  languages: Languages,
  newspaper: Newspaper,
  bot: Bot,
  "pen-tool": PenTool,
  users: Users,
};

function applyTheme(theme: Theme) {
  if (theme === "system") {
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

const ROLE_COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#14b8a6', '#ec4899', '#eab308'];

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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activePage, setActivePage] = useState<string | null>(null);
  const [roundtableTopic, setRoundtableTopic] = useState("");
  const [roundtableBackstage, setRoundtableBackstage] = useState<{ name: string; trait: string }[]>(() => {
    try {
      const saved = localStorage.getItem("webot-roundtable-backstage");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [roundtableOnStage, setRoundtableOnStage] = useState<{ name: string; trait: string }[]>(() => {
    try {
      const saved = localStorage.getItem("webot-roundtable-onstage");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [roundtableSpeakers, setRoundtableSpeakers] = useState<{ round: number; role: string; content: string; color: string }[]>([]);
  const [roundtableRunning, setRoundtableRunning] = useState(false);
  const [roundtableResult, setRoundtableResult] = useState<string | null>(null);
  const [roundtablePanelOpen, setRoundtablePanelOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; plugin: PluginManifest } | null>(null);
  const [showPluginInfo, setShowPluginInfo] = useState<PluginManifest | null>(null);
  const [wechatMessages, setWechatMessages] = useState<{ from: string; text: string; time: string }[]>([]);
  const [showWechatLog, setShowWechatLog] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    base_url: "", model: "", api_key: "", system_prompt: "", max_context_messages: 20,
  });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [marketplacePlugins, setMarketplacePlugins] = useState<PluginManifest[]>([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState(false);
  const [installedPlugins, setInstalledPlugins] = useState<PluginManifest[]>([]);
  const [marketplaceSearch, setMarketplaceSearch] = useState("");

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
    const unlistenSpeaker = listen<{ round: number; role: string; status: string; content?: string; delta?: string }>("roundtable-speaker", event => {
      const { round, role, status, content, delta } = event.payload;

      if (status === "start") {
        setRoundtableSpeakers(prev => {
          const existingRoles = [...new Set(prev.map(s => s.role))];
          const colorIndex = existingRoles.includes(role) ? existingRoles.indexOf(role) : existingRoles.length;
          return [...prev, { round, role, content: "", color: ROLE_COLORS[colorIndex % ROLE_COLORS.length] }];
        });
      } else if (status === "streaming" && delta) {
        setRoundtableSpeakers(prev => {
          const updated = [...prev];
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].role === role && updated[i].round === round) {
              updated[i] = { ...updated[i], content: updated[i].content + delta };
              break;
            }
          }
          return updated;
        });
      } else if (status === "done" && content) {
        setRoundtableSpeakers(prev => {
          const updated = [...prev];
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].role === role && updated[i].round === round) {
              updated[i] = { ...updated[i], content };
              break;
            }
          }
          return updated;
        });
      }
    });
    const unlistenDone = listen<{ result: string }>("roundtable-done", event => {
      setRoundtableRunning(false);
      setRoundtableResult(event.payload.result);
    });
    return () => { unlistenSpeaker.then(fn => fn()); unlistenDone.then(fn => fn()); };
  }, []);

  useEffect(() => {
    localStorage.setItem("webot-roundtable-backstage", JSON.stringify(roundtableBackstage));
  }, [roundtableBackstage]);

  useEffect(() => {
    localStorage.setItem("webot-roundtable-onstage", JSON.stringify(roundtableOnStage));
  }, [roundtableOnStage]);

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

  const loadInstalledPlugins = useCallback(async () => {
    try {
      const plugins = await invoke<PluginManifest[]>("get_installed_plugins");
      setInstalledPlugins(plugins);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadInstalledPlugins(); }, [loadInstalledPlugins]);

  const openMarketplace = useCallback(async () => {
    setShowMarketplace(true);
    setMarketplaceLoading(true);
    setMarketplaceError(false);
    try {
      const plugins = await invoke<PluginManifest[]>("fetch_marketplace");
      setMarketplacePlugins(plugins);
    } catch {
      setMarketplacePlugins([]);
      setMarketplaceError(true);
    }
    setMarketplaceLoading(false);
  }, []);

  const handleInstall = useCallback(async (plugin: PluginManifest) => {
    await invoke("install_plugin", { plugin });
    await loadInstalledPlugins();
  }, [loadInstalledPlugins]);

  const handleUninstall = useCallback(async (pluginId: string) => {
    await invoke("uninstall_plugin", { pluginId });
    await loadInstalledPlugins();
  }, [loadInstalledPlugins]);

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

      const unlistenToolCall = await listen<{ name: string; arguments: Record<string, unknown> }>("chat-tool-call", (event) => {
        const argsPreview = Object.entries(event.payload.arguments)
          .map(([k, v]) => `${k}: ${String(v)}`)
          .join(", ");
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = {
            ...last,
            content: last.content + `\n[调用工具: ${event.payload.name}(${argsPreview})]\n`,
          };
          return updated;
        });
      });

      const unlistenToolResult = await listen<ToolResultEvent>("chat-tool-result", (event) => {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = {
            ...last,
            toolResults: [...(last.toolResults || []), event.payload],
          };
          return updated;
        });
      });

      const unlistenRoundtable = await listen<{ round: number; role: string; status: string; content?: string }>("roundtable-speaker", (event) => {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          const payload = event.payload;
          if (payload.status === "speaking") {
            updated[updated.length - 1] = {
              ...last,
              content: last.content + `\n> **${payload.role}** 正在发言... (第${payload.round}轮)\n`,
            };
          } else if (payload.status === "done" && payload.content) {
            updated[updated.length - 1] = {
              ...last,
              content: last.content.replace(
                `\n> **${payload.role}** 正在发言... (第${payload.round}轮)\n`,
                `\n**${payload.role}**：${payload.content}\n`
              ),
            };
          }
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
        unlistenToolCall();
        unlistenToolResult();
        unlistenRoundtable();
        unlistenText();
        unlistenDone();
        unlistenError();
      };

      const toolIds = installedPlugins.length > 0 ? installedPlugins.map(p => p.id) : undefined;
      await invoke("start_chat", { message: userMessage, toolIds });
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
          <button className="qr-header-btn" onClick={openQrModal} title={t("tooltipWechatLogin")}
            onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, plugin: { id: "wechat-qr", name: { zh: "微信登录", en: "WeChat Login" }, description: { zh: t("tooltipWechatLogin"), en: t("tooltipWechatLogin") }, version: "-", author: "Webot Team", icon: "qr-code", type: "builtin", slots: undefined, lab: true } }); }}>
            <QrCode size={20} />
          </button>
          <button className="settings-header-btn" onClick={openMarketplace} title={t("marketplaceTitle")}
            onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, plugin: { id: "marketplace", name: { zh: "插件市场", en: "Plugin Marketplace" }, description: { zh: t("marketplaceTitle"), en: t("marketplaceTitle") }, version: "-", author: "Webot Team", icon: "store", type: "builtin", slots: undefined, lab: true } }); }}>
            <Store size={20} />
          </button>
          <button className={`settings-header-btn ${sidebarOpen ? "active" : ""}`} onClick={() => setSidebarOpen(!sidebarOpen)} title={t("sidebarTitle")}
            onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, plugin: { id: "sidebar", name: { zh: "插件面板", en: "Plugin Panel" }, description: { zh: t("sidebarTitle"), en: t("sidebarTitle") }, version: "-", author: "Webot Team", icon: "layout-dashboard", type: "builtin", slots: undefined, lab: true } }); }}>
            <LayoutDashboard size={20} />
          </button>
          {installedPlugins
            .filter(p => p.slots?.page)
            .map(plugin => {
              const PageIcon = ICON_MAP[plugin.slots!.page!.icon] || Sparkles;
              return (
                <button
                  key={plugin.id}
                  className={`settings-header-btn ${activePage === plugin.id ? "active" : ""}`}
                  onClick={() => setActivePage(activePage === plugin.id ? null : plugin.id)}
                  onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, plugin }); }}
                  title={plugin.slots!.page!.label[lang]}
                >
                  <PageIcon size={20} />
                </button>
              );
            })}
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

      {showMarketplace && (
        <div className="qr-modal-overlay" onClick={() => setShowMarketplace(false)}>
          <div className="qr-modal marketplace-modal" onClick={e => e.stopPropagation()}>
            <button className="qr-modal-close" onClick={() => setShowMarketplace(false)}>
              <X size={18} />
            </button>
            <h3 className="qr-modal-title">{t("marketplaceTitle")}</h3>
            <input
              className="marketplace-search"
              type="text"
              placeholder={t("marketplaceSearch")}
              value={marketplaceSearch}
              onChange={e => setMarketplaceSearch(e.target.value)}
            />
            {marketplaceLoading ? (
              <div className="marketplace-loading">
                <Loader2 size={28} className="spinner" />
                <span>{t("marketplaceLoading")}</span>
              </div>
            ) : marketplaceError ? (
              <div className="marketplace-error">{t("marketplaceError")}</div>
            ) : (
              <>
                {marketplaceSearch === "" && (() => {
                  const labPlugins = marketplacePlugins.filter(p => p.lab);
                  if (labPlugins.length === 0) return null;
                  return (
                    <div className="lab-section">
                      <div className="lab-header">
                        <Sparkles size={14} />
                        <span>{t("labTitle")}</span>
                      </div>
                      <div className="lab-grid">
                        {labPlugins.map(plugin => {
                          const IconComp = ICON_MAP[plugin.icon] || Sparkles;
                          const installed = installedPlugins.some(p => p.id === plugin.id);
                          return (
                            <div key={plugin.id} className="lab-card">
                              <div className="lab-card-icon">
                                <IconComp size={20} />
                              </div>
                              <div className="lab-card-info">
                                <div className="lab-card-name">{plugin.name[lang]}</div>
                                <div className="lab-card-desc">{plugin.description[lang]}</div>
                              </div>
                              {installed ? (
                                <button className="marketplace-installed-badge" onClick={() => handleUninstall(plugin.id)}>
                                  {t("marketplaceInstalled")}
                                </button>
                              ) : (
                                <button className="lab-install-btn" onClick={() => handleInstall(plugin)}>
                                  {t("marketplaceInstall")}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
                <div className="marketplace-grid">
                  {marketplacePlugins.length === 0 ? (
                    <div className="marketplace-error">{t("marketplaceEmpty")}</div>
                  ) : (
                    marketplacePlugins
                      .filter(p =>
                        p.name[lang].toLowerCase().includes(marketplaceSearch.toLowerCase()) ||
                        p.description[lang].toLowerCase().includes(marketplaceSearch.toLowerCase())
                      )
                      .map(plugin => {
                        const IconComp = ICON_MAP[plugin.icon] || Sparkles;
                        const installed = installedPlugins.some(p => p.id === plugin.id);
                        return (
                          <div key={plugin.id} className="marketplace-card">
                            <div className="marketplace-card-icon">
                              <IconComp size={22} />
                            </div>
                            <div className="marketplace-card-info">
                              <div className="marketplace-card-name">{plugin.name[lang]}</div>
                              <div className="marketplace-card-desc">{plugin.description[lang]}</div>
                            </div>
                            {installed ? (
                              <button className="marketplace-installed-badge" onClick={() => handleUninstall(plugin.id)}>
                                {t("marketplaceUninstall")}
                              </button>
                            ) : (
                              <button className="marketplace-install-btn" onClick={() => handleInstall(plugin)}>
                                {t("marketplaceInstall")}
                              </button>
                            )}
                          </div>
                        );
                      })
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {sidebarOpen && (
        <aside className="plugin-sidebar">
          <div className="sidebar-header">
            <h3>{t("sidebarPlugins")}</h3>
            <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)}>
              <X size={16} />
            </button>
          </div>
          <div className="sidebar-plugin-list">
            {installedPlugins.length === 0 ? (
              <div className="sidebar-empty">{t("sidebarNoPlugins")}</div>
            ) : (
              installedPlugins.map(plugin => {
                const IconComp = ICON_MAP[plugin.icon] || Sparkles;
                return (
                  <div key={plugin.id} className="sidebar-plugin-item">
                    <div className="sidebar-plugin-icon">
                      <IconComp size={18} />
                    </div>
                    <div className="sidebar-plugin-info">
                      <div className="sidebar-plugin-name">{plugin.name[lang]}</div>
                      <div className="sidebar-plugin-status">
                        <span className="status-dot active" />
                        {t("sidebarActive")}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="sidebar-history">
            <div className="sidebar-history-title">{t("sidebarHistory")}</div>
            {messages
              .flatMap((msg, mi) => (msg.toolResults || []).map(tr => ({ ...tr, msgIndex: mi })))
              .slice(-10)
              .reverse()
              .map((tr, i) => (
                <div key={i} className="sidebar-history-item">
                  <span className="sidebar-history-tool">{tr.name}</span>
                  <span className="sidebar-history-time">#{tr.msgIndex + 1}</span>
                </div>
              ))
            }
          </div>
        </aside>
      )}

      {activePage === "roundtable" && (
        <div className="roundtable-page">
          <div className="roundtable-page-header">
            <h3>{t("roundtableTitle")}</h3>
            <div className="roundtable-header-actions">
              <input
                className="roundtable-topic-input"
                type="text"
                placeholder={t("roundtableTopicPlaceholder")}
                value={roundtableTopic}
                onChange={e => setRoundtableTopic(e.target.value)}
                disabled={roundtableRunning}
              />
              <button
                className="roundtable-start-btn"
                disabled={roundtableRunning || !roundtableTopic.trim()}
                onClick={async () => {
                  setRoundtableRunning(true);
                  setRoundtableSpeakers([]);
                  setRoundtableResult(null);
                  const roleNames = roundtableOnStage.filter(r => r.name.trim()).map(r => {
                    const trait = r.trait.trim();
                    return trait ? `${r.name.trim()}（${trait}）` : r.name.trim();
                  });
                  await invoke("start_roundtable", {
                    topic: roundtableTopic.trim(),
                    roles: roleNames.length > 0 ? roleNames : null,
                  });
                }}
              >
                {roundtableRunning ? <Loader2 size={16} className="spinner" /> : t("roundtableStart")}
              </button>
            </div>
            <button className="sidebar-close-btn" onClick={() => { setActivePage(null); setRoundtableRunning(false); setRoundtableSpeakers([]); setRoundtableResult(null); }}>
              <X size={16} />
            </button>
          </div>
          <div className="roundtable-page-body">
            <div className="roundtable-main">
              <div className="roundtable-panel-toggle" onClick={() => setRoundtablePanelOpen(prev => !prev)}>
                <span className="roundtable-panel-arrow">{roundtablePanelOpen ? "▾" : "▸"}</span>
                <span className="roundtable-panel-summary">
                  {t("roundtableOnStage")} {roundtableOnStage.length} · {t("roundtableBackstage")} {roundtableBackstage.length}
                </span>
                {!roundtableRunning && (
                  <button className="roundtable-panel-add" onClick={e => { e.stopPropagation(); setRoundtableBackstage(prev => [...prev, { name: "", trait: "" }]); setRoundtablePanelOpen(true); }}>
                    +
                  </button>
                )}
              </div>
              {roundtablePanelOpen && (
                <div className="roundtable-panel-body">
                  <div className="roundtable-role-rail"
                    onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("drag-over"); }}
                    onDragLeave={e => { e.currentTarget.classList.remove("drag-over"); }}
                    onDrop={e => {
                      e.preventDefault();
                      e.currentTarget.classList.remove("drag-over");
                      const data = e.dataTransfer.getData("text/plain");
                      if (!data) return;
                      const [source, idxStr] = data.split(":");
                      const idx = parseInt(idxStr, 10);
                      if (source === "onstage" && !roundtableRunning) {
                        const role = roundtableOnStage[idx];
                        if (role) {
                          setRoundtableOnStage(prev => prev.filter((_, j) => j !== idx));
                          setRoundtableBackstage(prev => [...prev, role]);
                        }
                      }
                    }}
                  >
                    {roundtableOnStage.map((role, i) => (
                      <div
                        key={"on-" + i}
                        className="roundtable-role-tag onstage"
                        style={{ borderColor: ROLE_COLORS[i % ROLE_COLORS.length] }}
                        draggable={!roundtableRunning}
                        onDragStart={e => { e.dataTransfer.setData("text/plain", "onstage:" + i); e.dataTransfer.effectAllowed = "move"; }}
                      >
                        <div className="roundtable-role-tag-avatar" style={{ background: ROLE_COLORS[i % ROLE_COLORS.length] }}>{role.name[0] || "?"}</div>
                        <span className="roundtable-role-tag-name">{role.name}</span>
                        {!roundtableRunning && (
                          <button className="roundtable-role-tag-x" onClick={e => { e.stopPropagation(); setRoundtableOnStage(prev => prev.filter((_, j) => j !== i)); setRoundtableBackstage(prev => [...prev, role]); }}>×</button>
                        )}
                      </div>
                    ))}
                    {roundtableBackstage.map((role, i) => (
                      <div
                        key={"off-" + i}
                        className="roundtable-role-tag backstage"
                        draggable={!roundtableRunning && !!role.name.trim()}
                        onDragStart={e => { e.dataTransfer.setData("text/plain", "backstage:" + i); e.dataTransfer.effectAllowed = "move"; }}
                      >
                        {role.name.trim() ? (
                          <>
                            <div className="roundtable-role-tag-avatar off">{role.name[0]}</div>
                            <span className="roundtable-role-tag-name">{role.name}</span>
                            {!roundtableRunning && (
                              <button className="roundtable-role-tag-x" onClick={e => { e.stopPropagation(); setRoundtableBackstage(prev => prev.filter((_, j) => j !== i)); }}>×</button>
                            )}
                          </>
                        ) : (
                          <input
                            className="roundtable-role-tag-input"
                            type="text"
                            placeholder={t("roundtableRoleName")}
                            value={role.name}
                            onChange={e => setRoundtableBackstage(prev => prev.map((r, j) => j === i ? { ...r, name: e.target.value } : r))}
                            disabled={roundtableRunning}
                            autoFocus
                            onKeyDown={e => { if (e.key === "Enter" && role.name.trim()) { setRoundtableBackstage(prev => prev.filter((_, j) => j !== i)); setRoundtableOnStage(prev => [...prev, role]); } }}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="roundtable-discussion"
                onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("stage-drop-active"); }}
                onDragLeave={e => { e.currentTarget.classList.remove("stage-drop-active"); }}
                onDrop={e => {
                  e.preventDefault();
                  e.currentTarget.classList.remove("stage-drop-active");
                  const data = e.dataTransfer.getData("text/plain");
                  if (!data || roundtableRunning) return;
                  const [source, idxStr] = data.split(":");
                  const idx = parseInt(idxStr, 10);
                  if (source === "backstage") {
                    const role = roundtableBackstage[idx];
                    if (role) {
                      setRoundtableBackstage(prev => prev.filter((_, j) => j !== idx));
                      setRoundtableOnStage(prev => [...prev, role]);
                    }
                  }
                }}
              >
                {roundtableSpeakers.length === 0 && !roundtableResult && (
                  <div className="roundtable-empty">
                    <Users size={48} />
                    <p>{t("roundtableEmpty")}</p>
                  </div>
                )}
                {roundtableSpeakers.map((speaker, i) => (
                  <div key={i} className="roundtable-speaker-card" style={{ borderLeftColor: speaker.color }}>
                    <div className="roundtable-speaker-header">
                      <div className="roundtable-speaker-avatar" style={{ background: speaker.color }}>{speaker.role[0]}</div>
                      <span className="roundtable-speaker-name">{speaker.role}</span>
                      <span className="roundtable-speaker-round">R{speaker.round}</span>
                    </div>
                    <div className="roundtable-speaker-content">{speaker.content}</div>
                  </div>
                ))}
                {roundtableResult && (
                  <div className="roundtable-summary">
                    {renderMarkdown(roundtableResult)}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (() => {
        const isInstalledPlugin = installedPlugins.some(p => p.id === contextMenu.plugin.id);
        return (
          <div className="context-menu-overlay" onClick={() => setContextMenu(null)}>
            <div
              className="context-menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={e => e.stopPropagation()}
            >
              <button className="context-menu-item" onClick={() => { setShowPluginInfo(contextMenu.plugin); setContextMenu(null); }}>
                {t("contextPluginInfo")}
              </button>
              {isInstalledPlugin && (
                <button className="context-menu-item danger" onClick={async () => {
                  const id = contextMenu.plugin.id;
                  setContextMenu(null);
                  await handleUninstall(id);
                  if (activePage === id) setActivePage(null);
                }}>
                  {t("contextUninstall")}
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {showPluginInfo && (
        <div className="qr-modal-overlay" onClick={() => setShowPluginInfo(null)}>
          <div className="qr-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <button className="qr-modal-close" onClick={() => setShowPluginInfo(null)}>
              <X size={18} />
            </button>
            <h3 className="qr-modal-title">{showPluginInfo.name[lang]}</h3>
            <div className="plugin-info-content">
              <div className="plugin-info-row"><span className="plugin-info-label">{t("infoId")}</span><span>{showPluginInfo.id}</span></div>
              <div className="plugin-info-row"><span className="plugin-info-label">{t("infoVersion")}</span><span>{showPluginInfo.version}</span></div>
              <div className="plugin-info-row"><span className="plugin-info-label">{t("infoAuthor")}</span><span>{showPluginInfo.author}</span></div>
              <div className="plugin-info-row"><span className="plugin-info-label">{t("infoType")}</span><span>{showPluginInfo.type}</span></div>
              <div className="plugin-info-desc">{showPluginInfo.description[lang]}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
