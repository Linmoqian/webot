import { useState, useCallback, useEffect } from "react";
import { Loader2, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n, type Theme } from "../i18n";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

export function SettingsModal({ open, onClose, theme, onThemeChange }: SettingsModalProps) {
  const { lang, setLang, t } = useI18n();
  const [settingsForm, setSettingsForm] = useState({
    base_url: "", model: "", api_key: "", system_prompt: "", max_context_messages: 20,
  });
  const [settingsSaving, setSettingsSaving] = useState(false);

  const loadSettings = useCallback(() => {
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
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (open) loadSettings();
  }, [open, loadSettings]);

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
        onClose();
      }).catch(() => setSettingsSaving(false));
    }).catch(() => setSettingsSaving(false));
  }, [settingsForm, onClose]);

  const themeOptions: { value: Theme; label: string }[] = [
    { value: "light", label: t("themeLight") },
    { value: "dark", label: t("themeDark") },
    { value: "system", label: t("themeSystem") },
  ];

  if (!open) return null;

  return (
    <div className="qr-modal-overlay" onClick={onClose}>
      <div className="qr-modal settings-modal" onClick={e => e.stopPropagation()}>
        <button className="qr-modal-close" onClick={onClose}>
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
                  onClick={() => onThemeChange(opt.value)}
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
  );
}
