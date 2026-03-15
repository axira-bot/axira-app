"use client";

import { useState, useRef, useEffect } from "react";

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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all"
        style={{ background: "#C41230", color: "#fff", boxShadow: "0 4px 20px rgba(196,18,48,0.4)" }}
        title="Axira AI"
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.filter = "brightness(0.88)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.filter = "none"; }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10a9.96 9.96 0 0 1-5.06-1.37L2 22l1.37-4.94A9.96 9.96 0 0 1 2 12 10 10 0 0 1 12 2z"/>
          <path d="M8 10h.01M12 10h.01M16 10h.01"/>
        </svg>
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-20 right-4 z-50 flex flex-col rounded-2xl overflow-hidden"
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
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center w-6 h-6 rounded-md"
              style={{ color: "rgba(255,255,255,0.4)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#fff"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.4)"; }}
            >
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="1" y1="1" x2="11" y2="11"/><line x1="11" y1="1" x2="1" y2="11"/>
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ background: "var(--color-bg)" }}>
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs mb-3" style={{ color: "var(--color-text-muted)" }}>
                  Ask me anything about Axira or tell me to log something.
                </p>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setInput(s)}
                    className="block w-full rounded-lg px-3 py-2 text-left text-xs transition"
                    style={{
                      background: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      color: "var(--color-text)",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "#C41230"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--color-border)"; }}
                  >
                    {s}
                  </button>
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
                  className="rounded-xl px-3 py-2 text-xs"
                  style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}
                >
                  Thinking...
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-3 py-3 shrink-0" style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
                placeholder="Ask or log an expense..."
                className="flex-1 rounded-lg px-3 py-2 text-xs outline-none transition"
                style={{
                  background: "var(--color-bg)",
                  border: "1.5px solid var(--color-border)",
                  color: "var(--color-text)",
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "#C41230"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
              />
              <button
                type="button"
                onClick={send}
                disabled={loading || !input.trim()}
                className="flex h-8 w-8 items-center justify-center rounded-lg transition"
                style={{ background: "#C41230", color: "#fff" }}
                onMouseEnter={(e) => { if (!loading) (e.currentTarget as HTMLElement).style.filter = "brightness(0.88)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.filter = "none"; }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
