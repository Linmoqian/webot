import { useState, useCallback, useEffect } from "react";
import { Loader2, X, Sparkles } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "../i18n";
import { ICON_MAP } from "../constants";
import type { PluginManifest } from "../types";

interface MarketplaceModalProps {
  open: boolean;
  onClose: () => void;
  installedPlugins: PluginManifest[];
  onInstall: (plugin: PluginManifest) => Promise<void>;
  onUninstall: (pluginId: string) => Promise<void>;
}

export function MarketplaceModal({ open, onClose, installedPlugins, onInstall, onUninstall }: MarketplaceModalProps) {
  const { lang, t } = useI18n();
  const [marketplacePlugins, setMarketplacePlugins] = useState<PluginManifest[]>([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState(false);
  const [marketplaceSearch, setMarketplaceSearch] = useState("");

  const fetchMarketplace = useCallback(async () => {
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

  useEffect(() => {
    if (open) fetchMarketplace();
  }, [open, fetchMarketplace]);

  if (!open) return null;

  return (
    <div className="qr-modal-overlay" onClick={onClose}>
      <div className="qr-modal marketplace-modal" onClick={e => e.stopPropagation()}>
        <button className="qr-modal-close" onClick={onClose}>
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
                            <button className="marketplace-installed-badge" onClick={() => onUninstall(plugin.id)}>
                              {t("marketplaceInstalled")}
                            </button>
                          ) : (
                            <button className="lab-install-btn" onClick={() => onInstall(plugin)}>
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
                          <button className="marketplace-installed-badge" onClick={() => onUninstall(plugin.id)}>
                            {t("marketplaceUninstall")}
                          </button>
                        ) : (
                          <button className="marketplace-install-btn" onClick={() => onInstall(plugin)}>
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
  );
}
