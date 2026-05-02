import { useState, useRef, useEffect, useCallback, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Loader2, X, PenTool, Users, Trash2, Plus } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useI18n } from "../i18n";
import { ROLE_COLORS } from "../constants";
import { renderMarkdown } from "./Markdown";
import { getRoundtableRoleKey } from "../utils/roundtable";
import type { RoundtableRole, RoundtableRoleSource, RoundtableDropZone, RoundtablePointerDrag, RoundtableDragPayload } from "../types";

interface RoundtablePageProps {
  onClose: () => void;
}

interface RoundtableSpeaker {
  round: number;
  role: string;
  content: string;
  color: string;
}

interface RoundtableRecord {
  id: string;
  topic: string;
  speakers: RoundtableSpeaker[];
  result: string | null;
  createdAt: number;
}

export function RoundtablePage({ onClose }: RoundtablePageProps) {
  const { lang, t } = useI18n();

  const [topic, setTopic] = useState("");
  const [backstage, setBackstage] = useState<RoundtableRole[]>(() => {
    try {
      const saved = localStorage.getItem("webot-roundtable-backstage");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [onStage, setOnStage] = useState<RoundtableRole[]>(() => {
    try {
      const saved = localStorage.getItem("webot-roundtable-onstage");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [speakers, setSpeakers] = useState<RoundtableSpeaker[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<RoundtableRecord[]>(() => {
    try {
      const saved = localStorage.getItem("webot-roundtable-history");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [viewingHistory, setViewingHistory] = useState<RoundtableRecord | null>(null);
  const [roleContextMenu, setRoleContextMenu] = useState<{ x: number; y: number; source: RoundtableRoleSource; index: number } | null>(null);
  const [roleEditing, setRoleEditing] = useState<{ source: RoundtableRoleSource; index: number } | null>(null);
  const [flippedRoles, setFlippedRoles] = useState<Set<string>>(() => new Set());
  const [dropZone, setDropZone] = useState<RoundtableDropZone>(null);
  const [pointerDrag, setPointerDrag] = useState<RoundtablePointerDrag | null>(null);

  const topicRef = useRef(topic);
  const speakersRef = useRef(speakers);
  const pointerDragRef = useRef<RoundtablePointerDrag | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => { topicRef.current = topic; }, [topic]);
  useEffect(() => { speakersRef.current = speakers; }, [speakers]);

  useEffect(() => {
    localStorage.setItem("webot-roundtable-backstage", JSON.stringify(backstage));
  }, [backstage]);

  useEffect(() => {
    localStorage.setItem("webot-roundtable-onstage", JSON.stringify(onStage));
  }, [onStage]);

  useEffect(() => {
    const unlistenSpeaker = listen<{ round: number; role: string; status: string; content?: string; delta?: string }>("roundtable-speaker", event => {
      const { round, role, status, content, delta } = event.payload;

      if (status === "start") {
        setSpeakers(prev => {
          const existingRoles = [...new Set(prev.map(s => s.role))];
          const colorIndex = existingRoles.includes(role) ? existingRoles.indexOf(role) : existingRoles.length;
          return [...prev, { round, role, content: "", color: ROLE_COLORS[colorIndex % ROLE_COLORS.length] }];
        });
      } else if (status === "streaming" && delta) {
        setSpeakers(prev => {
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
        setSpeakers(prev => {
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
      setRunning(false);
      setResult(event.payload.result);
      const currentSpeakers = speakersRef.current;
      if (currentSpeakers.length > 0) {
        const record = {
          id: Date.now().toString(),
          topic: topicRef.current,
          speakers: currentSpeakers,
          result: event.payload.result,
          createdAt: Date.now(),
        };
        setHistory(prev => {
          const updated = [record, ...prev].slice(0, 20);
          localStorage.setItem("webot-roundtable-history", JSON.stringify(updated));
          return updated;
        });
      }
    });
    return () => { unlistenSpeaker.then(fn => fn()); unlistenDone.then(fn => fn()); };
  }, []);

  const removeRole = useCallback((source: RoundtableRoleSource, index: number) => {
    if (source === "onstage") {
      setOnStage(prev => prev.filter((_, j) => j !== index));
      return;
    }
    setBackstage(prev => prev.filter((_, j) => j !== index));
  }, []);

  const moveToTable = useCallback((source: RoundtableRoleSource, index: number) => {
    if (source === "onstage") return;
    const role = backstage[index];
    if (!role?.name.trim()) return;
    setBackstage(prev => prev.filter((_, j) => j !== index));
    setOnStage(stage => [...stage, { name: role.name, trait: role.trait }]);
  }, [backstage]);

  const moveToBackstage = useCallback((source: RoundtableRoleSource, index: number) => {
    if (source === "backstage") return;
    const role = onStage[index];
    if (!role?.name.trim()) return;
    setOnStage(prev => prev.filter((_, j) => j !== index));
    setBackstage(bs => [...bs, { name: role.name, trait: role.trait }]);
  }, [onStage]);

  const getDropZoneAt = (x: number, y: number): RoundtableDropZone => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-roundtable-drop-zone]");
    const zone = el?.dataset.roundtableDropZone;
    return zone === "table" || zone === "backstage" || zone === "trash" ? zone : null;
  };

  const applyDrop = useCallback((payload: RoundtableDragPayload, target: Exclude<RoundtableDropZone, null>) => {
    if (target === "trash") removeRole(payload.source, payload.index);
    else if (target === "backstage") moveToBackstage(payload.source, payload.index);
    else moveToTable(payload.source, payload.index);
    setDropZone(null);
  }, [moveToBackstage, moveToTable, removeRole]);

  const startDrag = (event: ReactPointerEvent<HTMLElement>, source: RoundtableRoleSource, index: number, role: RoundtableRole) => {
    if (running || (event.target as HTMLElement).closest("button")) return;
    const next = { source, index, role, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, currentX: event.clientX, currentY: event.clientY, dragging: false };
    pointerDragRef.current = next;
    setPointerDrag(next);
  };

  const moveDrag = useCallback((event: PointerEvent) => {
    const active = pointerDragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - active.startX, event.clientY - active.startY);
    const dragging = active.dragging || distance > 6;
    if (dragging) {
      event.preventDefault();
      setDropZone(getDropZoneAt(event.clientX, event.clientY));
    }
    const next = { ...active, currentX: event.clientX, currentY: event.clientY, dragging };
    pointerDragRef.current = next;
    setPointerDrag(next);
  }, []);

  const endDrag = useCallback((event: PointerEvent) => {
    const active = pointerDragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.dragging) {
      event.preventDefault();
      suppressClickRef.current = true;
      const zone = getDropZoneAt(event.clientX, event.clientY);
      if (zone) applyDrop(active, zone);
    }
    pointerDragRef.current = null;
    setPointerDrag(null);
    setDropZone(null);
  }, [applyDrop]);

  useEffect(() => {
    if (!pointerDrag) return undefined;
    window.addEventListener("pointermove", moveDrag);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointermove", moveDrag);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [endDrag, moveDrag, Boolean(pointerDrag)]);

  const seatCount = onStage.filter(r => r.name.trim()).length;

  const handleClose = () => {
    setRunning(false);
    setSpeakers([]);
    setResult(null);
    onClose();
  };

  return (
    <div className="roundtable-page">
      <div className="roundtable-page-header">
        <h3>{t("roundtableTitle")}</h3>
        <div className="roundtable-header-actions">
          <button
            className="roundtable-start-btn"
            disabled={running || !topic.trim()}
            onClick={async () => {
              setRunning(true);
              setSpeakers([]);
              setResult(null);
              const roleNames = onStage.filter(r => r.name.trim()).map(r => {
                const trait = r.trait.trim();
                return trait ? `${r.name.trim()}（${trait}）` : r.name.trim();
              });
              await invoke("start_roundtable", {
                topic: topic.trim(),
                roles: roleNames.length > 0 ? roleNames : null,
              });
            }}
          >
            {running ? <Loader2 size={16} className="spinner" /> : t("roundtableStart")}
          </button>
          <button
            className="roundtable-history-btn"
            onClick={() => setHistoryOpen(prev => !prev)}
            title={t("roundtableHistory")}
          >
            {t("roundtableHistory")}
          </button>
        </div>
        <button className="sidebar-close-btn" onClick={handleClose}>
          <X size={16} />
        </button>
      </div>
      <div className="roundtable-page-body">
        <div className="roundtable-main">
          <div className="roundtable-roles-section">
            <div
              className={`roundtable-card-pool ${dropZone === "backstage" ? "backstage-drop-active" : ""}`}
              data-roundtable-drop-zone="backstage"
            >
              <div className="roundtable-zone-header">
                <span className="roundtable-zone-dot muted" />
                <span className="roundtable-zone-label">{t("roundtableBackstage")}</span>
                <span className="roundtable-zone-count">{backstage.filter(r => r.name.trim()).length}</span>
              </div>
              <div className="roundtable-zone-rail">
                {backstage.filter(r => r.name.trim()).length === 0 && (
                  <span className="roundtable-zone-empty">{t("roundtableCardsEmpty")}</span>
                )}
                {backstage.map((role, idx) => {
                  if (!role.name.trim()) return null;
                  const cardKey = getRoundtableRoleKey("backstage", idx, role);
                  const isFlipped = flippedRoles.has(cardKey);
                  const isDragging = pointerDrag?.dragging && pointerDrag.source === "backstage" && pointerDrag.index === idx;
                  return (
                    <div
                      key={`off-${idx}`}
                      className={`roundtable-role-card${isFlipped ? " flipped" : ""}${isDragging ? " is-dragging" : ""}`}
                      onPointerDown={e => startDrag(e, "backstage", idx, role)}
                      onClick={() => {
                        if (running) return;
                        if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                        setFlippedRoles(prev => {
                          const next = new Set(prev);
                          if (next.has(cardKey)) next.delete(cardKey);
                          else next.add(cardKey);
                          return next;
                        });
                      }}
                      onContextMenu={e => { if (running) return; e.preventDefault(); setRoleContextMenu({ x: e.clientX, y: e.clientY, source: "backstage", index: idx }); }}
                    >
                      <div className="roundtable-role-card-inner">
                        <div className="roundtable-role-card-face front">
                          {!running && (
                            <button className="roundtable-role-action" onClick={e => { e.stopPropagation(); setRoleEditing({ source: "backstage", index: idx }); }}><PenTool size={11} /></button>
                          )}
                          <div className="roundtable-role-avatar off">{role.name[0]}</div>
                          <div className="roundtable-role-info">
                            <span className="roundtable-role-name">{role.name}</span>
                            <span className="roundtable-role-hint">{t("roundtableFlipHint")}</span>
                          </div>
                        </div>
                        <div className="roundtable-role-card-face back">
                          <span className="roundtable-role-name">{role.name}</span>
                          <span className="roundtable-role-trait-text">{role.trait.trim() || t("roundtableNoTrait")}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!running && (
                  <button className="roundtable-add-card" onClick={() => {
                    setBackstage(prev => [...prev, { name: "", trait: "" }]);
                    const idx = backstage.length;
                    setRoleEditing({ source: "backstage", index: idx });
                  }}>
                    <span className="roundtable-add-icon"><Plus size={15} /></span>
                    <span>{t("roundtableAddRole")}</span>
                  </button>
                )}
              </div>
            </div>
            <div className={`roundtable-trash ${dropZone === "trash" ? "drop-active" : ""}`} data-roundtable-drop-zone="trash">
              <Trash2 size={18} />
              <span>{t("roundtableTrash")}</span>
            </div>
          </div>
          <div className={`roundtable-table-area ${dropZone === "table" ? "table-drop-active" : ""}`} data-roundtable-drop-zone="table">
            <div className="roundtable-table-shell">
              <div className="roundtable-table">
                <div className="roundtable-table-topic-wrap">
                  <input
                    className="roundtable-table-topic"
                    type="text"
                    placeholder={t("roundtableTopicPlaceholder")}
                    value={topic}
                    onChange={e => setTopic(e.target.value)}
                    disabled={running}
                  />
                  <div className="roundtable-table-meta">
                    {t("roundtableOnStage")} {onStage.filter(r => r.name.trim()).length}
                  </div>
                </div>
              </div>
              <div className="roundtable-seat-ring">
                {onStage.filter(r => r.name.trim()).length === 0 && (
                  <span className="roundtable-zone-empty">{t("roundtableStageEmpty")}</span>
                )}
                {onStage.map((role, idx) => {
                  if (!role.name.trim()) return null;
                  const color = ROLE_COLORS[idx % ROLE_COLORS.length];
                  const angle = (idx * 360 / Math.max(seatCount, 1)) - 90;
                  const isDragging = pointerDrag?.dragging && pointerDrag.source === "onstage" && pointerDrag.index === idx;
                  return (
                    <div
                      key={`seat-${idx}`}
                      className={`roundtable-seat${isDragging ? " is-dragging" : ""}`}
                      style={{ "--seat-angle": `${angle}deg`, "--seat-angle-reverse": `${-angle}deg` } as CSSProperties}
                      onPointerDown={e => startDrag(e, "onstage", idx, role)}
                      onContextMenu={e => { if (running) return; e.preventDefault(); setRoleContextMenu({ x: e.clientX, y: e.clientY, source: "onstage", index: idx }); }}
                    >
                      {!running && (
                        <button className="roundtable-role-action" onClick={e => { e.stopPropagation(); setRoleEditing({ source: "onstage", index: idx }); }}><PenTool size={11} /></button>
                      )}
                      <div className="roundtable-role-avatar" style={{ background: color }}>{role.name[0]}</div>
                      <div className="roundtable-role-info">
                        <span className="roundtable-role-name">{role.name}</span>
                        {role.trait.trim() && <span className="roundtable-role-trait-text">{role.trait}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          {pointerDrag?.dragging && (
            <div className="roundtable-drag-ghost" style={{ left: pointerDrag.currentX, top: pointerDrag.currentY } as CSSProperties}>
              <div className="roundtable-role-avatar off">{pointerDrag.role.name[0]}</div>
              <span>{pointerDrag.role.name}</span>
            </div>
          )}
          <div className="roundtable-discussion">
            {speakers.length === 0 && !result && (
              <div className="roundtable-empty">
                <Users size={48} />
                <p>{t("roundtableEmpty")}</p>
              </div>
            )}
            {speakers.map((speaker, i) => (
              <div key={i} className="roundtable-speaker-card" style={{ borderLeftColor: speaker.color }}>
                <div className="roundtable-speaker-header">
                  <div className="roundtable-speaker-avatar" style={{ background: speaker.color }}>{speaker.role[0]}</div>
                  <span className="roundtable-speaker-name">{speaker.role}</span>
                  <span className="roundtable-speaker-round">R{speaker.round}</span>
                </div>
                <div className="roundtable-speaker-content">{renderMarkdown(speaker.content)}</div>
              </div>
            ))}
            {result && (
              <div className="roundtable-summary">
                {renderMarkdown(result)}
              </div>
            )}
          </div>
          {historyOpen && (
            <div className="roundtable-history-panel">
              <div className="roundtable-history-header">
                <span>{t("roundtableHistory")}</span>
                <button onClick={() => setHistoryOpen(false)}><X size={14} /></button>
              </div>
              {history.length === 0 ? (
                <div className="roundtable-history-empty">{t("roundtableNoHistory")}</div>
              ) : (
                history.map(record => (
                  <div key={record.id} className="roundtable-history-item" onClick={() => setViewingHistory(record)}>
                    <div className="roundtable-history-item-topic">{record.topic}</div>
                    <div className="roundtable-history-item-meta">
                      <span>{new Date(record.createdAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      <span>{record.speakers.map(s => s.role).filter((r, i, a) => a.indexOf(r) === i).length} {lang === "zh" ? "位专家" : "experts"}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {viewingHistory && (
        <div className="qr-modal-overlay" onClick={() => setViewingHistory(null)}>
          <div className="qr-modal roundtable-history-detail-modal" onClick={e => e.stopPropagation()}>
            <button className="qr-modal-close" onClick={() => setViewingHistory(null)}>
              <X size={18} />
            </button>
            <h3 className="qr-modal-title">{viewingHistory.topic}</h3>
            <div className="roundtable-history-detail-time">
              {new Date(viewingHistory.createdAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-US")}
            </div>
            <div className="roundtable-history-detail-speakers">
              {viewingHistory.speakers.map((speaker, i) => (
                <div key={i} className="roundtable-speaker-card" style={{ borderLeftColor: speaker.color }}>
                  <div className="roundtable-speaker-header">
                    <div className="roundtable-speaker-avatar" style={{ background: speaker.color }}>{speaker.role[0]}</div>
                    <span className="roundtable-speaker-name">{speaker.role}</span>
                    <span className="roundtable-speaker-round">R{speaker.round}</span>
                  </div>
                  <div className="roundtable-speaker-content">{renderMarkdown(speaker.content)}</div>
                </div>
              ))}
            </div>
            {viewingHistory.result && (
              <div className="roundtable-summary">
                {renderMarkdown(viewingHistory.result)}
              </div>
            )}
            <div className="roundtable-history-detail-actions">
              <button className="roundtable-history-delete-btn" onClick={() => {
                setHistory(prev => {
                  const updated = prev.filter(r => r.id !== viewingHistory!.id);
                  localStorage.setItem("webot-roundtable-history", JSON.stringify(updated));
                  return updated;
                });
                setViewingHistory(null);
              }}>{t("roundtableDeleteRecord")}</button>
            </div>
          </div>
        </div>
      )}

      {roleContextMenu && (() => {
        const list = roleContextMenu.source === "onstage" ? onStage : backstage;
        const role = list[roleContextMenu.index];
        if (!role) { setRoleContextMenu(null); return null; }
        return (
          <div className="context-menu-overlay" onClick={() => setRoleContextMenu(null)}>
            <div className="context-menu" style={{ left: roleContextMenu.x, top: roleContextMenu.y }} onClick={e => e.stopPropagation()}>
              <button className="context-menu-item" onClick={() => { setRoleEditing({ source: roleContextMenu.source, index: roleContextMenu.index }); setRoleContextMenu(null); }}>
                {t("edit")}
              </button>
              <button className="context-menu-item danger" onClick={() => {
                if (roleContextMenu.source === "onstage") setOnStage(prev => prev.filter((_, j) => j !== roleContextMenu.index));
                else setBackstage(prev => prev.filter((_, j) => j !== roleContextMenu.index));
                setRoleContextMenu(null);
              }}>
                {t("delete")}
              </button>
            </div>
          </div>
        );
      })()}

      {roleEditing && (() => {
        const list = roleEditing.source === "onstage" ? onStage : backstage;
        const role = list[roleEditing.index];
        if (!role) { setRoleEditing(null); return null; }
        const setter = roleEditing.source === "onstage" ? setOnStage : setBackstage;
        const update = (field: string, value: string) => setter(prev => prev.map((r, j) => j === roleEditing.index ? { ...r, [field]: value } : r));
        const close = () => {
          const current = (roleEditing.source === "onstage" ? onStage : backstage)[roleEditing.index];
          if (current && !current.name.trim()) setter(prev => prev.filter((_, j) => j !== roleEditing.index));
          setRoleEditing(null);
        };
        return (
          <div className="context-menu-overlay" onClick={close}>
            <div className="role-edit-modal" onClick={e => e.stopPropagation()}>
              <div className="role-edit-field">
                <label>{t("roundtableRoleName")}</label>
                <input value={role.name} onChange={e => update("name", e.target.value)} autoFocus onKeyDown={e => { if (e.key === "Enter") close(); }} />
              </div>
              <div className="role-edit-field">
                <label>{t("roundtableRoleTrait")}</label>
                <input value={role.trait} onChange={e => update("trait", e.target.value)} onKeyDown={e => { if (e.key === "Enter") close(); }} />
              </div>
              <div className="role-edit-actions">
                <button className="role-edit-save" onClick={close}>{t("save")}</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
