import React from 'react';
import { Check } from 'lucide-react';

interface ToastProps {
  message: string | null;
}

export const Toast: React.FC<ToastProps> = ({ message }) => {
  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-[#191918] border border-[#343430] text-[#edece8] px-3.5 py-2 rounded-xl text-xs font-medium tracking-wide shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-150"
    >
      <Check className="w-3.5 h-3.5 text-[#edece8] shrink-0" />
      <span>{message}</span>
    </div>
  );
};
