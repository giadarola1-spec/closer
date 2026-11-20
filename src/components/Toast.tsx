import React from 'react';

interface ToastProps {
  message: string | null;
}

export const Toast: React.FC<ToastProps> = ({ message }) => {
  if (!message) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-[#1e1e1e] border border-[#383838] text-[#ffffff] px-3.5 py-2 rounded text-xs font-medium tracking-wide shadow-2xl">
      <span className="w-1.5 h-1.5 rounded-full bg-white"></span>
      <span>{message}</span>
    </div>
  );
};
