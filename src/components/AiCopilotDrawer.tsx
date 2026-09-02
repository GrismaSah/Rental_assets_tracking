import React from 'react';
import { Sparkles, X } from 'lucide-react';
import { AiCopilot } from './AiCopilot';

interface AiCopilotDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmAction: (proposal: any) => Promise<{ ok: boolean; message: string }>;
  pageContext: string;
  seedQuestion?: string | null;
  onSeedConsumed?: () => void;
}

// The SAME SmartRent Copilot chat, available as a floating drawer from every
// page in the app (see the FAB in App.tsx) instead of living on its own
// standalone tab. It calls the identical /api/ai/chat backend regardless of
// which page it was opened from -- only the `pageContext` string changes,
// which server.ts folds into the AI prompt so answers can reference what
// the user is currently looking at.
export const AiCopilotDrawer: React.FC<AiCopilotDrawerProps> = ({ isOpen, onClose, onConfirmAction, pageContext, seedQuestion, onSeedConsumed }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <div className="flex-1 bg-neutral-950/40 backdrop-blur-[1px]" onClick={onClose} />
      <div className="w-full max-w-md h-full bg-[#edf0ec] shadow-2xl flex flex-col animate-slideUp">
        <div className="p-3 flex items-center justify-between border-b border-neutral-200/70 bg-white">
          <div className="flex items-center gap-2 text-xs font-semibold text-neutral-500">
            <Sparkles className="w-3.5 h-3.5 text-[#FFCD00]" />
            Viewing: {pageContext}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-100" aria-label="Close AI Copilot">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 p-3 overflow-hidden">
          <AiCopilot
            onConfirmAction={onConfirmAction}
            pageContext={pageContext}
            seedQuestion={seedQuestion}
            onSeedConsumed={onSeedConsumed}
          />
        </div>
      </div>
    </div>
  );
};
