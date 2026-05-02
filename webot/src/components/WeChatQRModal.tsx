import { useState, useRef, useCallback } from "react";
import { Loader2, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "../i18n";

interface WeChatQRModalProps {
  open: boolean;
  onClose: () => void;
}

export function WeChatQRModal({ open, onClose }: WeChatQRModalProps) {
  const { t } = useI18n();
  const [qrData, setQrData] = useState("");
  const [qrStatus, setQrStatus] = useState<"loading" | "waiting" | "scanned" | "confirmed" | "expired" | "error">("loading");
  const [qrError, setQrError] = useState("");
  const qrIdRef = useRef("");
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPoll = useCallback(() => {
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
          stopPoll();
          const token = data.bot_token || "";
          if (token) {
            invoke("save_wechat_token", { token, baseUrl: data.baseurl || null })
              .then(() => invoke("start_wechat_listener"))
              .catch(() => {});
          }
          setTimeout(() => onClose(), 800);
        } else if (status === "expired") {
          setQrStatus("expired");
          stopPoll();
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
  }, [stopPoll, onClose]);

  const fetchQr = useCallback(() => {
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

  const handleClose = useCallback(() => {
    stopPoll();
    onClose();
    setQrData("");
    qrIdRef.current = "";
  }, [stopPoll, onClose]);

  if (!open) return null;

  return (
    <div className="qr-modal-overlay" onClick={handleClose}>
      <div className="qr-modal" onClick={e => e.stopPropagation()}>
        <button className="qr-modal-close" onClick={handleClose}>
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
              <button className="qr-refresh-btn" onClick={fetchQr}>{t("qrRefresh")}</button>
            </div>
          )}
          {qrStatus === "error" && (
            <div className="qr-status-info error">
              <p>{qrError || t("qrError")}</p>
              <button className="qr-refresh-btn" onClick={fetchQr}>{t("qrRetry")}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
