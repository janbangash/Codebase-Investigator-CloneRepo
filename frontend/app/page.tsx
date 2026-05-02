'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import AgentProgress from '../components/agent/AgentProgress';
import MatchPreview from '../components/agent/MatchPreview';
import { ChatMessageContent } from '../components/agent/ChatMessageContent';
import { AgentThoughts } from '../components/agent/AgentThoughts';

interface CloneProgress {
  status: 'pending' | 'cloning' | 'completed' | 'error';
  progress?: number;
  message?: string;
  error?: string;
}

interface RepoStatus {
  repoName: string;
  url: string;
  progress: CloneProgress;
}

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'folder';
}

interface SearchResult {
  filePath: string;
  line: number;
  content: string;
  matchLine: string;
  score?: number;
}

interface SearchAnalysis {
  keywords: string[];
  intent: string;
  suggestions: string[];
}

interface CodeChunk {
  repoName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  codeReferences?: { filePath: string; startLine: number; endLine: number; content: string }[];
}

interface StreamEvent {
  type: 'analyzing' | 'analyzed' | 'searching' | 'searching_file' | 'found_match' | 'search_complete' | 'responding' | 'complete' | 'error' | 'suggestion';
  data: {
    message?: string;
    matches?: number;
    file?: string;
    line?: number;
    count?: number;
    suggestions?: string[];
    response?: string;
    codeReferences?: CodeChunk[];
    keywords?: string[];
    time?: number;
    step?: number;
    total?: number;
  };
}

// Use relative /api path - Next.js rewrites to backend
const API_URL = '/api';
const DEFAULT_TARGET_FOLDER = 'cloned-repos';

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [repoStatuses, setRepoStatuses] = useState<Record<string, RepoStatus>>({});
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [fileContent, setFileContent] = useState<{ path: string; content: string; lines: string[]; highlightLine?: number } | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [folderChildren, setFolderChildren] = useState<Record<string, FileEntry[]>>({});
  const [socket, setSocket] = useState<Socket | null>(null);

  // AI Search Agent state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [searchAnalysis, setSearchAnalysis] = useState<SearchAnalysis | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // AI Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [indexStatus, setIndexStatus] = useState<{ indexing: boolean; indexed: boolean; chunkCount: number } | null>(null);
  const [streamEvents, setStreamEvents] = useState<StreamEvent[]>([]);
  const [currentThinking, setCurrentThinking] = useState<string>('');
  const [agentEvents, setAgentEvents] = useState<any[]>([]);
  const [liveMatches, setLiveMatches] = useState<any[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const fetchFiles = useCallback(async (repoName: string, path = '') => {
    try {
      const res = await fetch(`${API_URL}/git/files/${repoName}?path=${encodeURIComponent(path)}`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data);
        setCurrentPath(path);
      }
    } catch (err) {
      console.error('Failed to fetch files:', err);
    }
  }, []);

  const fetchFileContent = useCallback(async (repoName: string, filePath: string, highlightLine?: number) => {
    try {
      const res = await fetch(`${API_URL}/git/file/${repoName}?path=${encodeURIComponent(filePath)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.content) {
          const lines = data.content.split('\n');
          setFileContent({ path: filePath, content: data.content, lines, highlightLine });
        } else {
          console.error('No content in response:', data);
        }
      } else {
        console.error('Failed to fetch file:', filePath, res.status);
      }
    } catch (err) {
      console.error('Failed to fetch file content:', err);
    }
  }, []);

  const fetchFolderChildren = useCallback(async (repoName: string, folderPath: string) => {
    try {
      const res = await fetch(`${API_URL}/git/files/${repoName}?path=${encodeURIComponent(folderPath)}`);
      if (res.ok) {
        const data = await res.json();
        const childrenWithPaths = data.map((child: FileEntry) => ({
          ...child,
          path: folderPath ? `${folderPath}/${child.name}` : child.name,
        }));
        setFolderChildren(prev => ({ ...prev, [folderPath]: childrenWithPaths }));
      }
    } catch (err) {
      console.error('Failed to fetch folder children:', err);
    }
  }, []);

  const handleFolderClick = (folder: FileEntry) => {
    if (selectedRepo) {
      setPathHistory([...pathHistory, currentPath]);
      fetchFiles(selectedRepo, folder.path);
      setFileContent(null);
      setSearchActive(false);
    }
  };

  const handleFileClick = (file: FileEntry) => {
    if (selectedRepo) {
      fetchFileContent(selectedRepo, file.path);
      setSearchActive(false);
    }
  };

  const handleBack = () => {
    if (pathHistory.length > 0 && selectedRepo) {
      const previousPath = pathHistory[pathHistory.length - 1];
      setPathHistory(pathHistory.slice(0, -1));
      fetchFiles(selectedRepo, previousPath);
      setFileContent(null);
    }
  };

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim() || !selectedRepo) {
      return;
    }

    setIsSearching(true);
    setSearchActive(true);

    try {
      // Use AI-powered search with query analysis
      const res = await fetch(`${API_URL}/ai/search/${selectedRepo}?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        console.log('Search response:', data);
        // Handle both array and object with results
        if (Array.isArray(data)) {
          setSearchResults(data);
        } else if (data.results && Array.isArray(data.results)) {
          setSearchResults(data.results);
          if (data.analysis) {
            setSearchAnalysis(data.analysis);
            console.log('Search analysis:', data.analysis);
          }
        } else if (data.chunks && Array.isArray(data.chunks)) {
          setSearchResults(data.chunks);
          if (data.analysis) {
            setSearchAnalysis(data.analysis);
          }
        } else if (typeof data === 'object' && data !== null) {
          // Handle case where response has results and analysis at top level
          if (Array.isArray(data.items)) {
            setSearchResults(data.items);
          }
          if (data.analysis) {
            setSearchAnalysis(data.analysis);
          }
        }
      }
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setIsSearching(false);
    }
  }, [selectedRepo]);

  // Debounced search - keeps results stable
  useEffect(() => {
    const debounce = setTimeout(() => {
      if (searchQuery) {
        handleSearch(searchQuery);
      }
    }, 500);

    return () => clearTimeout(debounce);
  }, [searchQuery, handleSearch]);

  // Clear results only when user explicitly clears
  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setSearchAnalysis(null);
    setSearchActive(false);
  }, []);

  // Chat functions
  const [ollamaAvailable, setOllamaAvailable] = useState(false);

  const checkOllamaStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/ai/available`);
      if (res.ok) {
        const data = await res.json();
        setOllamaAvailable(data.available);
      }
    } catch (err) {
      console.error('Failed to check Ollama status:', err);
    }
  }, []);

  const fetchIndexStatus = useCallback(async (repoName: string) => {
    try {
      const res = await fetch(`${API_URL}/ai/status/${repoName}`);
      if (res.ok) {
        const data = await res.json();
        setIndexStatus(data);
      }
    } catch (err) {
      console.error('Failed to fetch index status:', err);
    }
  }, []);

  const handleSendMessage = useCallback(async () => {
    if (!chatInput.trim() || !selectedRepo) return;

    const userMessage: ChatMessage = { role: 'user', content: chatInput };
    setChatMessages(prev => [...prev, userMessage]);
    setChatInput('');
    setIsChatLoading(true);
    setStreamEvents([]);
    setCurrentThinking('');
    setAgentEvents([]);
    setLiveMatches([]);

    try {
      // Use Next.js API route for proper SSE streaming (works for both localhost and ngrok)
      console.log('[Chat] Starting fetch to:', `/api/ai/chat-stream/${selectedRepo}`);
      console.log('[Chat] Current origin:', window.location.origin);

      const res = await fetch(`/api/ai/chat-stream/${selectedRepo}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [userMessage] }),
      });

      console.log('[Chat] Response status:', res.status);
      console.log('[Chat] Response headers:', Object.fromEntries(res.headers.entries()));
      console.log('[Chat] Response body exists:', !!res.body);
      console.log('[Chat] Response ok:', res.ok);

      if (!res.ok || !res.body) {
        console.error('[Chat] Streaming failed - status:', res.status, 'body:', res.body);
        throw new Error('Streaming failed');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantMessage = '';
      let codeRefs: CodeChunk[] = [];
      let chunkCount = 0;

      console.log('[Chat] Starting to read stream...');

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('[Chat] Stream done');
          break;
        }

        chunkCount++;
        console.log('[Chat] Received chunk:', chunkCount, 'bytes:', value?.length);

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event: StreamEvent = JSON.parse(line.slice(6));
              console.log('[Chat] Parsed event:', event.type);
              setStreamEvents(prev => [...prev, event]);
              setAgentEvents(prev => [...prev, event]);

              // Handle CURSOR-LIKE granular events
              if (event.type === 'analyzing') {
                setCurrentThinking(event.data.message || 'Analyzing query...');
              } else if (event.type === 'analyzed') {
                setCurrentThinking(`Keywords: ${event.data.keywords?.join(', ')}`);
              } else if (event.type === 'searching_file') {
                // Show every file being searched
                setCurrentThinking(`Searching: ${event.data.file}`);
              } else if (event.type === 'found_match') {
                // Show every match found
                setLiveMatches(prev => [...prev, {
                  file: event.data.file,
                  line: event.data.line,
                  count: event.data.count,
                }].slice(-15)); // Keep last 15 matches
              } else if (event.type === 'search_complete') {
                setCurrentThinking(`Found ${event.data.matches} matches in ${event.data.time}ms`);
              } else if (event.type === 'responding') {
                setCurrentThinking('Generating response...');
              } else if (event.type === 'complete') {
                assistantMessage = event.data.response || '';
                codeRefs = event.data.codeReferences || [];
                setCurrentThinking(`Done in ${event.data.time}ms`);
              } else if (event.type === 'error') {
                console.error('Stream error:', event.data.message);
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }

      // Add final assistant message
      if (assistantMessage || codeRefs.length > 0) {
        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: assistantMessage || 'Search completed.',
          codeReferences: codeRefs,
        }]);
      }

      setCurrentThinking('');
      setStreamEvents([]);
    } catch (err) {
      console.error('Chat failed:', err);
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err.message}. Please try again.`,
      }]);
    } finally {
      setIsChatLoading(false);
    }
  }, [chatInput, chatMessages, selectedRepo]);

  const handleStartIndex = useCallback(async () => {
    if (!selectedRepo) return;
    try {
      await fetch(`${API_URL}/ai/index/${selectedRepo}`, { method: 'POST' });
      const checkStatus = setInterval(async () => {
        const res = await fetch(`${API_URL}/ai/status/${selectedRepo}`);
        if (res.ok) {
          const data = await res.json();
          setIndexStatus(data);
          if (!data.indexing) clearInterval(checkStatus);
        }
      }, 2000);
      fetchIndexStatus(selectedRepo);
    } catch (err) {
      console.error('Failed to start indexing:', err);
    }
  }, [selectedRepo, fetchIndexStatus]);

  const handleCodeReferenceClick = (filePath: string, startLine: number) => {
    fetchFileContent(selectedRepo!, filePath, startLine);
    setChatOpen(false);
  };

  useEffect(() => {
    // Connect WebSocket to backend
    // For localhost: direct connection to localhost:4000
    // For ngrok: WebSocket won't work without separate backend tunnel (limitation of single tunnel)
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';
    const newSocket = io(backendUrl, {
      transports: ['websocket'],
      path: '/git/socket.io',
      reconnection: true,
      reconnectionAttempts: 5,
    });

    newSocket.on('connect', () => {
      console.log('Connected to WebSocket');
    });

    newSocket.on('clone-progress', (data: { repoName: string; url?: string } & CloneProgress) => {
      setRepoStatuses(prev => ({
        ...prev,
        [data.repoName]: {
          repoName: data.repoName,
          url: data.url || prev[data.repoName]?.url || '',
          progress: data,
        },
      }));

      if (data.status === 'completed' && !selectedRepo) {
        setSelectedRepo(data.repoName);
        fetchFiles(data.repoName);
      }
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [selectedRepo, fetchFiles]);

  useEffect(() => {
    const fetchExistingRepos = async () => {
      try {
        const res = await fetch(`${API_URL}/git/repos`);
        if (res.ok) {
          const data = await res.json();
          const statuses: Record<string, RepoStatus> = {};
          for (const repo of data) {
            statuses[repo.name] = {
              repoName: repo.name,
              url: '',
              progress: repo.progress,
            };
          }
          setRepoStatuses(statuses);

          const completedRepos = Object.entries(statuses).filter(
            ([, s]) => s.progress.status === 'completed'
          );
          if (completedRepos.length > 0 && !selectedRepo) {
            const [firstRepo] = completedRepos;
            setSelectedRepo(firstRepo[0]);
            fetchFiles(firstRepo[0]);
          }
        }
      } catch (err) {
        console.error('Failed to fetch existing repos:', err);
      }
    };

    fetchExistingRepos();
    checkOllamaStatus();
  }, [checkOllamaStatus]);

  useEffect(() => {
    if (selectedRepo && chatOpen) {
      fetchIndexStatus(selectedRepo);
      checkOllamaStatus();
    }
  }, [selectedRepo, chatOpen, fetchIndexStatus, checkOllamaStatus]);

  useEffect(() => {
    const fetchProgress = async () => {
      try {
        const res = await fetch(`${API_URL}/git/progress`);
        const data = await res.json();

        setRepoStatuses(prev => {
          const updated = { ...prev };
          for (const [repoName, progress] of Object.entries(data)) {
            if (!updated[repoName]) {
              updated[repoName] = {
                repoName,
                url: '',
                progress: progress as CloneProgress,
              };
            } else {
              updated[repoName].progress = progress as CloneProgress;
            }
          }
          return updated;
        });
      } catch (err) {
        console.error('Failed to fetch progress:', err);
      }
    };

    const interval = setInterval(fetchProgress, 2000);
    fetchProgress();

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch(`${API_URL}/git/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, targetFolder: DEFAULT_TARGET_FOLDER }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage({ type: 'success', text: `Started cloning ${data.repoName}` });
        setRepoStatuses(prev => ({
          ...prev,
          [data.repoName]: {
            repoName: data.repoName,
            url,
            progress: { status: 'pending', progress: 0, message: 'Starting...' },
          },
        }));
        setUrl('');
        if (!selectedRepo) {
          setSelectedRepo(data.repoName);
        }
      } else {
        setMessage({ type: 'error', text: data.message || 'Failed to start clone' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to connect to server' });
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500';
      case 'cloning': return 'bg-blue-500 animate-pulse';
      case 'completed': return 'bg-green-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const toggleFolder = (folderPath: string, folder: FileEntry) => {
    const newExpanded = new Set(expandedFolders || []);
    if (newExpanded.has(folderPath)) {
      newExpanded.delete(folderPath);
    } else {
      newExpanded.add(folderPath);
      if (selectedRepo && !folderChildren[folderPath]) {
        fetchFolderChildren(selectedRepo, folder.path);
      }
    }
    setExpandedFolders(newExpanded);
  };

  const renderFileTree = (entries: FileEntry[], depth = 0, parentPath = '') => {
    return entries.map((entry) => {
      const fullPath = entry.path;
      const isExpanded = expandedFolders?.has(fullPath) || false;
      const children = folderChildren[fullPath] || [];

      return (
        <div key={fullPath}>
          <div
            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all group ${
              fileContent?.path === fullPath
                ? 'bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/30'
                : 'hover:bg-[var(--border-color)] border border-transparent'
            }`}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={(e) => {
              e.stopPropagation();
              if (entry.type === 'folder') {
                toggleFolder(fullPath, entry);
              } else {
                handleFileClick(entry);
              }
            }}
          >
            {entry.type === 'folder' ? (
              <svg
                className={`w-3.5 h-3.5 text-gray-500 transition-transform ${
                  isExpanded ? 'rotate-90' : ''
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 text-gray-500 group-hover:text-gray-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                />
              </svg>
            )}
            {entry.type === 'folder' ? (
              <svg className="w-4 h-4 text-yellow-500/80 group-hover:text-yellow-400 transition-colors" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-blue-400/80 group-hover:text-blue-300 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            )}
            <span className="text-gray-300 text-xs sm:text-sm truncate flex-1 group-hover:text-white transition-colors">{entry.name}</span>
          </div>
          {entry.type === 'folder' && isExpanded && (
            <div>
              {children.length > 0 ? renderFileTree(children, depth + 1, fullPath) : (
                <div className="text-gray-500 text-xs pl-6 py-2 flex items-center gap-2">
                  <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Loading...
                </div>
              )}
            </div>
          )}
        </div>
      );
    });
  };

  const highlightText = (text: string, query: string) => {
    if (!query) return text;
    // Escape special regex characters safely
    const escapedQuery = query.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    const regex = new RegExp('(' + escapedQuery + ')', 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? <mark key={i} className="bg-[var(--accent-secondary)]/30 text-[var(--accent-secondary)] px-0.5 rounded font-medium">{part}</mark> : part
    );
  };

  return (
    <div className="min-h-screen bg-[var(--background)] flex flex-col" suppressHydrationWarning>
      {/* Header */}
      <header className="bg-[var(--panel-bg)] border-b border-[var(--border-color)] px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between sticky top-0 z-50 backdrop-blur-sm bg-opacity-95">
        <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
          {/* Logo/Icon */}
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-gradient-to-br from-[var(--accent-primary)] to-[var(--accent-secondary)] flex items-center justify-center shrink-0 shadow-lg">
            <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base sm:text-xl font-bold text-[var(--foreground)] truncate">Codebase Investigator</h1>
            <p className="text-xs sm:text-sm text-gray-400 hidden sm:block">
              AI-Powered Code Explorer
            </p>
          </div>
        </div>

        {selectedRepo && (
          <button
            onClick={() => setChatOpen(!chatOpen)}
            className={`ml-2 sm:ml-4 px-3 sm:px-4 py-2 rounded-lg font-medium transition-all shadow-md hover:shadow-lg flex items-center gap-2 ${
              chatOpen
                ? 'bg-gradient-to-r from-[var(--accent-secondary)] to-purple-500 text-white'
                : 'bg-[var(--sidebar-bg)] text-gray-300 hover:bg-[var(--border-color)] border border-[var(--border-color)]'
            }`}
          >
            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <span className="hidden sm:inline">AI Chat</span>
          </button>
        )}
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Clone Form & Repo List - Collapsible on mobile */}
        <div className="w-72 sm:w-80 lg:w-96 bg-[var(--sidebar-bg)] border-r border-[var(--border-color)] flex flex-col overflow-hidden absolute sm:relative z-40 h-full transform transition-transform duration-300 ease-in-out">
          {/* Clone Form */}
          <div className="p-3 sm:p-4 border-b border-[var(--border-color)] bg-gradient-to-b from-[var(--panel-bg)] to-[var(--sidebar-bg)]">
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label htmlFor="url" className="block text-xs sm:text-sm font-medium text-gray-300 mb-1">
                  Repository URL
                </label>
                <input
                  id="url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo"
                  className="w-full px-3 py-2 sm:py-2.5 bg-[var(--panel-bg)] border border-[var(--border-color)] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] focus:border-transparent text-sm transition-all"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 sm:py-2.5 px-4 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:from-gray-600 disabled:to-gray-500 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-all shadow-md hover:shadow-lg text-sm sm:text-base"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Cloning...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Clone Repository
                  </span>
                )}
              </button>
              {message && (
                <div
                  className={`p-2.5 rounded-lg text-sm flex items-center gap-2 ${
                    message.type === 'success'
                      ? 'bg-green-900/30 text-green-300 border border-green-800/50'
                      : 'bg-red-900/30 text-red-300 border border-red-800/50'
                  }`}
                >
                  {message.type === 'success' ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  )}
                  {message.text}
                </div>
              )}
            </form>
          </div>

          {/* Repo List */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4">
            <h2 className="text-xs sm:text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              Repositories
            </h2>
            <div className="space-y-2">
              {Object.values(repoStatuses).map(({ repoName, progress }) => (
                <div
                  key={repoName}
                  className={`bg-[var(--panel-bg)] rounded-lg p-3 cursor-pointer transition-all group ${
                    selectedRepo === repoName
                      ? 'ring-2 ring-[var(--accent-primary)] shadow-lg shadow-blue-900/20'
                      : 'hover:bg-[var(--border-color)] border border-transparent hover:border-[var(--border-color)]'
                  }`}
                  onClick={() => {
                    setSelectedRepo(repoName);
                    fetchFiles(repoName);
                    setFileContent(null);
                    setSearchActive(false);
                    setChatMessages([]);
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white font-medium text-sm truncate flex-1">{repoName}</span>
                    <span
                      className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium text-white shrink-0 ${
                        progress.status === 'completed' ? 'bg-green-600' :
                        progress.status === 'error' ? 'bg-red-600' :
                        progress.status === 'cloning' ? 'bg-blue-600 animate-pulse' :
                        'bg-yellow-600'
                      }`}
                    >
                      {progress.status === 'completed' ? '✓' : progress.status === 'error' ? '!' : progress.status === 'cloning' ? '⟳' : '○'}
                    </span>
                  </div>
                  {progress.error && (
                    <p className="text-red-400 text-xs mt-1 flex items-center gap-1">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                      {progress.error}
                    </p>
                  )}
                  {progress.progress !== undefined && (
                    <div className="mt-2">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-400">Progress</span>
                        <span className="text-white font-medium">{progress.progress}%</span>
                      </div>
                      <div className="bg-[var(--background)] rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            progress.status === 'completed' ? 'bg-green-500' : 'bg-gradient-to-r from-blue-500 to-blue-400'
                          }`}
                          style={{ width: `${progress.progress}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {!progress.error && progress.status !== 'completed' && progress.message && (
                    <p className="text-gray-500 text-xs mt-2 truncate">{progress.message}</p>
                  )}
                </div>
              ))}
              {Object.keys(repoStatuses).length === 0 && (
                <div className="text-center py-8">
                  <svg className="w-12 h-12 text-gray-600 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <p className="text-gray-500 text-sm">No repositories yet</p>
                  <p className="text-gray-600 text-xs mt-1">Clone your first repo above</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Main Content - File Browser & Viewer */}
        <div className="flex-1 flex overflow-hidden">
          {/* File List / Search Panel - Collapsible on mobile */}
          <div className="w-64 sm:w-72 md:w-80 bg-[var(--panel-bg)] border-r border-[var(--border-color)] flex flex-col overflow-hidden absolute sm:relative z-30 h-full transition-all">
            <div className="p-3 border-b border-[var(--border-color)]">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs sm:text-sm font-semibold text-gray-400 uppercase tracking-wider truncate flex-1">
                  {selectedRepo || 'Select a repo'}
                </h2>
                {pathHistory.length > 0 && !searchActive && (
                  <button
                    onClick={handleBack}
                    className="ml-2 p-1.5 text-gray-400 hover:text-white hover:bg-[var(--border-color)] rounded-lg transition-colors"
                    title="Go back"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
              </div>
              {/* AI Search */}
              <div className="relative mt-2">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search code..."
                  className="w-full pl-9 pr-8 py-2 sm:py-2 bg-[var(--sidebar-bg)] border border-[var(--border-color)] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[var(--accent-secondary)] focus:border-transparent text-xs sm:text-sm transition-all"
                />
                {isSearching && (
                  <div className="absolute inset-y-0 right-0 pr-2 flex items-center">
                    <svg className="animate-spin h-4 w-4 text-[var(--accent-secondary)]" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  </div>
                )}
              </div>
                {/* Search Analysis Panel */}
                {(searchActive || searchQuery) && (searchResults.length > 0 || searchAnalysis || isSearching) && (
                  <div className="mt-3 border-t border-[var(--border-color)] pt-3">
                    {/* AI Analysis Header */}
                    <div className="flex items-center justify-between px-3 py-2.5 bg-gradient-to-r from-[var(--accent-secondary)]/10 to-[var(--panel-bg)] rounded-lg border border-[var(--border-color)] mb-3">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <svg className="w-4 h-4 text-[var(--accent-secondary)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                        <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
                          <span className="text-xs font-semibold text-[var(--accent-secondary)] shrink-0">AI Analysis:</span>
                          {isSearching && !searchAnalysis && (
                            <div className="flex items-center gap-2">
                              <svg className="animate-spin h-3 w-3 text-[var(--accent-secondary)]" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              <span className="text-xs text-gray-400">Analyzing...</span>
                            </div>
                          )}
                          {searchAnalysis && (
                            <>
                              {searchAnalysis.keywords && searchAnalysis.keywords.length > 0 && (
                                <div className="flex items-center gap-1 flex-wrap min-w-0">
                                  <span className="text-xs text-gray-500 shrink-0">Keywords:</span>
                                  {searchAnalysis.keywords.slice(0, 5).map((kw, i) => (
                                    <span key={i} className="text-xs bg-[var(--accent-secondary)]/20 text-[var(--accent-secondary)] px-2 py-0.5 rounded-full border border-[var(--accent-secondary)]/30 shrink-0">
                                      {kw}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {searchAnalysis.intent && (
                                <div className="flex items-center gap-1 shrink-0">
                                  <span className="text-xs text-gray-500 shrink-0">Intent:</span>
                                  <span className="text-xs bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full border border-blue-500/30 shrink-0 capitalize">
                                    {searchAnalysis.intent}
                                  </span>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-xs text-gray-500 shrink-0">
                          {searchResults.length} results
                        </span>
                        <button
                          onClick={handleClearSearch}
                          className="p-1 text-gray-400 hover:text-[var(--accent-secondary)] hover:bg-[var(--accent-secondary)]/10 rounded transition-colors"
                          title="Clear search"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    {/* Search Results */}
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {searchResults.slice(0, 12).map((result, idx) => (
                        <div
                          key={`${result.filePath}-${result.line}`}
                          className="group bg-[var(--sidebar-bg)] rounded-lg p-2.5 cursor-pointer hover:bg-[var(--border-color)] hover:shadow-md transition-all border border-transparent hover:border-[var(--accent-secondary)]/30"
                          onClick={() => fetchFileContent(selectedRepo!, result.filePath, result.line)}
                        >
                          <div className="flex items-center gap-2 text-xs mb-1.5">
                            <svg className="w-3.5 h-3.5 text-[var(--accent-secondary)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="truncate flex-1 font-mono text-gray-400 group-hover:text-gray-300">{result.filePath}</span>
                            <span className="text-[var(--accent-secondary)] shrink-0 font-mono">:{result.line}</span>
                          </div>
                          <p className="text-xs text-gray-400 font-mono truncate leading-relaxed group-hover:text-gray-300">
                            {highlightText(result.content, searchQuery)}
                          </p>
                        </div>
                      ))}
                      {searchResults.length > 12 && (
                        <p className="text-xs text-gray-500 text-center py-2">
                          +{searchResults.length - 12} more results. Refine your search.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {/* File Tree */}
              <div className="flex-1 overflow-y-auto p-2 border-t border-[var(--border-color)]">
                {selectedRepo ? (
                  files.length > 0 ? (
                    <>
                      {searchActive && searchResults.length > 0 && (
                        <div className="mb-2 px-2">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">File Browser</p>
                        </div>
                      )}
                      {renderFileTree(files)}
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center px-4">
                      <svg className="w-10 h-10 text-gray-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      <p className="text-gray-500 text-sm">
                        {repoStatuses[selectedRepo]?.progress.status !== 'completed'
                          ? 'Cloning in progress...'
                          : 'No files found'}
                      </p>
                    </div>
                  )
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center px-4">
                    <svg className="w-10 h-10 text-gray-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <p className="text-gray-500 text-sm">Select a repository</p>
                  </div>
                )}
              </div>
            </div>

            {/* File Content Viewer */}
            <div className="flex-1 bg-[var(--background)] overflow-hidden flex flex-col">
              {fileContent ? (
                <>
                  <div className="px-3 sm:px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--panel-bg)] flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <svg className="w-4 h-4 text-[var(--accent-primary)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <p className="text-gray-400 text-xs sm:text-sm font-mono truncate">{fileContent.path}</p>
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto">
                    <pre className="text-xs sm:text-sm text-gray-300 font-mono leading-relaxed">
                      <code>
                        {fileContent.lines.map((line, idx) => (
                          <div
                            key={idx}
                            className={`flex hover:bg-[var(--panel-bg)] transition-colors ${
                              fileContent.highlightLine === idx + 1
                                ? 'bg-[var(--accent-secondary)]/10 border-l-2 border-[var(--accent-secondary)]'
                                : ''
                            }`}
                          >
                            <span className="text-gray-600 select-none w-8 sm:w-12 text-right pr-3 sm:pr-4 py-0.5 bg-[var(--panel-bg)] border-r border-[var(--border-color)] shrink-0">
                              {idx + 1}
                            </span>
                            <span className="flex-1 pr-4 py-0.5 whitespace-pre overflow-x-auto">
                              {line || ' '}
                            </span>
                          </div>
                        ))}
                      </code>
                    </pre>
                  </div>
                </>
              ) : searchActive && searchResults.length > 0 ? (
                <div className="flex-1 flex items-center justify-center bg-gradient-to-b from-[var(--panel-bg)] to-[var(--background)]">
                  <div className="text-center px-4">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[var(--accent-secondary)]/20 to-[var(--accent-primary)]/20 flex items-center justify-center">
                      <svg className="w-8 h-8 text-[var(--accent-secondary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <p className="text-gray-400 text-sm mb-1">Select a result to view</p>
                    <p className="text-gray-500 text-xs">
                      Found <span className="text-[var(--accent-secondary)] font-medium">{searchResults.length}</span> matches
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center bg-gradient-to-b from-[var(--panel-bg)] to-[var(--background)]">
                  <div className="text-center px-4">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[var(--accent-primary)]/20 to-[var(--accent-secondary)]/20 flex items-center justify-center">
                      <svg className="w-8 h-8 text-[var(--accent-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                      </svg>
                    </div>
                    <p className="text-gray-400 text-sm mb-1">Explore your codebase</p>
                    <p className="text-gray-500 text-xs">Select a file or use AI Chat</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* AI Chat Panel - Fixed width, slides in on mobile */}
          {chatOpen && (
            <div className="w-full sm:w-96 bg-[var(--panel-bg)] border-l border-[var(--border-color)] flex flex-col absolute right-0 top-0 h-full z-50 shadow-2xl">
              {/* Chat Header */}
              <div className="px-4 py-3 border-b border-[var(--border-color)] bg-gradient-to-r from-[var(--accent-secondary)]/10 to-[var(--panel-bg)] flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--accent-secondary)] to-purple-600 flex items-center justify-center shrink-0 shadow-md">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-white font-semibold text-sm">AI Assistant</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`w-2 h-2 rounded-full ${ollamaAvailable ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`} />
                      <p className="text-xs text-gray-400 truncate">
                        {ollamaAvailable
                          ? (indexStatus?.indexed ? `${indexStatus.chunkCount} chunks indexed` : 'Ready')
                          : 'Basic mode'}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!indexStatus?.indexed && !indexStatus?.indexing && ollamaAvailable && (
                    <button
                      onClick={handleStartIndex}
                      className="px-2.5 py-1.5 bg-gradient-to-r from-[var(--accent-secondary)] to-purple-600 hover:from-purple-500 hover:to-purple-500 text-white text-xs rounded-lg transition-all shadow-md hover:shadow-lg"
                    >
                      Index
                    </button>
                  )}
                  <button
                    onClick={() => setChatOpen(false)}
                    className="p-1.5 text-gray-400 hover:text-white hover:bg-[var(--border-color)] rounded-lg transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
                {/* Progress Panel during search */}
                {isChatLoading && agentEvents.length > 0 && (
                  <div className="sticky top-0 z-10">
                    <AgentProgress events={agentEvents} />
                    {liveMatches.length > 0 && (
                      <div className="mt-2">
                        <MatchPreview matches={liveMatches} onNavigate={handleCodeReferenceClick} />
                      </div>
                    )}
                  </div>
                )}

                {/* Empty State */}
                {chatMessages.length === 0 && streamEvents.length === 0 && !isChatLoading ? (
                  <div className="text-center text-gray-500 mt-8 px-4">
                    <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[var(--accent-secondary)]/20 to-purple-500/20 flex items-center justify-center">
                      <svg className="w-7 h-7 text-[var(--accent-secondary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-gray-300 mb-1">AI Code Assistant</p>
                    <p className="text-xs text-gray-500 mb-4">
                      {ollamaAvailable ? 'Powered by Ollama' : 'Basic search mode'}
                    </p>

                    <div className="text-left space-y-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Try asking:</p>
                      {[
                        { text: 'Find authentication methods', icon: '🔍' },
                        { text: 'Show API structure', icon: '🔌' },
                        { text: 'Database config?', icon: '🗄️' },
                        { text: 'Explain entry point', icon: '📖' },
                      ].map((suggestion, i) => (
                        <button
                          key={i}
                          onClick={() => setChatInput([
                            'Find all authentication methods in this codebase',
                            'Show me how API endpoints are structured',
                            'Where are database connections configured?',
                            'Explain the main entry point and how the app starts',
                          ][i])}
                          className="w-full text-left text-xs text-gray-300 hover:text-[var(--accent-secondary)] hover:bg-[var(--sidebar-bg)] rounded-lg px-3 py-2 transition-all flex items-center gap-2"
                        >
                          <span className="text-sm">{suggestion.icon}</span>
                          {suggestion.text}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Streaming events */}
                    {streamEvents.map((event, idx) => (
                      <div key={idx} className="flex justify-start">
                        <div className="max-w-[85%] rounded-xl p-3 bg-[var(--sidebar-bg)]/50 text-gray-300 border border-[var(--border-color)]">
                          {event.type === 'thinking' && (
                            <div className="flex items-center gap-2">
                              <svg className="animate-spin h-4 w-4 text-[var(--accent-secondary)]" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              <p className="text-xs">{event.data.message}</p>
                            </div>
                          )}
                          {event.type === 'searching' && (
                            <div className="flex items-center gap-2">
                              <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                              </svg>
                              <p className="text-xs">{event.data.message}</p>
                            </div>
                          )}
                          {event.type === 'found' && (
                            <div className="flex items-center gap-2">
                              <svg className="w-4 h-4 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                              </svg>
                              <p className="text-xs text-green-300">{event.data.message}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}

                    {/* Chat messages */}
                    {chatMessages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl p-3 ${
                            msg.role === 'user'
                              ? 'bg-gradient-to-r from-[var(--accent-secondary)] to-purple-600 text-white shadow-lg'
                              : 'bg-[var(--sidebar-bg)] border border-[var(--border-color)] text-gray-100'
                          }`}
                        >
                          {msg.role === 'user' ? (
                            <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                          ) : (
                            <ChatMessageContent
                              content={msg.content}
                              codeReferences={msg.codeReferences}
                              onCodeClick={handleCodeReferenceClick}
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {/* Loading indicator */}
                {isChatLoading && streamEvents.length === 0 && (
                  <div className="flex justify-start">
                    <div className="bg-[var(--sidebar-bg)] rounded-xl p-3 border border-[var(--border-color)]">
                      <div className="flex gap-1.5">
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}

                <AgentThoughts thinking={currentThinking} isComplete={streamEvents.some(e => e.type === 'complete')} />
                <div ref={chatEndRef} />
              </div>

              {/* Chat Input */}
              <div className="p-3 sm:p-4 border-t border-[var(--border-color)] bg-[var(--sidebar-bg)]">
                <form
                  onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask about the code..."
                    className="flex-1 px-3 sm:px-4 py-2.5 bg-[var(--panel-bg)] border border-[var(--border-color)] rounded-xl text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[var(--accent-secondary)] focus:border-transparent transition-all"
                    disabled={isChatLoading}
                  />
                  <button
                    type="submit"
                    disabled={isChatLoading || !chatInput.trim()}
                    className="px-3 sm:px-4 py-2.5 bg-gradient-to-r from-[var(--accent-secondary)] to-purple-600 hover:from-purple-500 hover:to-purple-500 disabled:from-gray-600 disabled:to-gray-500 disabled:cursor-not-allowed text-white rounded-xl transition-all shadow-md hover:shadow-lg"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  </button>
                </form>
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
