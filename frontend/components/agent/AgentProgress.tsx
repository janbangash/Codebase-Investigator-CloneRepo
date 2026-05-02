'use client';

import React from 'react';

interface AgentProgressProps {
  events: Array<{
    type: string;
    data: {
      message?: string;
      file?: string;
      keywords?: string[];
      matches?: number;
      count?: number;
      time?: number;
      step?: number;
      total?: number;
    };
  }>;
}

export default function AgentProgress({ events }: AgentProgressProps) {
  if (events.length === 0) return null;

  const getStatusIcon = (type: string) => {
    switch (type) {
      case 'analyzing':
        return <span className="text-gray-400">⏳</span>;
      case 'analyzed':
        return <span className="text-green-400">✓</span>;
      case 'searching':
        return <span className="text-blue-400 animate-pulse">🔍</span>;
      case 'searching_file':
        return <span className="text-gray-500">├──</span>;
      case 'found_match':
        return <span className="text-green-500">✓</span>;
      case 'search_complete':
        return <span className="text-green-400">✓</span>;
      case 'responding':
        return <span className="text-purple-400 animate-pulse">✍️</span>;
      case 'complete':
        return <span className="text-green-400">✓</span>;
      case 'suggestion':
        return <span className="text-yellow-400">💡</span>;
      default:
        return <span className="text-gray-400">•</span>;
    }
  };

  const getProgressColor = (type: string) => {
    switch (type) {
      case 'analyzing':
      case 'analyzed':
        return 'text-gray-300';
      case 'searching':
      case 'searching_file':
      case 'search_complete':
        return 'text-blue-300';
      case 'found_match':
        return 'text-green-300';
      case 'responding':
        return 'text-purple-300';
      case 'complete':
        return 'text-green-300';
      case 'suggestion':
        return 'text-yellow-300';
      default:
        return 'text-gray-300';
    }
  };

  // Group events by phase for tree view
  const searchFiles = events.filter(e => e.type === 'searching_file').slice(-10);
  const foundMatches = events.filter(e => e.type === 'found_match').slice(-10);

  return (
    <div className="bg-[var(--sidebar-bg)] rounded-xl p-4 border border-[var(--border-color)] font-mono text-xs shadow-lg">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-[var(--accent-secondary)] to-purple-600 flex items-center justify-center">
          <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <span className="text-[var(--accent-secondary)] font-semibold">Agent Progress</span>
      </div>

      <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
        {events.map((event, idx) => {
          const isLatest = idx === events.length - 1;
          return (
            <div
              key={idx}
              className={`flex items-center gap-2 ${getProgressColor(event.type)} ${
                isLatest ? 'opacity-100' : 'opacity-50'
              }`}
            >
              {getStatusIcon(event.type)}
              <span className="truncate">
                {event.data.message || event.type}
                {event.data.keywords && (
                  <span className="text-gray-400">: {event.data.keywords.join(', ')}</span>
                )}
                {event.data.time && (
                  <span className="text-gray-600 ml-2">({event.data.time}ms)</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {/* File Search Tree */}
      {searchFiles.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--border-color)]">
          <div className="flex items-center gap-1.5 text-gray-500 text-xs mb-2">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
            </svg>
            <span className="font-semibold">Files Searched:</span>
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto font-mono">
            {searchFiles.map((event, idx) => (
              <div key={idx} className="flex items-center gap-2 text-gray-400 text-xs">
                <svg className="w-3 h-3 text-blue-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                </svg>
                <span className="truncate" title={event.data.file}>
                  {event.data.file}
                </span>
                {event.data.matches !== undefined && (
                  <span className="text-green-500 text-xs shrink-0">
                    ({event.data.matches})
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Matches Found */}
      {foundMatches.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--border-color)]">
          <div className="flex items-center gap-1.5 text-gray-500 text-xs mb-2">
            <svg className="w-3.5 h-3.5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="font-semibold">Matches:</span>
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto font-mono">
            {foundMatches.map((event, idx) => (
              <div key={idx} className="flex items-center gap-2 text-green-400 text-xs">
                <span className="text-gray-600">├─</span>
                <span className="truncate" title={event.data.file}>
                  {event.data.file}
                </span>
                <span className="text-gray-600 shrink-0">
                  #{event.data.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary */}
      {events.some(e => e.type === 'complete') && (
        <div className="mt-3 pt-3 border-t border-[var(--border-color)]">
          <div className="flex items-center justify-between text-green-400">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="font-semibold">Search Complete</span>
            </div>
            {events.find(e => e.type === 'complete')?.data.time && (
              <span className="text-gray-500">
                {events.find(e => e.type === 'complete')?.data.time}ms
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
