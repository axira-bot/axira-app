"use client";

import { useState, useRef, useEffect } from "react";
import { Button, Input, Label, Spinner, TextField } from "@heroui/react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export function AIChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    const newMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply ?? data.error ?? "No response" },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Connection error. Try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const suggestions = [
    "What's my total profit this month?",
    "Flag any issues in the system",
    "Log 500 AED maintenance from Dubai Cash",
    "Which deals have pending payments?",
  ];

  return (
    <>
      {/* Floating button */}
      <Button
        type="button"
        isIconOnly
        variant="primary"
        aria-label="Axira AI"
        className="fixed z-50 h-12 w-12 min-w-12 rounded-full shadow-lg bottom-[max(1.25rem,env(safe-area-inset-bottom,0.25rem))] right-[max(1.25rem,env(safe-area-inset-right,0.25rem))]"
        style={{ boxShadow: "0 4px 20px rgba(196,18,48,0.4)" }}
        onPress={() => setOpen((v) => !v)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10a9.96 9.96 0 0 1-5.06-1.37L2 22l1.37-4.94A9.96 9.96 0 0 1 2 12 10 10 0 0 1 12 2z"/>
          <path d="M8 10h.01M12 10h.01M16 10h.01"/>
        </svg>
      </Button>

      {/* Chat panel */}
      {open && (
        <div
          className="fixed z-50 flex flex-col overflow-hidden rounded-2xl bottom-[max(5rem,calc(4.5rem+env(safe-area-inset-bottom,0px)))] right-[max(1rem,env(safe-area-inset-right,0px))]"
          style={{
            height: "min(520px, calc(100dvh - 100px))",
            width: "min(380px, calc(100vw - 32px))",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            boxShadow: "0 8px 40px rgba(0,0,0,0.15)",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 shrink-0"
            style={{ background: "#222222", borderBottom: "1px solid rgba(255,255,255,0.08)" }}
          >
            <div className="flex items-center gap-2.5">
              <div className="h-2 w-2 rounded-full" style={{ background: "#C41230", boxShadow: "0 0 6px #C41230" }} />
              <span className="text-sm font-semibold" style={{ color: "#FFFFFF", fontFamily: "var(--font-heading)" }}>
                Axira AI
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              isIconOnly
              size="sm"
              aria-label="Close chat"
              className="h-6 w-6 min-w-6 text-white/40 hover:text-white"
              onPress={() => setOpen(false)}
            >
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="1" y1="1" x2="11" y2="11"/><line x1="11" y1="1" x2="1" y2="11"/>
              </svg>
            </Button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ background: "var(--color-bg)" }}>
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs mb-3" style={{ color: "var(--color-text-muted)" }}>
                  Ask me anything about Axira or tell me to log something.
                </p>
                {suggestions.map((s) => (
                  <Button
                    key={s}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto w-full justify-start whitespace-normal py-2 text-left text-xs"
                    onPress={() => setInput(s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap"
                  style={
                    m.role === "user"
                      ? { background: "#C41230", color: "#FFFFFF" }
                      : { background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-text)" }
                  }
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div
                  className="flex items-center gap-2 rounded-xl border border-default-200 bg-content1 px-3 py-2 text-xs text-default-500"
                >
                  <Spinner size="sm" color="danger" />
                  Thinking…
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-default-200 bg-content1 px-3 py-3">
            <div className="flex items-end gap-2">
              <TextField
                name="aiChatInput"
                value={input}
                onChange={setInput}
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                className="min-w-0 flex-1"
              >
                <Label className="sr-only">Message</Label>
                <Input className="text-xs" placeholder="Ask or log an expense..." />
              </TextField>
              <Button
                type="button"
                variant="primary"
                isIconOnly
                size="sm"
                aria-label="Send"
                isDisabled={loading || !input.trim()}
                onPress={() => void send()}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
