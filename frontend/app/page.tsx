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
            className={`flex items-center gap-2 px-2 py-1 hover:bg-gray-700 rounded cursor-pointer ${
              fileContent?.path === fullPath ? 'bg-gray-700' : ''
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
                className={`w-4 h-4 text-gray-400 transition-transform ${
                  isExpanded ? 'rotate-90' : ''
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                />
              </svg>
            )}
            {entry.type === 'folder' ? (
              <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            )}
            <span className="text-gray-300 text-sm truncate">{entry.name}</span>
          </div>
          {entry.type === 'folder' && isExpanded && (
            <div>
              {children.length > 0 ? renderFileTree(children, depth + 1, fullPath) : (
                <div className="text-gray-500 text-xs pl-6 py-1">Loading...</div>
              )}
            </div>
          )}
        </div>
      );
    });
  };

  const highlightText = (text: string, query: string) => {
    if (!query) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? <mark key={i} className="bg-yellow-500/50 text-white px-0.5 rounded">{part}</mark> : part
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800">
      <div className="h-screen flex flex-col" suppressHydrationWarning>
        <header className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">GitHub Repository Cloner</h1>
            <p className="text-gray-400 text-sm mt-1">
              Clone repositories to: <code className="bg-gray-700 px-2 py-1 rounded">{DEFAULT_TARGET_FOLDER}</code>
            </p>
          </div>
          {selectedRepo && (
            <button
              onClick={() => setChatOpen(!chatOpen)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                chatOpen ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                AI Chat
              </div>
            </button>
          )}
        </header>

        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar - Clone Form & Repo List */}
          <div className="w-96 bg-gray-800 border-r border-gray-700 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-gray-700">
              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label htmlFor="url" className="block text-sm font-medium text-gray-300 mb-1">
                    GitHub Repository URL
                  </label>
                  <input
                    id="url"
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo"
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-medium rounded transition-colors text-sm"
                >
                  {loading ? 'Cloning...' : 'Clone Repository'}
                </button>
                {message && (
                  <div
                    className={`p-2 rounded text-sm ${
                      message.type === 'success'
                        ? 'bg-green-900/50 text-green-200'
                        : 'bg-red-900/50 text-red-200'
                    }`}
                  >
                    {message.text}
                  </div>
                )}
              </form>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Cloned Repositories
              </h2>
              <div className="space-y-3">
                {Object.values(repoStatuses).map(({ repoName, progress }) => (
                  <div
                    key={repoName}
                    className={`bg-gray-700 rounded-lg p-3 cursor-pointer transition-colors ${
                      selectedRepo === repoName ? 'ring-2 ring-blue-500' : 'hover:bg-gray-650'
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
                      <span className="text-white font-medium text-sm truncate">{repoName}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium text-white ${getStatusColor(
                          progress.status
                        )}`}
                      >
                        {progress.status === 'completed' ? 'DONE' : progress.status.toUpperCase()}
                      </span>
                    </div>
                    {progress.error && (
                      <p className="text-red-400 text-xs mt-1">{progress.error}</p>
                    )}
                    {progress.progress !== undefined && (
                      <div className="mt-2">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-400">Progress</span>
                          <span className="text-white font-medium">{progress.progress}%</span>
                        </div>
                        <div className="bg-gray-600 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full transition-all duration-300 ${
                              progress.status === 'completed' ? 'bg-green-500' : 'bg-blue-500'
                            }`}
                            style={{ width: `${progress.progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                    {!progress.error && progress.status !== 'completed' && progress.message && (
                      <p className="text-gray-400 text-xs mt-2">{progress.message}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Content - File Browser & AI Agent */}
          <div className={`flex-1 flex overflow-hidden ${chatOpen ? 'mr-96' : ''}`}>
            {/* File List / Search Results */}
            <div className="w-80 bg-gray-800 border-r border-gray-700 flex flex-col overflow-hidden">
              <div className="p-3 border-b border-gray-700">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                    {selectedRepo || 'Select a repository'}
                  </h2>
                  {pathHistory.length > 0 && !searchActive && (
                    <button
                      onClick={handleBack}
                      className="text-gray-400 hover:text-white transition-colors"
                      title="Go back"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 19l-7-7 7-7"
                        />
                      </svg>
                    </button>
                  )}
                </div>
                {/* AI Search Agent */}
                <div className="relative mt-2">
                  <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search in repo..."
                    className="w-full pl-8 pr-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-xs placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                  {isSearching && (
                    <div className="absolute inset-y-0 right-0 pr-2 flex items-center">
                      <svg className="animate-spin h-3 w-3 text-purple-400" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    </div>
                  )}
                </div>
                {/* Search Analysis Panel - Always visible when search is active */}
                {(searchActive || searchQuery) && (searchResults.length > 0 || searchAnalysis || isSearching) && (
                  <div className="mt-2 border-t border-gray-600">
                    {/* AI Analysis Header */}
                    <div className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-purple-900/40 to-gray-800/50 rounded-t border-b border-gray-700">
                      <div className="flex items-center gap-2 flex-1">
                        <svg className="w-4 h-4 text-purple-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                        <div className="flex items-center gap-3 flex-1 flex-wrap">
                          <span className="text-xs font-semibold text-purple-300 shrink-0">
                            AI Query Analysis:
                          </span>
                          {isSearching && !searchAnalysis && (
                            <div className="flex items-center gap-2">
                              <svg className="animate-spin h-3 w-3 text-purple-400" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                              <span className="text-xs text-gray-400">Analyzing query...</span>
                            </div>
                          )}
                          {searchAnalysis && (
                            <>
                              {searchAnalysis.keywords && searchAnalysis.keywords.length > 0 && (
                                <div className="flex items-center gap-1 flex-wrap">
                                  <span className="text-xs text-gray-400 shrink-0">Keywords:</span>
                                  {searchAnalysis.keywords.slice(0, 6).map((kw, i) => (
                                    <span key={i} className="text-xs bg-purple-900/60 text-purple-200 px-2 py-0.5 rounded-full border border-purple-700/50 shrink-0">
                                      {kw}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {searchAnalysis.intent && (
                                <div className="flex items-center gap-1">
                                  <span className="text-xs text-gray-400 shrink-0">Intent:</span>
                                  <span className="text-xs bg-blue-900/60 text-blue-200 px-2 py-0.5 rounded-full border border-blue-700/50 shrink-0 capitalize">
                                    {searchAnalysis.intent}
                                  </span>
                                </div>
                              )}
                              {searchAnalysis.suggestions && searchAnalysis.suggestions.length > 0 && (
                                <div className="flex items-center gap-1 flex-wrap">
                                  <span className="text-xs text-gray-400 shrink-0">Suggestions:</span>
                                  {searchAnalysis.suggestions.slice(0, 3).map((suggestion, i) => (
                                    <span key={i} className="text-xs bg-green-900/60 text-green-200 px-2 py-0.5 rounded-full border border-green-700/50 shrink-0">
                                      {suggestion}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 shrink-0">
                          {searchResults.length} matches
                        </span>
                        <button
                          onClick={handleClearSearch}
                          className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 shrink-0"
                          title="Clear search"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1 px-2 pb-2 max-h-48 overflow-y-auto">
                      {searchResults.slice(0, 15).map((result, idx) => (
                        <div
                          key={`${result.filePath}-${result.line}`}
                          className="bg-gray-700/50 rounded p-2 cursor-pointer hover:bg-gray-700 transition-colors"
                          onClick={() => fetchFileContent(selectedRepo!, result.filePath, result.line)}
                        >
                          <div className="flex items-center gap-1 text-xs text-gray-400 mb-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="truncate flex-1">{result.filePath}</span>
                            <span className="text-purple-400 shrink-0">:{result.line}</span>
                          </div>
                          <p className="text-xs text-gray-300 font-mono truncate">
                            {highlightText(result.content, searchQuery)}
                          </p>
                        </div>
                      ))}
                      {searchResults.length > 15 && (
                        <p className="text-xs text-gray-500 text-center py-1">
                          +{searchResults.length - 15} more results. Refine your search.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {/* File Tree (always visible below search) */}
              <div className="flex-1 overflow-y-auto p-2 border-t border-gray-700">
                {selectedRepo ? (
                  files.length > 0 ? (
                    <>
                      {searchActive && searchResults.length > 0 && (
                        <div className="mb-2 px-1">
                          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                            File Browser
                          </p>
                        </div>
                      )}
                      {renderFileTree(files)}
                    </>
                  ) : (
                    <p className="text-gray-500 text-sm text-center mt-8">
                      {Object.keys(repoStatuses).length === 0
                        ? 'No repositories cloned yet'
                        : repoStatuses[selectedRepo]?.progress.status !== 'completed'
                        ? 'Waiting for clone to complete...'
                        : 'No files found'}
                    </p>
                  )
                ) : (
                  <p className="text-gray-500 text-sm text-center mt-8">
                    Select a repository from the left
                  </p>
                )}
              </div>
            </div>

            {/* File Content Viewer */}
            <div className="flex-1 bg-gray-900 overflow-hidden flex flex-col">
              {fileContent ? (
                <>
                  <div className="p-3 border-b border-gray-700 bg-gray-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <p className="text-gray-400 text-sm font-mono truncate">{fileContent.path}</p>
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto p-4">
                    <pre className="text-sm text-gray-300 font-mono">
                      <code>
                        {fileContent.lines.map((line, idx) => (
                          <div
                            key={idx}
                            className={`${
                              fileContent.highlightLine === idx + 1
                                ? 'bg-purple-900/50 -mx-4 px-4 border-l-2 border-purple-500'
                                : ''
                            }`}
                          >
                            <span className="text-gray-600 select-none w-12 inline-block text-right mr-4">
                              {idx + 1}
                            </span>
                            {line || ' '}
                          </div>
                        ))}
                      </code>
                    </pre>
                  </div>
                </>
              ) : searchActive && searchResults.length > 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <svg
                      className="w-16 h-16 text-gray-700 mx-auto mb-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                    <p className="text-gray-500">Select a search result to view the file</p>
                    <p className="text-gray-600 text-sm mt-2">Found {searchResults.length} matches for &quot;{searchQuery}&quot;</p>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <svg
                      className="w-16 h-16 text-gray-700 mx-auto mb-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    <p className="text-gray-500">Select a file to view its contents</p>
                    <p className="text-gray-600 text-sm mt-2">Or use AI Chat to ask questions</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* AI Chat Panel */}
          {chatOpen && (
            <div className="w-96 bg-gray-850 border-l border-gray-700 flex flex-col">
              <div className="p-4 border-b border-gray-700 flex items-center justify-between">
                <div>
                  <h3 className="text-white font-semibold">AI Code Assistant</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`inline-block w-2 h-2 rounded-full ${ollamaAvailable ? 'bg-green-500' : 'bg-yellow-500'}`} />
                    <p className="text-xs text-gray-400">
                      {ollamaAvailable
                        ? (indexStatus?.indexed ? `${indexStatus.chunkCount} chunks indexed` : 'Ready (no index)')
                        : 'Basic search mode (Ollama not running)'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!indexStatus?.indexed && !indexStatus?.indexing && ollamaAvailable && (
                    <button
                      onClick={handleStartIndex}
                      className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white text-xs rounded transition-colors"
                    >
                      Index Repo
                    </button>
                  )}
                  <button
                    onClick={() => setChatOpen(false)}
                    className="text-gray-400 hover:text-white"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {/* CURSOR-LIKE Progress Panel (shown during search) */}
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

                {chatMessages.length === 0 && streamEvents.length === 0 && !isChatLoading ? (
                  <div className="text-center text-gray-500 mt-8 px-4">
                    <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                    <p className="text-sm font-medium text-gray-400">AI Code Assistant</p>
                    <p className="text-xs mt-1 mb-4">
                      {ollamaAvailable
                        ? 'Ask questions about your codebase'
                        : 'Basic search mode - works without Ollama'}
                    </p>
                    <p className="text-xs text-gray-500 mb-4">
                      {ollamaAvailable
                        ? 'Index repo for smarter semantic search'
                        : 'Install Ollama for AI-powered answers'}
                    </p>

                    <div className="text-left bg-gray-800/50 rounded-lg p-3 space-y-2">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Example prompts:</p>
                      <button onClick={() => setChatInput('Find all authentication methods in this codebase')} className="w-full text-left text-xs text-purple-300 hover:text-purple-200 hover:bg-gray-700/50 rounded px-2 py-1.5 transition-colors flex items-center gap-2">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                        Find all authentication methods
                      </button>
                      <button onClick={() => setChatInput('Show me how API endpoints are structured')} className="w-full text-left text-xs text-purple-300 hover:text-purple-200 hover:bg-gray-700/50 rounded px-2 py-1.5 transition-colors flex items-center gap-2">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m-9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
                        Show API endpoint structure
                      </button>
                      <button onClick={() => setChatInput('Where are database connections configured?')} className="w-full text-left text-xs text-purple-300 hover:text-purple-200 hover:bg-gray-700/50 rounded px-2 py-1.5 transition-colors flex items-center gap-2">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>
                        Find database configuration
                      </button>
                      <button onClick={() => setChatInput('Explain the main entry point and how the app starts')} className="w-full text-left text-xs text-purple-300 hover:text-purple-200 hover:bg-gray-700/50 rounded px-2 py-1.5 transition-colors flex items-center gap-2">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        Explain app entry point
                      </button>
                      <button onClick={() => setChatInput('Find all error handling patterns used')} className="w-full text-left text-xs text-purple-300 hover:text-purple-200 hover:bg-gray-700/50 rounded px-2 py-1.5 transition-colors flex items-center gap-2">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                        Find error handling patterns
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Streaming progress events */}
                    {streamEvents.map((event, idx) => (
                      <div key={idx} className="flex justify-start">
                        <div className="max-w-[85%] rounded-lg p-3 bg-gray-800/50 text-gray-300 border border-gray-700">
                          {event.type === 'thinking' && (
                            <div className="flex items-center gap-2">
                              <svg className="animate-spin h-4 w-4 text-purple-400" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                              <p className="text-xs">{event.data.message}</p>
                            </div>
                          )}
                          {event.type === 'searching' && (
                            <div className="flex items-center gap-2">
                              <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                              </svg>
                              <p className="text-xs">{event.data.message} ({event.data.matches} matches)</p>
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
                          {event.type === 'suggestion' && (
                            <div>
                              <p className="text-xs text-yellow-300 mb-1">{event.data.message}</p>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {event.data.suggestions?.map((s, i) => (
                                  <span key={i} className="text-xs bg-gray-700 px-2 py-0.5 rounded text-purple-300">{s}</span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}

                    {/* Chat messages - VS Code-like format */}
                    {chatMessages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-lg p-3 ${
                            msg.role === 'user'
                              ? 'bg-purple-600 text-white'
                              : 'bg-gray-800 border border-gray-700 text-gray-100'
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
                {isChatLoading && streamEvents.length === 0 && (
                  <div className="flex justify-start">
                    <div className="bg-gray-700 rounded-lg p-3">
                      <div className="flex gap-1">
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

              <div className="p-4 border-t border-gray-700">
                <form
                  onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask about the code..."
                    className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-purple-500"
                    disabled={isChatLoading}
                  />
                  <button
                    type="submit"
                    disabled={isChatLoading || !chatInput.trim()}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors"
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
    </div>
  );
}
