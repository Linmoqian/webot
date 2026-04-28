import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type Lang = "zh" | "en";
export type Theme = "light" | "dark" | "system";

const translations: Record<Lang, Record<string, string>> = {
  zh: {
    heroTitle: "今天能帮您解答些什么？",
    heroSubtitle: "Nexus AI 拥有深度思考能力，能够洞察复杂问题。",
    settingsTitle: "设置",
    sectionModel: "模型设置",
    labelBaseUrl: "Base URL",
    labelModel: "模型",
    labelApiKey: "API Key",
    labelSystemPrompt: "系统提示词",
    labelContextMessages: "上下文消息数",
    sectionAppearance: "外观",
    labelTheme: "主题",
    themeLight: "浅色",
    themeDark: "深色",
    themeSystem: "跟随系统",
    labelLanguage: "语言",
    btnSave: "保存",
    senderUser: "你",
    senderBot: "Nexus",
    thinkingProcess: "思考过程",
    thinkingActive: "正在思考",
    inputPlaceholder: "输入任何问题...",
    inputFooter: "Nexus AI 可能会犯错，请核实重要信息。",
    errorPrefix: "错误",
    connectionError: "连接失败，请检查后端",
    qrTitle: "微信扫码登录",
    qrLoading: "获取二维码中...",
    qrHint: "请使用微信扫描二维码",
    qrScanned: "已扫描，请在手机上确认登录",
    qrConfirmed: "登录成功",
    qrExpired: "二维码已过期",
    qrRefresh: "刷新二维码",
    qrError: "获取二维码失败",
    qrRetry: "重试",
    qrNoData: "未获取到二维码数据",
    wechatLogTitle: "微信消息日志",
    noMessages: "暂无消息",
    wechatNotConnected: "未连接微信",
    tooltipWechatLogin: "微信登录",
    tooltipSettings: "设置",
    tooltipWechatLog: "微信消息日志",
    tooltipWechatNotConnected: "未连接微信",
  },
  en: {
    heroTitle: "What can I help you with today?",
    heroSubtitle: "Nexus AI has deep thinking capabilities to understand complex problems.",
    settingsTitle: "Settings",
    sectionModel: "Model",
    labelBaseUrl: "Base URL",
    labelModel: "Model",
    labelApiKey: "API Key",
    labelSystemPrompt: "System Prompt",
    labelContextMessages: "Context Messages",
    sectionAppearance: "Appearance",
    labelTheme: "Theme",
    themeLight: "Light",
    themeDark: "Dark",
    themeSystem: "System",
    labelLanguage: "Language",
    btnSave: "Save",
    senderUser: "You",
    senderBot: "Nexus",
    thinkingProcess: "Thought Process",
    thinkingActive: "Thinking Process",
    inputPlaceholder: "Ask anything...",
    inputFooter: "Nexus AI can make mistakes. Consider verifying critical information.",
    errorPrefix: "Error",
    connectionError: "Connection failed, please check the backend",
    qrTitle: "Scan to Login with WeChat",
    qrLoading: "Loading QR code...",
    qrHint: "Please scan with WeChat",
    qrScanned: "Scanned, please confirm on your phone",
    qrConfirmed: "Login successful",
    qrExpired: "QR code expired",
    qrRefresh: "Refresh QR Code",
    qrError: "Failed to get QR code",
    qrRetry: "Retry",
    qrNoData: "No QR code data received",
    wechatLogTitle: "WeChat Message Log",
    noMessages: "No messages yet",
    wechatNotConnected: "WeChat not connected",
    tooltipWechatLogin: "WeChat Login",
    tooltipSettings: "Settings",
    tooltipWechatLog: "WeChat Message Log",
    tooltipWechatNotConnected: "WeChat not connected",
  },
};

interface I18nContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextType>(null!);

const LANG_KEY = "webot-lang";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangInner] = useState<Lang>(
    () => (localStorage.getItem(LANG_KEY) as Lang) || "zh"
  );

  const setLang = useCallback((l: Lang) => {
    setLangInner(l);
    localStorage.setItem(LANG_KEY, l);
  }, []);

  const t = useCallback(
    (key: string) => translations[lang][key] ?? key,
    [lang]
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
