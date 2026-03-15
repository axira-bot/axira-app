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
        className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full border border-[#C9A84C]/40 bg-[#1A0C0E] shadow-lg transition hover:border-[#C9A84C]/80"
        title="Axira AI"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C9A84C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10a9.96 9.96 0 0 1-5.06-1.37L2 22l1.37-4.94A9.96 9.96 0 0 1 2 12 10 10 0 0 1 12 2z"/>
          <path d="M8 10h.01M12 10h.01M16 10h.01"/>
        </svg>
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-20 right-4 z-50 flex flex-col rounded-xl border border-[rgba(201,168,76,0.15)] bg-[#0D0608] shadow-2xl" style={{height: "min(520px, calc(100dvh - 100px))", width: "min(380px, calc(100vw - 32px))"}}>  

          {/* Header */}
          <div className="flex items-center justify-between border-b border-[rgba(201,168,76,0.15)] px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-[#C9A84C]" />
              <span className="text-sm font-semibold text-[#F5EDD8]" style={{ fontFamily: "var(--font-heading)" }}>
                Axira AI
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-[#F5EDD8]/40 hover:text-[#F5EDD8]/80"
            >
              ✕
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs text-[#F5EDD8]/40 mb-3">Ask me anything about Axira or tell me to log something.</p>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setInput(s)}
                    className="block w-full rounded-lg border border-[rgba(201,168,76,0.15)] bg-[#1A0C0E] px-3 py-2 text-left text-xs text-[#F5EDD8]/70 hover:border-[#C9A84C]/40 hover:text-[#F5EDD8]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-[#5B0F15] text-[#F5EDD8]"
                      : "bg-[#1A0C0E] border border-[rgba(201,168,76,0.15)] text-[#F5EDD8]"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-xl border border-[rgba(201,168,76,0.15)] bg-[#1A0C0E] px-3 py-2 text-xs text-[#C9A84C]">
                  Thinking...
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-[rgba(201,168,76,0.15)] px-3 py-3">
            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
                placeholder="Ask or log an expense..."
                className="flex-1 rounded-lg border border-[rgba(201,168,76,0.15)] bg-[#1A0C0E] px-3 py-2 text-xs text-[#F5EDD8] outline-none placeholder:text-[#F5EDD8]/30 focus:border-[#C9A84C]/50"
              />
              <button
                type="button"
                onClick={send}
                disabled={loading || !input.trim()}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#5B0F15] text-[#F5EDD8] disabled:opacity-40 hover:bg-[#7a1520]"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
