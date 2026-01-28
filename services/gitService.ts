import { FileNode } from '../types';

export class GitService {
  private worker: Worker;
  private pendingRequests: Map<string, {
    resolve: (val: any) => void,
    reject: (err: any) => void,
    onProgress?: (msg: string) => void
  }> = new Map();
  private localConnected = false;

  private isReady = false;
  private readyPromise: Promise<void>;

  constructor() {
    // @ts-ignore - Vite handled worker import
    this.worker = new Worker(new URL('./gitWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = this.handleWorkerMessage.bind(this);
    this.worker.onerror = (e) => {
      console.error('GitWorker Error:', e);
      this.pendingRequests.forEach(req => req.reject(new Error('Worker crashed')));
      this.pendingRequests.clear();
    };

    this.readyPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.isReady) {
          const msg = 'GitWorker failed to signal ready within 10s. Probable load error.';
          console.error(msg);
          reject(new Error(msg));
        }
      }, 10000);

      const checkReady = (e: MessageEvent) => {
        if (e.data.type === 'ready') {
          console.log('GitWorker Handshake Successful');
          this.isReady = true;
          clearTimeout(timeout);
          this.worker.removeEventListener('message', checkReady);
          resolve();
        }
      };
      this.worker.addEventListener('message', checkReady);
    });

    this.initRepo();
  }

  private handleWorkerMessage(e: MessageEvent) {
    const { id, type, payload } = e.data;
    const request = this.pendingRequests.get(id);
    if (!request) return;

    if (type === 'progress') {
      request.onProgress?.(payload);
    } else if (type === 'success') {
      request.resolve(payload);
      this.pendingRequests.delete(id);
    } else if (type === 'error') {
      request.reject(new Error(payload));
      this.pendingRequests.delete(id);
    }
  }

  private async sendWorkerRequest(type: string, payload?: any, transfers?: Transferable[], onProgress?: (msg: string) => void): Promise<any> {
    await this.readyPromise;
    const id = Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Worker request ${type} timed out`));
        }
      }, 60000);

      this.pendingRequests.set(id, {
        resolve: (val) => { clearTimeout(timeout); resolve(val); },
        reject: (err) => { clearTimeout(timeout); reject(err); },
        onProgress
      });
      this.worker.postMessage({ id, type, payload }, transfers || []);
    });
  }

  static parseGitHubUrl(input: string): { url: string; branch: string | null } {
    const trimmed = input.trim();
    const treeMatch = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)/);
    if (treeMatch) {
      return {
        url: `https://github.com/${treeMatch[1]}/${treeMatch[2]}.git`,
        branch: treeMatch[3]
      };
    }
    if (trimmed.startsWith('https://github.com/') && !trimmed.endsWith('.git') && trimmed.split('/').length === 5) {
      return { url: `${trimmed}.git`, branch: null };
    }
    return { url: trimmed, branch: null };
  }

  async initRepo() {
    return this.sendWorkerRequest('init');
  }

  useLocalFS(handle: FileSystemDirectoryHandle) {
    this.localConnected = true;
    return this.sendWorkerRequest('setLocalRoot', { handle }, [handle as any]);
  }

  get isLocalConnected() {
    return this.localConnected;
  }

  async clone(url: string, ref: string = 'main', onProgress?: (msg: string) => void) {
    return this.sendWorkerRequest('clone', { url, ref }, [], onProgress);
  }

  async pull(url: string, ref: string = 'main', onProgress?: (msg: string) => void) {
    return this.sendWorkerRequest('pull', { url, ref }, [], onProgress);
  }

  async getFileTree(): Promise<FileNode[]> {
    return this.sendWorkerRequest('getFileTree');
  }

  async readFile(path: string): Promise<string> {
    return this.sendWorkerRequest('readFile', { path });
  }

  async syncToLocal(path: string) {
    return this.sendWorkerRequest('syncToLocal', { path });
  }

  async resetApp() {
    return this.sendWorkerRequest('wipe');
  }

  useVirtualFS() { }
}

export const gitService = new GitService();
