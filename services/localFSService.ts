
/**
 * LocalFSService.ts
 * Implements a Node.js-compatible fs interface using the browser's File System Access API.
 */

export class LocalFSService {
    private root: FileSystemDirectoryHandle | null = null;

    async setRoot(handle: FileSystemDirectoryHandle) {
        this.root = handle;
    }

    get isReady() {
        return this.root !== null;
    }

    private async getHandle(path: string, options: { create?: boolean; type?: 'file' | 'dir' } = {}): Promise<FileSystemFileHandle | FileSystemDirectoryHandle> {
        if (!this.root) throw new Error("Local FS root not set");

        const parts = path.split('/').filter(p => p && p !== '.');
        let current: FileSystemDirectoryHandle = this.root;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isLast = i === parts.length - 1;

            if (isLast) {
                if (options.type === 'file') {
                    return await current.getFileHandle(part, { create: options.create });
                } else if (options.type === 'dir') {
                    return await current.getDirectoryHandle(part, { create: options.create });
                } else {
                    // Try to guess or check existence
                    try {
                        return await current.getFileHandle(part);
                    } catch (e) {
                        return await current.getDirectoryHandle(part);
                    }
                }
            } else {
                current = await current.getDirectoryHandle(part, { create: options.create });
            }
        }
        return current;
    }

    // Promise-based FS implementation for isomorphic-git
    promises = {
        readFile: async (path: string, options?: any): Promise<string | Uint8Array> => {
            const handle = await this.getHandle(path, { type: 'file' }) as FileSystemFileHandle;
            const file = await handle.getFile();
            const buffer = await file.arrayBuffer();
            const uint8 = new Uint8Array(buffer);
            if (options === 'utf8' || (options && options.encoding === 'utf8')) {
                return new TextDecoder().decode(uint8);
            }
            return uint8;
        },

        writeFile: async (path: string, data: string | Uint8Array, options?: any): Promise<void> => {
            const handle = await this.getHandle(path, { create: true, type: 'file' }) as FileSystemFileHandle;
            const writable = await handle.createWritable();
            // Ensure we pass a compatible type to write()
            await writable.write(data as any);
            await writable.close();
        },

        mkdir: async (path: string): Promise<void> => {
            await this.getHandle(path, { create: true, type: 'dir' });
        },

        readdir: async (path: string): Promise<string[]> => {
            const handle = await this.getHandle(path, { type: 'dir' }) as FileSystemDirectoryHandle;
            const result: string[] = [];
            // @ts-ignore - keys() exists on FileSystemDirectoryHandle
            for await (const key of handle.keys()) {
                result.push(key);
            }
            return result;
        },

        stat: async (path: string): Promise<any> => {
            try {
                const handle = await this.getHandle(path);
                const isFile = handle.kind === 'file';

                let size = 0;
                let mtimeMs = Date.now();

                if (isFile) {
                    const file = await (handle as FileSystemFileHandle).getFile();
                    size = file.size;
                    mtimeMs = file.lastModified;
                }

                return {
                    isFile: () => isFile,
                    isDirectory: () => !isFile,
                    isSymbolicLink: () => false,
                    size,
                    mtimeMs,
                    type: isFile ? 'file' : 'dir',
                    mode: isFile ? 0o644 : 0o755,
                };
            } catch (e) {
                const error: any = new Error(`ENOENT: no such file or directory, stat '${path}'`);
                error.code = 'ENOENT';
                throw error;
            }
        },

        unlink: async (path: string): Promise<void> => {
            const parts = path.split('/');
            const name = parts.pop()!;
            const parentPath = parts.join('/');
            const parent = await this.getHandle(parentPath || '/', { type: 'dir' }) as FileSystemDirectoryHandle;
            await parent.removeEntry(name);
        },

        rmdir: async (path: string): Promise<void> => {
            const parts = path.split('/');
            const name = parts.pop()!;
            const parentPath = parts.join('/');
            const parent = await this.getHandle(parentPath || '/', { type: 'dir' }) as FileSystemDirectoryHandle;
            await parent.removeEntry(name, { recursive: true });
        },

        lstat: async (path: string) => this.promises.stat(path),
        readlink: async () => { throw new Error("Symlinks not supported"); },
        symlink: async () => { throw new Error("Symlinks not supported"); },
        chmod: async () => { }, // No-op
    };

    // Callback-based version (required by some parts of isomorphic-git if promises aren't used)
    // We'll wrap the promises for simplicity
    private wrap(fn: (...args: any[]) => Promise<any>) {
        return (...args: any[]) => {
            const cb = args.pop();
            fn(...args).then(res => cb(null, res)).catch(err => cb(err));
        };
    }

    readFile = this.wrap(this.promises.readFile);
    writeFile = this.wrap(this.promises.writeFile);
    mkdir = this.wrap(this.promises.mkdir);
    readdir = this.wrap(this.promises.readdir);
    stat = this.wrap(this.promises.stat);
    unlink = this.wrap(this.promises.unlink);
    rmdir = this.wrap(this.promises.rmdir);
    lstat = this.wrap(this.promises.lstat);
}

export const localFSService = new LocalFSService();
