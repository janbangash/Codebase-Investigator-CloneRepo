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
      <div className={`rounded-lg px-3 py-2 border ${
        isComplete
          ? 'bg-green-900/20 border-green-700/50'
          : 'bg-purple-900/20 border-purple-700/50'
      }`}>
        <div className="flex items-center gap-2">
          {!isComplete && (
            <div className="flex gap-1">
              <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-pulse" />
              <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
              <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
            </div>
          )}
          {isComplete && (
            <svg className="w-3.5 h-3.5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          )}
          <p className={`text-xs ${isComplete ? 'text-green-300' : 'text-purple-300'}`}>
            {thinking}
          </p>
        </div>
      </div>
    </div>
  );
}
