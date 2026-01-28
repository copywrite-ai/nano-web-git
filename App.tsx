
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Github, 
  FolderOpen, 
  FileText, 
  Terminal, 
  Download, 
  RefreshCw, 
  ChevronRight, 
  ChevronDown,
  Sparkles,
  Loader2,
  Code2,
  GitPullRequest,
  AlertCircle,
  Package,
  X,
  Copy,
  Check
} from 'lucide-react';
import { gitService } from './services/gitService';
import { explainCode, summarizeRepo } from './services/geminiService';
import { FileNode, LogEntry, RepoState } from './types';

const BuildGuideModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);
  if (!isOpen) return null;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const codeSnippet = `npm install
npm run build`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-zinc-900 border border-zinc-800 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center space-x-2">
            <Package className="w-5 h-5 text-blue-500" />
            <h2 className="text-lg font-bold">本地打包指引 (Local Build Guide)</h2>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          <section>
            <h3 className="text-blue-400 text-sm font-bold uppercase tracking-wider mb-3">1. 准备工作 (Prerequisites)</h3>
            <p className="text-sm text-zinc-400 mb-2">确保你已安装 Node.js 和 npm。该项目使用 Vite 作为构建工具。</p>
          </section>

          <section>
            <h3 className="text-blue-400 text-sm font-bold uppercase tracking-wider mb-3">2. 安装依赖 (Installation)</h3>
            <div className="relative group">
              <pre className="bg-black p-4 rounded-lg font-mono text-sm text-zinc-300 border border-zinc-800">
                <code>npm install</code>
              </pre>
              <button 
                onClick={() => copyToClipboard('npm install')}
                className="absolute top-2 right-2 p-2 bg-zinc-800 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </section>

          <section>
            <h3 className="text-blue-400 text-sm font-bold uppercase tracking-wider mb-3">3. 配置环境变量 (Environment)</h3>
            <p className="text-sm text-zinc-400 mb-2">在根目录创建 <code className="text-blue-300">.env</code> 文件并添加 API Key：</p>
            <pre className="bg-black p-4 rounded-lg font-mono text-sm text-zinc-300 border border-zinc-800">
              <code>VITE_API_KEY=your_gemini_key</code>
            </pre>
          </section>

          <section>
            <h3 className="text-blue-400 text-sm font-bold uppercase tracking-wider mb-3">4. 执行打包 (Build)</h3>
            <div className="relative group">
              <pre className="bg-black p-4 rounded-lg font-mono text-sm text-zinc-300 border border-zinc-800">
                <code>npm run build</code>
              </pre>
              <p className="mt-2 text-xs text-zinc-500 italic">打包后的文件将存放在 <code className="text-zinc-300">/dist</code> 目录中。</p>
            </div>
          </section>
        </div>

        <div className="p-4 bg-zinc-950 border-t border-zinc-800 flex justify-end">
          <button 
            onClick={onClose}
            className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg text-sm font-bold transition-all"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};

const TreeNode: React.FC<{ 
  node: FileNode; 
  depth?: number; 
  onFileClick: (path: string) => void;
}> = ({ node, depth = 0, onFileClick }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (node.type === 'file') {
    return (
      <button 
        onClick={() => onFileClick(node.path)}
        className="flex items-center w-full px-2 py-1 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 rounded transition-colors"
        style={{ paddingLeft: `${depth * 1.2 + 0.5}rem` }}
      >
        <FileText className="w-3.5 h-3.5 mr-2 shrink-0 opacity-60" />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }

  return (
    <div>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center w-full px-2 py-1 text-sm text-zinc-300 hover:text-white hover:bg-zinc-800 rounded transition-colors group"
        style={{ paddingLeft: `${depth * 1.2 + 0.5}rem` }}
      >
        {isOpen ? (
          <ChevronDown className="w-3.5 h-3.5 mr-2 shrink-0 text-zinc-500" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 mr-2 shrink-0 text-zinc-500" />
        )}
        <FolderOpen className="w-3.5 h-3.5 mr-2 shrink-0 text-blue-400 opacity-70 group-hover:opacity-100" />
        <span className="truncate font-medium">{node.name}</span>
      </button>
      {isOpen && node.children && (
        <div className="mt-0.5">
          {node.children.map(child => (
            <TreeNode key={child.path} node={child} depth={depth + 1} onFileClick={onFileClick} />
          ))}
        </div>
      )}
    </div>
  );
};

const App: React.FC = () => {
  const [repoState, setRepoState] = useState<RepoState>({
    url: 'https://github.com/isomorphic-git/isomorphic-git',
    branch: 'main',
    isCloning: false,
    error: null,
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<{ path: string; content: string } | null>(null);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [activeTab, setActiveTab] = useState<'code' | 'logs'>('code');
  const [isBuildGuideOpen, setIsBuildGuideOpen] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((message: string, level: LogEntry['level'] = 'info') => {
    setLogs(prev => [...prev, { timestamp: new Date(), message, level }]);
  }, []);

  useEffect(() => {
    if (activeTab === 'logs') {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeTab]);

  const refreshTree = async () => {
    const tree = await gitService.getFileTree();
    setFileTree(tree);
  };

  const handleAction = async (action: 'clone' | 'pull') => {
    if (!repoState.url) return;
    setRepoState(prev => ({ ...prev, isCloning: true, error: null }));
    setActiveTab('logs');
    addLog(`${action === 'clone' ? 'Cloning' : 'Pulling'} ${repoState.url}...`, 'info');
    
    try {
      await gitService.initRepo();
      if (action === 'clone') {
        await gitService.clone(repoState.url, repoState.branch, (msg) => addLog(msg, 'info'));
      } else {
        await gitService.pull(repoState.url, repoState.branch, (msg) => addLog(msg, 'info'));
      }
      
      addLog(`Success: Repository ${action === 'clone' ? 'cloned' : 'updated'}!`, 'success');
      await refreshTree();
      
      if (action === 'clone' || fileTree.length === 0) {
        const tree = await gitService.getFileTree();
        const fileNames = tree.slice(0, 10).map(n => n.name);
        if (fileNames.length > 0) {
          const summary = await summarizeRepo(fileNames);
          addLog(`AI Project Insight: ${summary}`, 'success');
        }
      }
    } catch (err: any) {
      const errorMsg = err.message || 'Unknown error occurred';
      setRepoState(prev => ({ ...prev, error: errorMsg }));
      addLog(`Error: ${errorMsg}`, 'error');
    } finally {
      setRepoState(prev => ({ ...prev, isCloning: false }));
    }
  };

  const handleFileClick = async (path: string) => {
    try {
      const content = await gitService.readFile(path);
      setSelectedFile({ path, content });
      setAiExplanation(null);
      setActiveTab('code');
    } catch (err) {
      addLog(`Failed to read file: ${path}`, 'error');
    }
  };

  const handleExplain = async () => {
    if (!selectedFile) return;
    setIsExplaining(true);
    try {
      const explanation = await explainCode(selectedFile.content, selectedFile.path);
      setAiExplanation(explanation);
    } catch (err) {
      addLog('AI explanation failed', 'error');
    } finally {
      setIsExplaining(false);
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-zinc-950">
      {/* Build Guide Modal */}
      <BuildGuideModal isOpen={isBuildGuideOpen} onClose={() => setIsBuildGuideOpen(false)} />

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-zinc-900 border-b border-zinc-800 shrink-0 z-10 shadow-2xl">
        <div className="flex items-center space-x-3">
          <div className="bg-blue-600/20 p-2 rounded-xl">
            <Github className="w-6 h-6 text-blue-500" />
          </div>
          <div>
            <h1 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent leading-none">
              GitBrowser AI
            </h1>
            <p className="text-[10px] text-zinc-500 mt-1 uppercase tracking-widest font-semibold">Web-Based Git Client</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-3 flex-1 max-w-4xl px-8">
          <div className="relative flex-1 group">
            <input 
              type="text" 
              value={repoState.url}
              onChange={(e) => setRepoState(p => ({...p, url: e.target.value}))}
              placeholder="https://github.com/user/repo"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-4 pr-4 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder:text-zinc-600"
            />
          </div>
          <input 
            type="text" 
            value={repoState.branch}
            onChange={(e) => setRepoState(p => ({...p, branch: e.target.value}))}
            placeholder="main"
            className="w-24 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-center"
          />
          <div className="flex space-x-2 shrink-0">
            <button 
              onClick={() => handleAction('clone')}
              disabled={repoState.isCloning}
              className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95 shadow-lg shadow-blue-500/10"
            >
              {repoState.isCloning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              <span>Clone</span>
            </button>
            <button 
              onClick={() => handleAction('pull')}
              disabled={repoState.isCloning}
              className="flex items-center space-x-2 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-200 px-4 py-2 rounded-lg text-sm font-semibold border border-zinc-700 transition-all active:scale-95"
            >
              <GitPullRequest className="w-4 h-4" />
              <span>Pull</span>
            </button>
            <div className="w-px h-8 bg-zinc-800 mx-1" />
            <button 
              onClick={() => setIsBuildGuideOpen(true)}
              className="flex items-center space-x-2 text-zinc-400 hover:text-white hover:bg-zinc-800 p-2 rounded-lg transition-all border border-transparent hover:border-zinc-700"
              title="Local Build Guide"
            >
              <Package className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <main className="flex-1 flex overflow-hidden">
        {/* Sidebar - File Explorer */}
        <aside className="w-64 bg-zinc-950 border-r border-zinc-800 flex flex-col shrink-0">
          <div className="p-4 border-b border-zinc-900 flex items-center justify-between">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Workspace</span>
            <FolderOpen className="w-4 h-4 text-zinc-600" />
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
            {fileTree.length === 0 && !repoState.isCloning && (
              <div className="text-center mt-12 px-6">
                <div className="w-12 h-12 bg-zinc-900 rounded-full flex items-center justify-center mx-auto mb-4 border border-zinc-800">
                  <FolderOpen className="w-6 h-6 text-zinc-700" />
                </div>
                <h3 className="text-zinc-400 text-sm font-medium mb-1">Empty Repository</h3>
                <p className="text-xs text-zinc-600">Clone a repository to start browsing the source code.</p>
              </div>
            )}
            {fileTree.map(node => (
              <TreeNode key={node.path} node={node} onFileClick={handleFileClick} />
            ))}
          </div>
        </aside>

        {/* Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-zinc-900 relative">
          {/* Tabs */}
          <div className="flex items-center px-4 bg-zinc-900 border-b border-zinc-800 h-10 shrink-0">
            <button 
              onClick={() => setActiveTab('code')}
              className={`flex items-center space-x-2 px-4 h-full text-xs font-medium border-b-2 transition-colors ${activeTab === 'code' ? 'border-blue-500 text-white bg-zinc-800/50' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Source Viewer</span>
            </button>
            <button 
              onClick={() => setActiveTab('logs')}
              className={`flex items-center space-x-2 px-4 h-full text-xs font-medium border-b-2 transition-colors ${activeTab === 'logs' ? 'border-blue-500 text-white bg-zinc-800/50' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Console Logs</span>
            </button>
          </div>

          <div className="flex-1 flex overflow-hidden">
            {activeTab === 'code' ? (
              selectedFile ? (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 bg-zinc-800/30 border-b border-zinc-800">
                    <div className="flex items-center space-x-2 overflow-hidden">
                      <FileText className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                      <span className="text-xs text-zinc-400 font-mono truncate">{selectedFile.path.replace('/repo/', '')}</span>
                    </div>
                    <button 
                      onClick={handleExplain}
                      disabled={isExplaining}
                      className="flex items-center space-x-2 text-[10px] uppercase tracking-wider font-bold bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 text-white px-3 py-1.5 rounded-md transition-all shadow-lg active:scale-95"
                    >
                      {isExplaining ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      <span>Ask AI to Explain</span>
                    </button>
                  </div>
                  
                  <div className="flex-1 flex overflow-hidden">
                    <pre className="flex-1 p-6 overflow-auto text-sm font-mono text-zinc-300 selection:bg-blue-500/40 custom-scrollbar leading-relaxed">
                      <code>{selectedFile.content}</code>
                    </pre>
                    
                    {/* AI Panel */}
                    {aiExplanation && (
                      <div className="w-[400px] border-l border-zinc-800 bg-zinc-950 flex flex-col animate-in slide-in-from-right duration-500 shadow-2xl">
                        <div className="p-4 border-b border-zinc-900 bg-zinc-900/50 flex items-center justify-between">
                          <div className="flex items-center space-x-2 text-indigo-400">
                            <Sparkles className="w-4 h-4" />
                            <h3 className="text-xs font-bold uppercase tracking-widest">AI Explanation</h3>
                          </div>
                          <button 
                            onClick={() => setAiExplanation(null)}
                            className="text-zinc-600 hover:text-zinc-400"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                          <div className="prose prose-invert prose-sm max-w-none">
                            <p className="text-zinc-300 leading-relaxed whitespace-pre-wrap text-sm antialiased">
                              {aiExplanation}
                            </p>
                          </div>
                        </div>
                        <div className="p-4 bg-zinc-900/30 border-t border-zinc-900 text-[10px] text-zinc-600 text-center font-mono">
                          Generated by Gemini Flash 3.0
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-zinc-700 flex-col p-12 text-center">
                  <div className="w-20 h-20 bg-zinc-800 rounded-3xl flex items-center justify-center mb-6 border border-zinc-700 rotate-12 transition-transform hover:rotate-0">
                    <Code2 className="w-10 h-10 text-zinc-600" />
                  </div>
                  <h2 className="text-lg font-semibold text-zinc-400 mb-2">No File Selected</h2>
                  <p className="max-w-xs text-sm text-zinc-600">Select any file from the sidebar to inspect its contents and use AI for deep analysis.</p>
                </div>
              )
            ) : (
              <div className="flex-1 bg-black p-4 font-mono text-xs overflow-y-auto custom-scrollbar flex flex-col-reverse">
                <div ref={logEndRef} />
                <div className="flex flex-col space-y-1.5">
                  {logs.map((log, i) => (
                    <div key={i} className="flex space-x-3 group border-l border-transparent hover:border-zinc-800 pl-2 transition-colors">
                      <span className="text-zinc-600 shrink-0">
                        [{log.timestamp.toLocaleTimeString([], { hour12: false })}]
                      </span>
                      <span className={`
                        ${log.level === 'error' ? 'text-red-400' : ''}
                        ${log.level === 'success' ? 'text-emerald-400 font-medium' : ''}
                        ${log.level === 'warn' ? 'text-amber-400' : ''}
                        ${log.level === 'info' ? 'text-zinc-400' : ''}
                      `}>
                        {log.message}
                      </span>
                    </div>
                  ))}
                  {logs.length === 0 && (
                    <div className="text-zinc-700 italic">No activity logs yet...</div>
                  )}
                </div>
              </div>
            )}
          </div>
          
          {/* Status Bar */}
          <footer className="h-6 bg-blue-600 border-t border-blue-500 shrink-0 flex items-center px-4 justify-between text-[10px] text-blue-100 font-medium">
            <div className="flex items-center space-x-4">
              <span className="flex items-center space-x-1.5">
                <RefreshCw className={`w-3 h-3 ${repoState.isCloning ? 'animate-spin' : ''}`} />
                <span>{repoState.isCloning ? 'Synchronizing Repository...' : 'Local FS Ready'}</span>
              </span>
              {repoState.error && (
                <span className="flex items-center space-x-1.5 text-red-100 bg-red-500/40 px-2 h-full">
                  <AlertCircle className="w-3 h-3" />
                  <span>{repoState.error}</span>
                </span>
              )}
            </div>
            <div className="flex items-center space-x-4">
              <span>{repoState.branch} @ browser-fs</span>
              <span className="opacity-60">v1.0.0</span>
            </div>
          </footer>
        </div>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #27272a;
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #3f3f46;
        }
        @keyframes slide-in-right {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-in {
          animation: slide-in-right 0.3s ease-out;
        }
      `}</style>
    </div>
  );
};

export default App;
