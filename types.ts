
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileNode[];
}

export interface LogEntry {
  timestamp: Date;
  message: string;
  level: 'info' | 'error' | 'success' | 'warn';
}

export interface RepoState {
  url: string;
  branch: string;
  isCloning: boolean;
  error: string | null;
}
