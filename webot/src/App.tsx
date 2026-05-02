import { useState, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useI18n, type Theme } from "./i18n";
import { applyTheme } from "./constants";
import { Header } from "./components/Header";
import { ChatPanel } from "./components/ChatPanel";
import { WeChatQRModal } from "./components/WeChatQRModal";
import { WeChatLogModal } from "./components/WeChatLogModal";
import { SettingsModal } from "./components/SettingsModal";
import { MarketplaceModal } from "./components/MarketplaceModal";
import { PluginSidebar } from "./components/PluginSidebar";
import { RoundtablePage } from "./components/RoundtablePage";
import type { PluginManifest } from "./types";

const THEME_KEY = "webot-theme";

declare global {
  interface Window {
    webotDebugBus?: {
      emit: (type: string, payload?: unknown) => void;
    };
  }
}

function App() {
  const { lang, t } = useI18n();

  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(THEME_KEY) as Theme) || "system"
  );
  const setTheme = useCallback((t: Theme) => setThemeState(t), []);

  const [activePage, setActivePage] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [showWechatLog, setShowWechatLog] = useState(false);

  const [wechatConnected, setWechatConnected] = useState(false);
  const [wechatMessages, setWechatMessages] = useState<{ from: string; text: string; time: string }[]>([]);

  const [installedPlugins, setInstalledPlugins] = useState<PluginManifest[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; plugin: PluginManifest } | null>(null);
  const [showPluginInfo, setShowPluginInfo] = useState<PluginManifest | null>(null);

  const [toolCallHistory, setToolCallHistory] = useState<{ name: string; msgIndex: number }[]>([]);

  useEffect(() => {
    window.webotDebugBus = {
      emit: (type, payload) => {
        window.dispatchEvent(new CustomEvent("webot-debug", { detail: { type, payload, at: Date.now() } }));
      },
    };
    window.webotDebugBus.emit("app:ready", { page: activePage });
    return () => { delete window.webotDebugBus; };
  }, [activePage]);

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

  const loadInstalledPlugins = useCallback(async () => {
    try {
      const plugins = await invoke<PluginManifest[]>("get_installed_plugins");
      setInstalledPlugins(plugins);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadInstalledPlugins(); }, [loadInstalledPlugins]);

  const handleInstall = useCallback(async (plugin: PluginManifest) => {
    await invoke("install_plugin", { plugin });
    await loadInstalledPlugins();
  }, [loadInstalledPlugins]);

  const handleUninstall = useCallback(async (pluginId: string) => {
    await invoke("uninstall_plugin", { pluginId });
    await loadInstalledPlugins();
    if (activePage === pluginId) setActivePage(null);
  }, [loadInstalledPlugins, activePage]);

  const handleContextMenu = useCallback((e: React.MouseEvent, plugin: PluginManifest) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, plugin });
  }, []);

  const handleToolResult = useCallback((event: { name: string; msgIndex: number }) => {
    setToolCallHistory(prev => [...prev.slice(-19), event]);
  }, []);

  return (
    <div className="layout-container">
      <div className="main-content">
        <Header
          wechatConnected={wechatConnected}
          sidebarOpen={sidebarOpen}
          installedPlugins={installedPlugins}
          activePage={activePage}
          onOpenQr={() => setShowQrModal(true)}
          onOpenSettings={() => setShowSettingsModal(true)}
          onOpenMarketplace={() => setShowMarketplace(true)}
          onOpenWechatLog={() => setShowWechatLog(true)}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onSetActivePage={setActivePage}
          onContextMenu={handleContextMenu}
        />
        <ChatPanel installedPlugins={installedPlugins} onToolResult={handleToolResult} />
      </div>

      <WeChatQRModal open={showQrModal} onClose={() => setShowQrModal(false)} />
      <SettingsModal open={showSettingsModal} onClose={() => setShowSettingsModal(false)} theme={theme} onThemeChange={setTheme} />
      <WeChatLogModal open={showWechatLog} onClose={() => setShowWechatLog(false)} wechatConnected={wechatConnected} wechatMessages={wechatMessages} />
      <MarketplaceModal open={showMarketplace} onClose={() => setShowMarketplace(false)} installedPlugins={installedPlugins} onInstall={handleInstall} onUninstall={handleUninstall} />
      <PluginSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} installedPlugins={installedPlugins} toolCallHistory={toolCallHistory} />

      {activePage === "roundtable" && (
        <RoundtablePage onClose={() => setActivePage(null)} />
      )}

      {contextMenu && (() => {
        const isInstalled = installedPlugins.some(p => p.id === contextMenu.plugin.id);
        return (
          <div className="context-menu-overlay" onClick={() => setContextMenu(null)}>
            <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={e => e.stopPropagation()}>
              <button className="context-menu-item" onClick={() => { setShowPluginInfo(contextMenu.plugin); setContextMenu(null); }}>
                {t("contextPluginInfo")}
              </button>
              {isInstalled && (
                <button className="context-menu-item danger" onClick={async () => {
                  const id = contextMenu.plugin.id;
                  setContextMenu(null);
                  await handleUninstall(id);
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
