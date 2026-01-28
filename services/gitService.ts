
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import FS from '@isomorphic-git/lightning-fs';
import { FileNode } from '../types';

class GitService {
  private fs: any;
  private pfs: any;
  private dir = '/repo';
  private proxy = 'https://cors.isomorphic-git.org';

  constructor() {
    this.fs = new FS('git-browser-fs');
    this.pfs = this.fs.promises;
  }

  async initRepo() {
    try {
      await this.pfs.mkdir(this.dir);
    } catch (e) {
      // Directory might already exist
    }
  }

  async clone(url: string, ref: string = 'main', onProgress?: (msg: string) => void) {
    onProgress?.('Initializing clone...');
    try {
      // Clean start for clone
      const files = await this.pfs.readdir(this.dir);
      for (const file of files) {
        await this.recursiveDelete(`${this.dir}/${file}`);
      }
    } catch (e) {}

    await git.clone({
      fs: this.fs,
      http,
      dir: this.dir,
      url,
      ref,
      singleBranch: true,
      depth: 1,
      corsProxy: this.proxy,
      onMessage: (msg) => onProgress?.(msg),
    });
    onProgress?.('Clone complete!');
  }

  async pull(url: string, ref: string = 'main', onProgress?: (msg: string) => void) {
    onProgress?.('Starting pull...');
    try {
      await git.pull({
        fs: this.fs,
        http,
        dir: this.dir,
        url,
        ref,
        singleBranch: true,
        corsProxy: this.proxy,
        author: { name: 'Browser User', email: 'user@example.com' }
      });
      onProgress?.('Pull complete!');
    } catch (err: any) {
      if (err.code === 'NotFoundError') {
        onProgress?.('Repository not found locally. Performing initial clone instead...');
        await this.clone(url, ref, onProgress);
      } else {
        throw err;
      }
    }
  }

  async getFileTree(path: string = this.dir): Promise<FileNode[]> {
    try {
      const files = await this.pfs.readdir(path);
      const nodes: FileNode[] = [];

      for (const file of files) {
        if (file === '.git') continue;
        const fullPath = `${path}/${file}`;
        const stat = await this.pfs.stat(fullPath);
        
        if (stat.isDirectory()) {
          nodes.push({
            name: file,
            path: fullPath,
            type: 'dir',
            children: await this.getFileTree(fullPath)
          });
        } else {
          nodes.push({
            name: file,
            path: fullPath,
            type: 'file'
          });
        }
      }
      return nodes.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === 'dir' ? -1 : 1;
      });
    } catch (e) {
      return [];
    }
  }

  async readFile(path: string): Promise<string> {
    const content = await this.pfs.readFile(path, 'utf8');
    return content;
  }

  private async recursiveDelete(path: string) {
    const stat = await this.pfs.stat(path);
    if (stat.isDirectory()) {
      const files = await this.pfs.readdir(path);
      for (const file of files) {
        await this.recursiveDelete(`${path}/${file}`);
      }
      await this.pfs.rmdir(path);
    } else {
      await this.pfs.unlink(path);
    }
  }
}

export const gitService = new GitService();
