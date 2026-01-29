// Signal ready will happen after setup

// Bridge console logs to main thread for deeper debugging
const originalLog = console.log;
console.log = (...args) => {
    self.postMessage({ type: 'progress', payload: `[Worker] ${args.join(' ')}` });
    originalLog.apply(console, args);
};

import git from 'isomorphic-git';
import FS from '@isomorphic-git/lightning-fs';

const CORS_PROXY = 'https://still-glade-5ccb.mymobilebookmark.workers.dev/';

interface GitHttpResponse {
    url: string;
    method?: string;
    statusCode: number;
    statusMessage: string;
    body?: Uint8Array[];
    headers?: any;
}

interface HttpClient {
    request(args: {
        url: string;
        method?: string;
        headers?: any;
        body?: any;
    }): Promise<GitHttpResponse>;
}

async function collectBody(body: any): Promise<Uint8Array | null> {
    if (!body) return null;
    if (body instanceof Uint8Array) return body;
    if (body[Symbol.asyncIterator] || body[Symbol.iterator]) {
        const chunks = [];
        for await (const chunk of body) {
            chunks.push(new Uint8Array(chunk));
        }
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return result;
    }
    return new Uint8Array(body);
}

/**
 * Smart Git HTTP module for Worker
 * Differentiates between simple and complex requests for CORS Unblock extension
 */
const http: HttpClient = {
    async request({ url, method, headers, body }: any): Promise<GitHttpResponse> {
        const u = new URL(url);
        const isCrossOrigin = u.origin !== self.location.origin;
        const isUsingKnownProxy = url.startsWith(CORS_PROXY);

        // Collect body if present
        const collectedBody = await collectBody(body);

        // 1. Strategy: Proxy all cross-origin requests via main thread/extension if not using official proxy
        if (isCrossOrigin && !isUsingKnownProxy) {
            console.log(`[Worker] Proxying request: ${method} ${url} (${collectedBody?.length || 0} bytes body)`);
            return new Promise((resolve, reject) => {
                const requestId = Math.random().toString(36).slice(2);
                const handleMessage = (e: MessageEvent) => {
                    if (e.data.id === requestId && e.data.type === 'EXTENSION_FETCH_RESULT') {
                        self.removeEventListener('message', handleMessage);
                        if (e.data.error) {
                            console.error(`[Worker] Proxy error for ${url}:`, e.data.error);
                            reject(new Error(e.data.error));
                        } else {
                            const res = e.data.payload;
                            // Ensure body is an array of Uint8Array as expected by isomorphic-git
                            let chunks: Uint8Array[] = [];
                            if (res.body && Array.isArray(res.body)) {
                                chunks = res.body.map(c => new Uint8Array(c));
                            } else if (res.body) {
                                chunks = [new Uint8Array(res.body)];
                            }

                            const bodyLength = chunks.reduce((acc, c) => acc + c.length, 0);
                            const protoHdr = res.headers?.['content-type'] || 'unknown';
                            console.log(`[Worker] Proxy response for ${url}: status=${res.statusCode}, type=${protoHdr}, body=${bodyLength} bytes`);

                            // Log all headers for deep debugging if it's a git-upload-pack or info/refs
                            if (url.includes('git-upload-pack') || url.includes('info/refs')) {
                                console.log(`[Worker] Headers for ${url}:`, JSON.stringify(res.headers));
                            }

                            resolve({
                                url: res.url || url,
                                method,
                                headers: res.headers,
                                body: chunks,
                                statusCode: res.statusCode,
                                statusMessage: res.statusMessage
                            });
                        }
                    }
                };
                self.addEventListener('message', handleMessage);

                (self as any).postMessage({
                    type: 'EXTENSION_FETCH_PROXY',
                    id: requestId,
                    payload: {
                        url,
                        method,
                        headers,
                        body: collectedBody
                    }
                }, collectedBody ? [collectedBody.buffer] : []);
            });
        }

        // 2. Otherwise use native fetch (for same-origin or official proxy)
        console.log(`[Worker] Using direct fetch: ${method} ${url}`);
        const res = await fetch(url, { method, headers, body: collectedBody as any });
        console.log(`[Worker] Direct fetch response for ${url}: ${res.status} ${res.statusText}`);

        const resBuffer = await res.arrayBuffer();
        console.log(`[Worker] Direct fetch received ${resBuffer.byteLength} bytes for ${url}`);

        return {
            url: res.url,
            method,
            headers: Object.fromEntries(res.headers.entries()),
            body: [new Uint8Array(resBuffer)],
            statusCode: res.status,
            statusMessage: res.statusText
        };
    }
};


const fs = new FS('git-browser-fs');
const pfs = fs.promises;
const dir = '/repo';

// Helper for recursive delete (needed for clean clones)
async function recursiveDelete(path: string) {
    try {
        const stat = await pfs.stat(path);
        if (stat.isDirectory()) {
            const files = await pfs.readdir(path);
            for (const file of files) {
                await recursiveDelete(`${path}/${file}`);
            }
            try {
                await pfs.rmdir(path);
            } catch (e: any) {
                console.warn(`[Worker] Failed to rmdir ${path}: ${e.message}`);
            }
        } else {
            try {
                await pfs.unlink(path);
            } catch (e: any) {
                console.warn(`[Worker] Failed to unlink ${path}: ${e.message}`);
            }
        }
    } catch (e) {
        // Path doesn't exist, ignore
    }
}

// Helper to clear contents WITHOUT deleting the directory itself
async function clearDirContents(path: string) {
    try {
        const files = await pfs.readdir(path);
        for (const file of files) {
            await recursiveDelete(`${path}/${file}`);
        }
    } catch (e) {
        // If directory doesn't exist, create it
        try { await pfs.mkdir(path); } catch (err) { }
    }
}

// Local Sync Logic in Worker
let localRoot: FileSystemDirectoryHandle | null = null;

async function getLocalHandle(path: string, options: { create?: boolean; type?: 'file' | 'dir' } = {}) {
    if (!localRoot) throw new Error("Local root not set in worker");
    const parts = path.split('/').filter(p => p && p !== '.');
    let current: FileSystemDirectoryHandle = localRoot;

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;
        if (isLast) {
            if (options.type === 'file') return await current.getFileHandle(part, { create: options.create });
            if (options.type === 'dir') return await current.getDirectoryHandle(part, { create: options.create });
            try { return await current.getFileHandle(part); } catch { return await current.getDirectoryHandle(part); }
        } else {
            current = await current.getDirectoryHandle(part, { create: options.create });
        }
    }
    return current;
}

async function countFiles(vPath: string): Promise<number> {
    const stat = await pfs.stat(vPath);
    if (!stat.isDirectory()) return 1;
    const files = await pfs.readdir(vPath);
    let count = 0;
    for (const file of files) {
        count += await countFiles(`${vPath}/${file}`);
    }
    return count;
}

// Signal ready
self.postMessage({ type: 'ready' });

self.onmessage = async (e) => {
    const { id, type, payload } = e.data;

    try {
        console.log(`Action: ${type} started`);
        switch (type) {
            case 'init':
                try { await pfs.mkdir(dir); } catch (e) { }
                self.postMessage({ id, type: 'success' });
                break;

            case 'clone':
                console.log(`[Worker] Cloning ${payload.url} [${payload.ref}] (Proxy: ${payload.useProxy})`);
                await clearDirContents(dir);
                // 1. First clone without checkout to avoid conflict with potential leftover ghosts
                await git.clone({
                    fs, http: http as any, dir, url: payload.url, ref: payload.ref,
                    singleBranch: true,
                    depth: 1,
                    noCheckout: true,
                    corsProxy: payload.useProxy ? CORS_PROXY : undefined,
                    onMessage: (msg: string) => self.postMessage({ id, type: 'progress', payload: msg })
                });

                // 2. Perform a forced checkout to ensure the working directory matches the commit exactly
                console.log(`[Worker] Performing forced checkout...`);
                await git.checkout({
                    fs, dir, ref: payload.ref,
                    force: true
                });

                console.log(`[Worker] Clone finished`);
                self.postMessage({ id, type: 'success' });
                break;

            case 'pull':
                console.log(`[Worker] Pulling ${payload.url} [${payload.ref}] (Proxy: ${payload.useProxy})`);
                await git.pull({
                    fs, http: http as any, dir, url: payload.url, ref: payload.ref,
                    singleBranch: true,
                    corsProxy: payload.useProxy ? CORS_PROXY : undefined,
                    onMessage: (msg: string) => self.postMessage({ id, type: 'progress', payload: msg })
                });
                console.log(`[Worker] Pull finished`);
                self.postMessage({ id, type: 'success' });
                break;

            case 'getFileTree':
                console.log(`Fetching file tree`);
                const buildTree = async (currentPath: string): Promise<any[]> => {
                    const files = await pfs.readdir(currentPath);
                    const nodes = [];
                    for (const file of files) {
                        if (file === '.git') continue;
                        const fullPath = `${currentPath}/${file}`;
                        const stat = await pfs.stat(fullPath);
                        const node: any = { name: file, path: fullPath, type: stat.isDirectory() ? 'dir' : 'file' };
                        if (node.type === 'dir') node.children = await buildTree(fullPath);
                        nodes.push(node);
                    }
                    return nodes;
                };
                const tree = await buildTree(dir);
                console.log(`Tree built with ${tree.length} top-level items`);
                self.postMessage({ id, type: 'success', payload: tree });
                break;

            case 'readFile':
                console.log(`Reading file: ${payload.path}`);
                const content = await pfs.readFile(payload.path, 'utf8');
                self.postMessage({ id, type: 'success', payload: content });
                break;

            case 'setLocalRoot':
                console.log(`Setting local root handle`);
                localRoot = payload.handle;
                self.postMessage({ id, type: 'success' });
                break;

            case 'syncToLocal':
                console.log(`Syncing ${payload.path} to local`);
                const totalFiles = await countFiles(payload.path);
                let currentFiles = 0;

                const sync = async (vPath: string) => {
                    const relPath = vPath.startsWith(dir) ? vPath.slice(dir.length).replace(/^\/+/, '') : vPath.replace(/^\/+/, '');
                    const stat = await pfs.stat(vPath);
                    if (stat.isDirectory()) {
                        await getLocalHandle(relPath, { create: true, type: 'dir' });
                        const files = await pfs.readdir(vPath);
                        for (const file of files) await sync(`${vPath}/${file}`);
                    } else {
                        const data = await pfs.readFile(vPath);
                        const handle = await getLocalHandle(relPath, { create: true, type: 'file' }) as FileSystemFileHandle;
                        const writable = await handle.createWritable();
                        await writable.write(data as any);
                        await writable.close();
                        currentFiles++;
                        self.postMessage({
                            id,
                            type: 'progress',
                            payload: { type: 'sync', current: currentFiles, total: totalFiles, path: relPath }
                        });
                    }
                };
                await sync(payload.path);
                console.log(`Sync finished`);
                self.postMessage({ id, type: 'success' });
                break;

            case 'wipe':
                console.log('Wiping IndexedDB...');
                // @ts-ignore
                await new FS('git-browser-fs').wipe();
                console.log('IndexedDB wiped successfully');
                self.postMessage({ id, type: 'success' });
                break;
        }
    } catch (err: any) {
        console.log(`Error in worker action ${type}: ${err.message}`);
        self.postMessage({ id, type: 'error', payload: err.message });
    }
};
