import { X, Sparkles } from "lucide-react";
import { useI18n } from "../i18n";
import { ICON_MAP } from "../constants";
import type { PluginManifest } from "../types";

interface PluginSidebarProps {
  open: boolean;
  onClose: () => void;
  installedPlugins: PluginManifest[];
  toolCallHistory: { name: string; msgIndex: number }[];
}

export function PluginSidebar({ open, onClose, installedPlugins, toolCallHistory }: PluginSidebarProps) {
  const { lang, t } = useI18n();

  if (!open) return null;

  return (
    <aside className="plugin-sidebar">
      <div className="sidebar-header">
        <h3>{t("sidebarPlugins")}</h3>
        <button className="sidebar-close-btn" onClick={onClose}>
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
        {toolCallHistory.map((tr, i) => (
          <div key={i} className="sidebar-history-item">
            <span className="sidebar-history-tool">{tr.name}</span>
            <span className="sidebar-history-time">#{tr.msgIndex + 1}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
