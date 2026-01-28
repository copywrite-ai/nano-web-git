// Signal ready immediately upon script load
self.postMessage({ type: 'ready' });

// Bridge console logs to main thread for deeper debugging
const originalLog = console.log;
console.log = (...args) => {
    self.postMessage({ type: 'progress', payload: `[Worker] ${args.join(' ')}` });
    originalLog.apply(console, args);
};

import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import FS from '@isomorphic-git/lightning-fs';

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
            await pfs.rmdir(path);
        } else {
            await pfs.unlink(path);
        }
    } catch (e) { }
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
                console.log(`Cloning ${payload.url} [${payload.ref}]`);
                await clearDirContents(dir);
                await git.clone({
                    fs, http, dir, url: payload.url, ref: payload.ref,
                    singleBranch: true, depth: 1,
                    onMessage: (msg: string) => self.postMessage({ id, type: 'progress', payload: msg })
                });
                console.log(`Clone finished`);
                self.postMessage({ id, type: 'success' });
                break;

            case 'pull':
                console.log(`Pulling ${payload.url} [${payload.ref}]`);
                await git.pull({
                    fs, http, dir, url: payload.url, ref: payload.ref,
                    singleBranch: true,
                    onMessage: (msg: string) => self.postMessage({ id, type: 'progress', payload: msg })
                });
                console.log(`Pull finished`);
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
