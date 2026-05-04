import { QrCode, Settings, Store, LayoutDashboard, Sparkles } from "lucide-react";
import { useI18n } from "../i18n";
import { ICON_MAP } from "../constants";
import type { PluginManifest } from "../types";

interface HeaderProps {
  wechatConnected: boolean;
  sidebarOpen: boolean;
  installedPlugins: PluginManifest[];
  activePage: string | null;
  onOpenQr: () => void;
  onOpenSettings: () => void;
  onOpenMarketplace: () => void;
  onOpenWechatLog: () => void;
  onToggleSidebar: () => void;
  onSetActivePage: (page: string | null) => void;
  onContextMenu: (e: React.MouseEvent, plugin: PluginManifest) => void;
}

export function Header({
  wechatConnected,
  sidebarOpen,
  installedPlugins,
  activePage,
  onOpenQr,
  onOpenSettings,
  onOpenMarketplace,
  onOpenWechatLog,
  onToggleSidebar,
  onSetActivePage,
  onContextMenu,
}: HeaderProps) {
  const { lang, t } = useI18n();

  return (
    <header className="app-header">
      <div className="header-brand">
        <div className="logo-box"><Sparkles size={20} className="logo-icon" /></div>
        <h2>Yunfeng</h2>
        <span className="badge">Beta</span>
      </div>
      <button className="qr-header-btn" onClick={onOpenQr} title={t("tooltipWechatLogin")}
        onContextMenu={e => { e.preventDefault(); onContextMenu(e, { id: "wechat-qr", name: { zh: "微信登录", en: "WeChat Login" }, description: { zh: t("tooltipWechatLogin"), en: t("tooltipWechatLogin") }, version: "-", author: "Webot Team", icon: "qr-code", type: "builtin", tool: {}, endpoint: null, slots: undefined, lab: true }); }}>
        <QrCode size={20} />
      </button>
      <button className="settings-header-btn" onClick={onOpenMarketplace} title={t("marketplaceTitle")}
        onContextMenu={e => { e.preventDefault(); onContextMenu(e, { id: "marketplace", name: { zh: "插件市场", en: "Plugin Marketplace" }, description: { zh: t("marketplaceTitle"), en: t("marketplaceTitle") }, version: "-", author: "Webot Team", icon: "store", type: "builtin", tool: {}, endpoint: null, slots: undefined, lab: true }); }}>
        <Store size={20} />
      </button>
      <button className={`settings-header-btn ${sidebarOpen ? "active" : ""}`} onClick={onToggleSidebar} title={t("sidebarTitle")}
        onContextMenu={e => { e.preventDefault(); onContextMenu(e, { id: "sidebar", name: { zh: "插件面板", en: "Plugin Panel" }, description: { zh: t("sidebarTitle"), en: t("sidebarTitle") }, version: "-", author: "Webot Team", icon: "layout-dashboard", type: "builtin", tool: {}, endpoint: null, slots: undefined, lab: true }); }}>
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
              onClick={() => onSetActivePage(activePage === plugin.id ? null : plugin.id)}
              onContextMenu={e => { e.preventDefault(); onContextMenu(e, plugin); }}
              title={plugin.slots!.page!.label[lang]}
            >
              <PageIcon size={20} />
            </button>
          );
        })}
      <button className="settings-header-btn" onClick={onOpenSettings} title={t("tooltipSettings")}>
        <Settings size={20} />
      </button>
      <button
        className={`wechat-toggle-btn ${wechatConnected ? "connected" : ""}`}
        onClick={onOpenWechatLog}
        title={wechatConnected ? t("tooltipWechatLog") : t("tooltipWechatNotConnected")}
      >
        <span className="wechat-dot" />
      </button>
    </header>
  );
}
