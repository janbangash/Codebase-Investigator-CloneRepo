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
          className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden hover:border-purple-500 transition-colors cursor-pointer"
          onClick={() => onNavigate?.(match.file, match.line || 0)}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 border-b border-gray-700">
            <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-purple-300 font-mono text-xs truncate flex-1" title={match.file}>
              {match.file}
            </span>
            {match.line && (
              <span className="text-gray-500 text-xs">
                Line {match.line}
              </span>
            )}
            {match.count && (
              <span className="bg-purple-900/50 text-purple-300 px-2 py-0.5 rounded text-xs">
                #{match.count}
              </span>
            )}
          </div>

          {/* Code Preview */}
          {match.content && (
            <div className="px-3 py-2 bg-gray-900/50">
              <pre className="text-xs text-gray-300 font-mono overflow-x-auto whitespace-pre-wrap break-all">
                <code>{match.content.slice(0, 200)}{match.content.length > 200 ? '...' : ''}</code>
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
