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

    // Handle fetch proxy requests from worker
    if (type === 'EXTENSION_FETCH_PROXY') {
      this.handleExtensionFetchProxy(id, payload);
      return;
    }

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

  private async handleExtensionFetchProxy(requestId: string, payload: any) {
    try {
      const result = await this.proxyRequestViaExtension(payload);
      // Transfer the buffer if possible
      const transfers = result.body?.[0] instanceof Uint8Array ? [result.body[0].buffer] : [];
      this.worker.postMessage({ id: requestId, type: 'EXTENSION_FETCH_RESULT', payload: result }, transfers as any);
    } catch (err: any) {
      this.worker.postMessage({ id: requestId, type: 'EXTENSION_FETCH_RESULT', error: err.message });
    }
  }

  private async proxyRequestViaExtension({ url, method, headers, body }: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      const handler = (event: MessageEvent) => {
        if (event.data?.source === 'cors-unblock-content' && event.data?.id === id) {
          window.removeEventListener('message', handler);
          if (event.data.error) return reject(new Error(event.data.error));

          const response = event.data.result;
          let data = response.data;

          if (!(data instanceof Uint8Array)) {
            if (Array.isArray(data)) {
              data = new Uint8Array(data);
            } else if (data && typeof data === 'object' && typeof data.length === 'number') {
              // Handle serialized object {0:..., 1:..., length:...}
              const arr = new Uint8Array(data.length);
              for (let i = 0; i < data.length; i++) {
                arr[i] = (data as any)[i];
              }
              data = arr;
            } else if (data && typeof data === 'object') {
              // Fallback for objects without length
              const values = Object.values(data);
              data = new Uint8Array(values as number[]);
            } else {
              data = new Uint8Array(0);
            }
          }

          resolve({
            url: response.url || url,
            method,
            headers: response.headers,
            body: [data],
            statusCode: response.status,
            statusMessage: response.statusText
          });
        }
      };

      window.addEventListener('message', handler);
      console.log(`[GitService] Proxying ${method} ${url} (${body?.length || 0} bytes body)`);
      window.postMessage({
        source: 'cors-unblock-inject',
        id,
        type: 'GIT_FETCH',
        data: { url, method, headers, body }
      }, '*');

      setTimeout(() => {
        window.removeEventListener('message', handler);
        reject(new Error('Extension response timeout'));
      }, 60000);
    });
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
      }, 300000); // Increased to 5 minutes for large clones/syncs

      this.pendingRequests.set(id, {
        resolve: (val) => { clearTimeout(timeout); resolve(val); },
        reject: (err) => { clearTimeout(timeout); reject(err); },
        onProgress
      });
      this.worker.postMessage({ id, type, payload }, transfers || []);
    });
  }

  static parseGitUrl(input: string): { url: string; branch: string | null } {
    const trimmed = input.trim();

    // GitHub: https://github.com/user/repo/tree/branch
    const ghTreeMatch = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)/);
    if (ghTreeMatch) {
      return {
        url: `https://github.com/${ghTreeMatch[1]}/${ghTreeMatch[2]}.git`,
        branch: ghTreeMatch[3]
      };
    }

    // Gitee: https://gitee.com/user/repo/tree/branch
    const giteeTreeMatch = trimmed.match(/^https:\/\/gitee\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)/);
    if (giteeTreeMatch) {
      return {
        url: `https://gitee.com/${giteeTreeMatch[1]}/${giteeTreeMatch[2]}.git`,
        branch: giteeTreeMatch[3]
      };
    }

    // Normal GitHub/Gitee repo URL (auto-append .git if missing)
    if (
      (trimmed.startsWith('https://github.com/') || trimmed.startsWith('https://gitee.com/')) &&
      !trimmed.endsWith('.git') &&
      trimmed.split('/').length === 5
    ) {
      return { url: `${trimmed}.git`, branch: null };
    }

    return { url: trimmed, branch: null };
  }

  async initRepo() {
    return this.sendWorkerRequest('init');
  }

  useLocalFS(handle: FileSystemDirectoryHandle) {
    this.localConnected = true;
    return this.sendWorkerRequest('setLocalRoot', { handle }, []);
  }

  get isLocalConnected() {
    return this.localConnected;
  }

  async clone(url: string, ref: string = 'main', useProxy: boolean = false, onProgress?: (msg: string) => void) {
    return this.sendWorkerRequest('clone', { url, ref, useProxy }, [], onProgress);
  }

  async pull(url: string, ref: string = 'main', useProxy: boolean = false, onProgress?: (msg: string) => void) {
    return this.sendWorkerRequest('pull', { url, ref, useProxy }, [], onProgress);
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

  async syncAll() {
    return this.syncToLocal('/repo');
  }

  async resetApp() {
    return this.sendWorkerRequest('wipe');
  }

  useVirtualFS() { }
}

export const gitService = new GitService();
