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
    <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700 font-mono text-xs">
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <span className="text-purple-300 font-semibold">Agent Progress</span>
      </div>

      <div className="space-y-1 max-h-64 overflow-y-auto">
        {events.map((event, idx) => {
          const isLatest = idx === events.length - 1;
          return (
            <div
              key={idx}
              className={`flex items-center gap-2 ${getProgressColor(event.type)} ${
                isLatest ? 'opacity-100' : 'opacity-60'
              }`}
            >
              {getStatusIcon(event.type)}
              <span className="truncate">
                {event.data.message || event.type}
                {event.data.keywords && (
                  <span className="text-purple-200">: {event.data.keywords.join(', ')}</span>
                )}
                {event.data.time && (
                  <span className="text-gray-500 ml-2">({event.data.time}ms)</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {/* File Search Tree (Cursor-like) */}
      {searchFiles.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-700">
          <div className="text-gray-400 text-xs mb-2">📁 Files Searched:</div>
          <div className="space-y-1 max-h-32 overflow-y-auto font-mono">
            {searchFiles.map((event, idx) => (
              <div key={idx} className="flex items-center gap-2 text-gray-500 text-xs">
                <span className="text-blue-500">├──</span>
                <span className="truncate" title={event.data.file}>
                  {event.data.file}
                </span>
                {event.data.matches !== undefined && (
                  <span className="text-green-500 text-xs">
                    ({event.data.matches} matches)
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Matches Found */}
      {foundMatches.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-700">
          <div className="text-gray-400 text-xs mb-2">✓ Matches Found:</div>
          <div className="space-y-1 max-h-32 overflow-y-auto font-mono">
            {foundMatches.map((event, idx) => (
              <div key={idx} className="flex items-center gap-2 text-green-500 text-xs">
                <span>├──</span>
                <span className="truncate" title={event.data.file}>
                  {event.data.file}
                </span>
                <span className="text-gray-500">
                  (#{event.data.count})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary */}
      {events.some(e => e.type === 'complete') && (
        <div className="mt-4 pt-3 border-t border-gray-700">
          <div className="flex items-center justify-between text-green-400">
            <span>✓ Search Complete</span>
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
