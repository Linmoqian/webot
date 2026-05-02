import { X, MessageCircle } from "lucide-react";
import { useI18n } from "../i18n";

interface WeChatLogModalProps {
  open: boolean;
  onClose: () => void;
  wechatConnected: boolean;
  wechatMessages: { from: string; text: string; time: string }[];
}

export function WeChatLogModal({ open, onClose, wechatConnected, wechatMessages }: WeChatLogModalProps) {
  const { t } = useI18n();

  if (!open) return null;

  return (
    <div className="qr-modal-overlay" onClick={onClose}>
      <div className="qr-modal wechat-log-modal" onClick={e => e.stopPropagation()}>
        <button className="qr-modal-close" onClick={onClose}>
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
  );
}
