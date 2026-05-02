'use client';

import React from 'react';

interface AgentThoughtsProps {
  thinking: string;
  isComplete?: boolean;
}

export function AgentThoughts({ thinking, isComplete = false }: AgentThoughtsProps) {
  if (!thinking) return null;

  return (
    <div className="flex justify-start mb-2">
      <div className={`rounded-xl px-3 py-2.5 border shadow-sm ${
        isComplete
          ? 'bg-green-500/10 border-green-500/30'
          : 'bg-[var(--accent-secondary)]/10 border-[var(--accent-secondary)]/30'
      }`}>
        <div className="flex items-center gap-2.5">
          {!isComplete && (
            <div className="flex gap-1.5">
              <div className="w-1.5 h-1.5 bg-[var(--accent-secondary)] rounded-full animate-pulse" />
              <div className="w-1.5 h-1.5 bg-[var(--accent-secondary)] rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
              <div className="w-1.5 h-1.5 bg-[var(--accent-secondary)] rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
            </div>
          )}
          {isComplete && (
            <svg className="w-4 h-4 text-green-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          )}
          <p className={`text-xs font-medium ${isComplete ? 'text-green-300' : 'text-[var(--accent-secondary)]'}`}>
            {thinking}
          </p>
        </div>
      </div>
    </div>
  );
}
