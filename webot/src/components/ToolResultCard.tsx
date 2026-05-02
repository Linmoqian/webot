import { Zap } from "lucide-react";
import { renderMarkdown } from "./Markdown";
import type { ToolResultEvent } from "../types";

function CardRenderer({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="result-card-grid">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="result-card-row">
          <span className="result-card-key">{key}</span>
          <span className="result-card-value">{String(value)}</span>
        </div>
      ))}
    </div>
  );
}

function TableRenderer({ data }: { data: Record<string, unknown>[] }) {
  if (data.length === 0) return <div className="tool-result-text">No data</div>;
  const columns = Object.keys(data[0]);
  return (
    <div className="result-table-wrapper">
      <table className="result-table">
        <thead>
          <tr>{columns.map(c => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>{columns.map(c => <td key={c}>{String(row[c] ?? "")}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ToolResultCard({ event }: { event: ToolResultEvent }) {
  let parsed: unknown = null;
  try { parsed = JSON.parse(event.result); } catch { /* not JSON */ }

  return (
    <div className="tool-result-card">
      <div className="tool-result-header">
        <Zap size={14} />
        <span>{event.name}</span>
      </div>
      <div className="tool-result-body">
        {event.renderer === "card" && parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? <CardRenderer data={parsed as Record<string, unknown>} />
          : event.renderer === "table" && Array.isArray(parsed)
          ? <TableRenderer data={parsed as Record<string, unknown>[]} />
          : event.renderer === "markdown"
          ? renderMarkdown(event.result)
          : <pre className="tool-result-text">{event.result}</pre>
        }
      </div>
    </div>
  );
}
