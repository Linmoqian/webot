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
    marketplaceTitle: "插件市场",
    marketplaceSearch: "搜索插件...",
    marketplaceInstall: "安装",
    marketplaceInstalled: "已安装",
    marketplaceLoading: "加载中...",
    marketplaceError: "获取插件列表失败",
    marketplaceEmpty: "暂无可用插件",
    marketplaceUninstall: "卸载",
    labTitle: "官方插件",
    pluginWeatherName: "天气查询",
    pluginWeatherDesc: "让 AI 实时查询全球城市天气信息",
    pluginSearchName: "网页搜索",
    pluginSearchDesc: "让 AI 搜索互联网获取最新信息",
    pluginCodeName: "代码执行",
    pluginCodeDesc: "让 AI 在沙箱中运行代码并返回结果",
    pluginTranslateName: "翻译助手",
    pluginTranslateDesc: "让 AI 进行高质量多语言翻译",
    pluginNewsName: "新闻摘要",
    pluginNewsDesc: "让 AI 抓取并总结最新新闻资讯",
    sidebarTitle: "插件面板",
    sidebarPlugins: "已安装插件",
    sidebarNoPlugins: "暂无已安装的插件",
    sidebarActive: "已启用",
    sidebarHistory: "工具调用历史",
    roundtableTitle: "圆桌会议",
    roundtableTopicPlaceholder: "输入讨论主题...",
    roundtableRoles: "参与角色（留空则自动分配）",
    roundtableRoleName: "角色名称",
    roundtableRoleTrait: "专业特点",
    roundtableAddRole: "添加角色",
    roundtableStart: "开始讨论",
    roundtableEmpty: "输入主题，邀请专家开始讨论",
    contextUninstall: "卸载",
    contextPluginInfo: "插件信息",
    infoId: "ID",
    infoVersion: "版本",
    infoAuthor: "作者",
    infoType: "类型",
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
    marketplaceTitle: "Plugin Marketplace",
    marketplaceSearch: "Search plugins...",
    marketplaceInstall: "Install",
    marketplaceInstalled: "Installed",
    marketplaceLoading: "Loading...",
    marketplaceError: "Failed to load plugins",
    marketplaceEmpty: "No plugins available",
    marketplaceUninstall: "Uninstall",
    labTitle: "Official Plugins",
    pluginWeatherName: "Weather Query",
    pluginWeatherDesc: "Let AI query real-time weather for any city",
    pluginSearchName: "Web Search",
    pluginSearchDesc: "Let AI search the internet for latest information",
    pluginCodeName: "Code Execution",
    pluginCodeDesc: "Let AI run code in a sandbox and return results",
    pluginTranslateName: "Translation",
    pluginTranslateDesc: "Let AI perform high-quality multi-language translation",
    pluginNewsName: "News Summary",
    pluginNewsDesc: "Let AI fetch and summarize the latest news",
    sidebarTitle: "Plugin Panel",
    sidebarPlugins: "Installed Plugins",
    sidebarNoPlugins: "No plugins installed",
    sidebarActive: "Active",
    sidebarHistory: "Tool Call History",
    roundtableTitle: "Roundtable Meeting",
    roundtableTopicPlaceholder: "Enter discussion topic...",
    roundtableRoles: "Participants (auto-assigned if empty)",
    roundtableRoleName: "Role name",
    roundtableRoleTrait: "Specialty",
    roundtableAddRole: "Add role",
    roundtableStart: "Start Discussion",
    roundtableEmpty: "Enter a topic and invite experts to discuss",
    contextUninstall: "Uninstall",
    contextPluginInfo: "Plugin Info",
    infoId: "ID",
    infoVersion: "Version",
    infoAuthor: "Author",
    infoType: "Type",
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
