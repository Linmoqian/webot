import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface Message {
  role: "user" | "agent";
  content: string;
  reasoning_content?: string;
  isThinking?: boolean;
  isFinished?: boolean;
  showReasoning?: boolean;
}

type Translate = (key: string) => string;
type Unlisten = () => void;

const createAgentMessage = (): Message => ({
  role: "agent",
  content: "",
  reasoning_content: "",
  isThinking: false,
  isFinished: false,
  showReasoning: false,
});

export function useChatStream(t: Translate) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const cleanupRef = useRef<Unlisten>(() => {});

  useEffect(() => () => cleanupRef.current(), []);

  const updateLatestAgentMessage = useCallback((updater: (message: Message) => Message) => {
    setMessages(prev => {
      if (prev.length === 0) return prev;

      const updated = [...prev];
      const latest = updated[updated.length - 1];
      updated[updated.length - 1] = updater(latest);
      return updated;
    });
  }, []);

  const toggleReasoning = useCallback((index: number) => {
    setMessages(prev => prev.map((msg, i) =>
      i === index ? { ...msg, showReasoning: !msg.showReasoning } : msg
    ));
  }, []);

  const sendChatMessage = useCallback(async (userMessage: string) => {
    cleanupRef.current();
    setIsLoading(true);
    setMessages(prev => [
      ...prev,
      { role: "user", content: userMessage },
      createAgentMessage(),
    ]);

    const unlisteners: Unlisten[] = [];
    const cleanup = () => {
      unlisteners.splice(0).forEach(unlisten => unlisten());
      cleanupRef.current = () => {};
    };
    cleanupRef.current = cleanup;

    try {
      unlisteners.push(await listen<{ content: string }>("chat-thinking", (event) => {
        updateLatestAgentMessage(message => ({
          ...message,
          reasoning_content: (message.reasoning_content || "") + (event.payload.content || ""),
          isThinking: true,
          showReasoning: true,
        }));
      }));

      unlisteners.push(await listen<{ content: string }>("chat-text", (event) => {
        updateLatestAgentMessage(message => ({
          ...message,
          content: message.content + (event.payload.content || ""),
          isThinking: false,
        }));
      }));

      unlisteners.push(await listen("chat-done", () => {
        updateLatestAgentMessage(message => ({
          ...message,
          isFinished: true,
          isThinking: false,
        }));
        setIsLoading(false);
        cleanup();
      }));

      unlisteners.push(await listen<{ message: string }>("chat-error", (event) => {
        updateLatestAgentMessage(message => ({
          ...message,
          content: `${t("errorPrefix")}: ${event.payload.message || t("connectionError")}`,
          isFinished: true,
          isThinking: false,
        }));
        setIsLoading(false);
        cleanup();
      }));

      await invoke("start_chat", { message: userMessage });
    } catch {
      updateLatestAgentMessage(message => ({
        ...message,
        content: t("connectionError"),
        isFinished: true,
        isThinking: false,
      }));
      setIsLoading(false);
      cleanup();
    }
  }, [t, updateLatestAgentMessage]);

  return {
    messages,
    isLoading,
    sendChatMessage,
    toggleReasoning,
  };
}
