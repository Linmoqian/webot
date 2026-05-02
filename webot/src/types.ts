export interface ToolResultEvent {
  name: string;
  result: string;
  renderer: "card" | "table" | "markdown" | "text";
}

export interface Message {
  role: "user" | "agent";
  content: string;
  reasoning_content?: string;
  isThinking?: boolean;
  isFinished?: boolean;
  showReasoning?: boolean;
  toolResults?: ToolResultEvent[];
}

export interface PluginManifest {
  id: string;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  version: string;
  author: string;
  icon: string;
  type: "builtin" | "http";
  tool: Record<string, unknown>;
  endpoint: string | null;
  slots?: {
    tool_result?: { renderer: string };
    page?: { icon: string; label: { zh: string; en: string } };
  };
  lab?: boolean;
}

export interface RoundtableRole {
  name: string;
  trait: string;
}

export type RoundtableRoleSource = "onstage" | "backstage";

export interface RoundtableDragPayload {
  source: RoundtableRoleSource;
  index: number;
}

export type RoundtableDropZone = "table" | "backstage" | "trash" | null;

export interface RoundtablePointerDrag extends RoundtableDragPayload {
  role: RoundtableRole;
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  dragging: boolean;
}
