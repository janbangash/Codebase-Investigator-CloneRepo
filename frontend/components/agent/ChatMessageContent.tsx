'use client';

import React, { useState } from 'react';

interface CodeReference {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
}

interface ChatMessageContentProps {
  content: string;
  codeReferences?: CodeReference[];
  onCodeClick?: (filePath: string, line: number) => void;
}

export function ChatMessageContent({ content, codeReferences = [], onCodeClick }: ChatMessageContentProps) {
  const [expandedCode, setExpandedCode] = useState<Set<number>>(new Set());

  const toggleCodeExpand = (index: number) => {
    const newExpanded = new Set(expandedCode);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedCode(newExpanded);
  };

  const copyToClipboard = async (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(text);
  };

  // Parse content into sections (markdown-like)
  const parseContent = (text: string) => {
    const sections: Array<{ type: 'header' | 'text' | 'list'; content: string }> = [];
    const lines = text.split('\n');

    for (const line of lines) {
      // Skip "Next Steps" section and generic tips
      if (line.includes('Next Steps') ||
          line.includes('Click any code reference') ||
          line.includes('Try refining your search') ||
          line.includes('Look for related symbols')) {
        continue;
      }
      if (line.startsWith('### ')) {
        sections.push({ type: 'header', content: line.slice(4) });
      } else if (line.startsWith('**') && line.endsWith('**')) {
        sections.push({ type: 'header', content: line.replace(/\*\*/g, '') });
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        // Skip generic tips
        if (line.includes('Use specific') || line.includes('Search for file') || line.includes('Use keywords')) {
          continue;
        }
        sections.push({ type: 'list', content: line.slice(2) });
      } else if (line.trim() && !line.startsWith('```')) {
        sections.push({ type: 'text', content: line });
      }
    }

    return sections;
  };

  const parsedSections = parseContent(content);

  return (
    <div className="space-y-3">
      {/* Parsed content sections */}
      {parsedSections.map((section, idx) => {
        if (section.type === 'header') {
          return (
            <h4 key={idx} className="text-sm font-semibold text-purple-300 mt-3 mb-1 first:mt-0">
              {section.content}
            </h4>
          );
        }
        if (section.type === 'list') {
          return (
            <li key={idx} className="text-sm text-gray-300 ml-4">
              {section.content}
            </li>
          );
        }
        if (section.type === 'text') {
          // Render text with inline formatting
          return (
            <p key={idx} className="text-sm text-gray-200 whitespace-pre-wrap">
              {section.content.split(/(\*\*.*?\*\*|`.*?`)/g).map((part, i) => {
                if (part.startsWith('**') && part.endsWith('**')) {
                  return <strong key={i} className="text-white">{part.slice(2, -2)}</strong>;
                }
                if (part.startsWith('`') && part.endsWith('`')) {
                  return <code key={i} className="bg-gray-800 px-1.5 py-0.5 rounded text-xs text-cyan-300">{part.slice(1, -1)}</code>;
                }
                return part;
              })}
            </p>
          );
        }
        return null;
      })}

      {/* Code references as VS Code-style cards */}
      {codeReferences.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
              Code References ({codeReferences.length})
            </span>
          </div>

          {codeReferences.map((ref, idx) => {
            const isExpanded = expandedCode.has(idx);

            return (
              <div
                key={idx}
                className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden hover:border-purple-600/50 transition-colors"
              >
                {/* Header with file path and line - using div instead of button */}
                <div
                  onClick={() => onCodeClick?.(ref.filePath, ref.startLine)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-gray-800/80 hover:bg-gray-700/80 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <svg className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="text-xs text-purple-300 font-mono truncate">
                      {ref.filePath}:{ref.startLine}
                    </span>
                    {ref.endLine > ref.startLine && (
                      <span className="text-xs text-gray-500">
                        ({ref.endLine - ref.startLine + 1} lines)
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <div
                      onClick={(e) => copyToClipboard(ref.content, e)}
                      className="p-1 hover:bg-gray-600 rounded transition-colors cursor-pointer"
                      title="Copy code"
                    >
                      <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div
                      onClick={(e) => { e.stopPropagation(); toggleCodeExpand(idx); }}
                      className="p-1 hover:bg-gray-600 rounded transition-colors cursor-pointer"
                      title={isExpanded ? 'Collapse' : 'Expand'}
                    >
                      <svg
                        className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Code preview */}
                {isExpanded && (
                  <div className="px-3 py-2 bg-gray-900/50 border-t border-gray-700">
                    <pre className="text-xs text-gray-300 overflow-x-auto font-mono leading-relaxed">
                      <code>{ref.content}</code>
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
