'use client';

import React from 'react';

interface MatchPreview {
  file: string;
  line?: number;
  content?: string;
  count?: number;
}

interface MatchPreviewProps {
  matches: MatchPreview[];
  onNavigate?: (file: string, line: number) => void;
}

export default function MatchPreview({ matches, onNavigate }: MatchPreviewProps) {
  if (matches.length === 0) return null;

  return (
    <div className="space-y-2">
      {matches.map((match, idx) => (
        <div
          key={idx}
          className="bg-[var(--sidebar-bg)] rounded-lg border border-[var(--border-color)] overflow-hidden hover:border-[var(--accent-secondary)] hover:shadow-lg transition-all cursor-pointer group"
          onClick={() => onNavigate?.(match.file, match.line || 0)}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2 bg-[var(--panel-bg)] border-b border-[var(--border-color)]">
            <svg className="w-4 h-4 text-[var(--accent-primary)] group-hover:text-[var(--accent-secondary)] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-gray-300 font-mono text-xs truncate flex-1" title={match.file}>
              {match.file}
            </span>
            {match.line && (
              <span className="text-gray-500 text-xs">
                L{match.line}
              </span>
            )}
            {match.count && (
              <span className="bg-[var(--accent-secondary)]/20 text-[var(--accent-secondary)] px-2 py-0.5 rounded text-xs border border-[var(--accent-secondary)]/30">
                #{match.count}
              </span>
            )}
          </div>

          {/* Code Preview */}
          {match.content && (
            <div className="px-3 py-2 bg-[var(--background)]">
              <pre className="text-xs text-gray-400 font-mono overflow-x-auto whitespace-pre-wrap break-all">
                <code>{match.content.slice(0, 200)}{match.content.length > 200 ? '...' : ''}</code>
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
