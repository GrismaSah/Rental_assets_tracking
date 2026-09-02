import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, CheckCircle2, X, Bot, User as UserIcon, Loader2 } from 'lucide-react';

interface ActionProposal {
  type: 'RELOCATE_ASSET' | 'RETURN_EARLY' | 'ASSIGN_OPERATOR';
  asset_id: string;
  recommendation_id: string | null;
  summary: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  action_proposal?: ActionProposal | null;
  source?: string;
  actioned?: 'confirmed' | 'cancelled';
}

interface AiCopilotProps {
  onConfirmAction: (proposal: ActionProposal) => Promise<{ ok: boolean; message: string }>;
  seedQuestion?: string | null;
  onSeedConsumed?: () => void;
}

const QUICK_QUESTIONS = [
  'What needs my attention right now?',
  'Which machines are wasting the most money?',
  'Which equipment is outside its geofence?',
  'Which rentals are overdue?',
  'Give me the top 5 actions I should take today.',
];

function renderMarkdownLite(text: string) {
  const html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^### (.*)$/gm, '<div class="font-bold text-xs uppercase tracking-wide text-neutral-500 mt-2">$1</div>')
    .replace(/^\* (.*)$/gm, '<div class="pl-1">• $1</div>')
    .replace(/\n/g, '<br/>');
  return { __html: html };
}

export const AiCopilot: React.FC<AiCopilotProps> = ({ onConfirmAction, seedQuestion, onSeedConsumed }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: "I'm SmartRent Copilot. Ask me about idle costs, overdue rentals, geofence violations, or fleet priorities — I only answer from live fleet data." },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: nextMessages.slice(-6).map((m) => ({ role: m.role, content: m.content })) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'AI request failed');
      setMessages((prev) => [...prev, { role: 'assistant', content: data.answer, action_proposal: data.action_proposal || null, source: data.source }]);
    } catch (error: any) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Sorry, I couldn't reach the AI service: ${error.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (seedQuestion) {
      send(seedQuestion);
      onSeedConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedQuestion]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const handleConfirm = async (index: number, proposal: ActionProposal) => {
    const result = await onConfirmAction(proposal);
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, actioned: result.ok ? 'confirmed' : 'cancelled' } : m)));
    setMessages((prev) => [...prev, { role: 'assistant', content: result.message }]);
  };

  const handleCancel = (index: number) => {
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, actioned: 'cancelled' } : m)));
  };

  return (
    <div className="bg-white rounded-2xl border border-neutral-200/70 flex flex-col h-[640px]">
      <div className="p-4 border-b border-neutral-100 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-neutral-900 text-[#FFCD00] flex items-center justify-center">
          <Sparkles className="w-4.5 h-4.5" />
        </div>
        <div>
          <div className="text-sm font-bold text-neutral-900">SmartRent Copilot</div>
          <div className="text-[11px] text-neutral-500">Answers from live fleet data only — mutating actions always require your confirmation.</div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${m.role === 'user' ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'}`}>
              {m.role === 'user' ? <UserIcon className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
            </div>
            <div className={`max-w-[85%] ${m.role === 'user' ? 'text-right' : ''}`}>
              <div
                className={`inline-block text-left px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed ${
                  m.role === 'user' ? 'bg-neutral-900 text-white rounded-tr-sm' : 'bg-neutral-50 text-neutral-800 border border-neutral-100 rounded-tl-sm'
                }`}
                dangerouslySetInnerHTML={renderMarkdownLite(m.content)}
              />
              {m.action_proposal && !m.actioned && (
                <div className="mt-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-left space-y-2">
                  <p className="text-[11px] font-bold text-amber-900">Proposed action: {m.action_proposal.type.replace('_', ' ')}</p>
                  <p className="text-[11px] text-amber-800">{m.action_proposal.summary}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleConfirm(i, m.action_proposal!)}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-neutral-900 text-white hover:bg-neutral-800 flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3 h-3" /> Confirm
                    </button>
                    <button
                      onClick={() => handleCancel(i)}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-white text-neutral-700 border border-neutral-200 flex items-center gap-1"
                    >
                      <X className="w-3 h-3" /> Cancel
                    </button>
                  </div>
                </div>
              )}
              {m.actioned && (
                <p className={`mt-1 text-[10px] font-bold ${m.actioned === 'confirmed' ? 'text-emerald-600' : 'text-neutral-400'}`}>
                  {m.actioned === 'confirmed' ? 'Action confirmed and applied.' : 'Action cancelled.'}
                </p>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-neutral-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking…
          </div>
        )}
      </div>

      <div className="p-3 border-t border-neutral-100 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {QUICK_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => send(q)}
              className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-neutral-100 text-neutral-600 hover:bg-neutral-200 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send(input)}
            placeholder="Ask about your fleet…"
            className="flex-1 px-3 py-2.5 rounded-xl text-xs bg-neutral-100/90 border border-neutral-200/80 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FFCD00]/50"
          />
          <button
            onClick={() => send(input)}
            disabled={loading}
            className="p-2.5 rounded-xl bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
