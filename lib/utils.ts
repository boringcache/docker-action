import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as http from 'http';
import { spawn, ChildProcess } from 'child_process';
import { ensureBoringCache, execBoringCache as execBoringCacheCore } from '@boringcache/action-core';

export { ensureBoringCache };

export const CACHE_DIR = path.join(os.tmpdir(), 'buildkit-cache');
export const CACHE_DIR_FROM = path.join(os.tmpdir(), 'buildkit-cache-from');
export const CACHE_DIR_TO = path.join(os.tmpdir(), 'buildkit-cache-to');
export const METADATA_FILE = path.join(os.tmpdir(), 'docker-metadata.json');

export function parseBoolean(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === null || value === '') return defaultValue;
  return String(value).trim().toLowerCase() === 'true';
}

export function parseList(input: string, separator = ','): string[] {
  return input
    .split(separator)
    .map(item => item.trim())
    .filter(item => item.length > 0);
}

export function parseMultiline(input: string): string[] {
  return input
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

export function slugify(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '-');
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function computeDockerfileHash(dockerfilePath: string): string {
  if (!fs.existsSync(dockerfilePath)) {
    return '';
  }
  const content = fs.readFileSync(dockerfilePath);
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export function getWorkspace(inputWorkspace: string): string {
  let workspace = inputWorkspace || process.env.BORINGCACHE_DEFAULT_WORKSPACE || '';

  if (!workspace) {
    core.setFailed('Workspace is required. Set workspace input or BORINGCACHE_DEFAULT_WORKSPACE env var.');
    throw new Error('Workspace required');
  }

  if (!workspace.includes('/')) {
    workspace = `default/${workspace}`;
  }

  return workspace;
}

export async function execBoringCache(args: string[]): Promise<number> {
  return execBoringCacheCore(args);
}

export interface CacheFlags {
  verbose?: boolean;
  exclude?: string;
}

export async function restoreCache(workspace: string, cacheKey: string, cacheDir: string, flags: CacheFlags = {}): Promise<void> {
  if (!process.env.BORINGCACHE_API_TOKEN) {
    core.notice('Skipping cache restore (BORINGCACHE_API_TOKEN not set)');
    return;
  }

  const args = ['restore', workspace, `${cacheKey}:${cacheDir}`];
  if (flags.verbose) {
    args.push('--verbose');
  }

  await execBoringCache(args);
}

export async function saveCache(workspace: string, cacheKey: string, cacheDir: string, flags: CacheFlags = {}): Promise<void> {
  if (!process.env.BORINGCACHE_API_TOKEN) {
    core.notice('Skipping cache save (BORINGCACHE_API_TOKEN not set)');
    return;
  }

  if (!fs.existsSync(cacheDir) || fs.readdirSync(cacheDir).length === 0) {
    core.notice('No cache files to save');
    return;
  }

  const args = ['save', workspace, `${cacheKey}:${cacheDir}`, '--force'];
  if (flags.verbose) {
    args.push('--verbose');
  }
  if (flags.exclude) {
    args.push('--exclude', flags.exclude);
  }

  await execBoringCache(args);
  core.info('Cache saved');
}

export function getRegistryRef(port: number, cacheTag: string, host = '127.0.0.1'): string {
  return `${host}:${port}/${cacheTag}`;
}

export function getRegistryCacheFlags(ref: string, cacheMode: string): { cacheFrom: string; cacheTo: string } {
  return {
    cacheFrom: `type=registry,ref=${ref},registry.insecure=true`,
    cacheTo: `type=registry,ref=${ref},mode=${cacheMode},registry.insecure=true`
  };
}

export async function getContainerGateway(containerName: string): Promise<string> {
  let output = '';
  const result = await exec.exec('docker', [
    'inspect', '-f', '{{.NetworkSettings.Gateway}}', containerName
  ], {
    ignoreReturnCode: true,
    silent: true,
    listeners: { stdout: (data: Buffer) => { output += data.toString(); } }
  });
  const gateway = output.trim();
  if (result !== 0 || !gateway) {
    core.warning(`Could not determine gateway for container ${containerName}, falling back to 172.17.0.1`);
    return '172.17.0.1';
  }
  return gateway;
}

export async function getContainerNetworkMode(containerName: string): Promise<string> {
  let output = '';
  const result = await exec.exec('docker', [
    'inspect', '-f', '{{.HostConfig.NetworkMode}}', containerName
  ], {
    ignoreReturnCode: true,
    silent: true,
    listeners: { stdout: (data: Buffer) => { output += data.toString(); } }
  });
  const networkMode = output.trim();
  if (result !== 0 || !networkMode) {
    core.warning(`Could not determine network mode for container ${containerName}, assuming bridge`);
    return 'bridge';
  }
  return networkMode;
}

const PROXY_LOG_FILE = path.join(os.tmpdir(), 'boringcache-proxy.log');
const PROXY_PID_FILE = path.join(os.tmpdir(), 'boringcache-proxy.pid');

async function isProxyRunning(port: number): Promise<boolean> {
  try {
    return await new Promise<boolean>((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/v2/`, (res) => {
        resolve(res.statusCode === 200 || res.statusCode === 401);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(1000, () => { req.destroy(); resolve(false); });
    });
  } catch {
    return false;
  }
}

export async function startRegistryProxy(
  workspace: string,
  port: number,
  verbose: boolean,
  bindHost = '127.0.0.1',
  options: { registryTag?: string; noGit?: boolean; noPlatform?: boolean } = {}
): Promise<number> {
  if (!process.env.BORINGCACHE_API_TOKEN) {
    throw new Error('BORINGCACHE_API_TOKEN is required for registry proxy mode');
  }

  if (await isProxyRunning(port)) {
    core.info(`Registry proxy already running on port ${port}, reusing`);
    try {
      const pid = parseInt(fs.readFileSync(PROXY_PID_FILE, 'utf-8').trim(), 10);
      if (pid > 0) return pid;
    } catch {}
    return -1;
  }

  const args = ['docker-registry', workspace];
  const registryTag = (options.registryTag || '').trim();
  if (registryTag) {
    args.push(registryTag);
  }
  if (options.noGit) {
    args.push('--no-git');
  }
  if (options.noPlatform) {
    args.push('--no-platform');
  }
  args.push('--host', bindHost, '--port', String(port));
  if (verbose) {
    args.push('--verbose');
  }

  core.info(`Starting registry proxy on ${bindHost}:${port}...`);

  const logFd = fs.openSync(PROXY_LOG_FILE, 'w');
  const child: ChildProcess = spawn('boringcache', args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env
  });

  child.unref();
  fs.closeSync(logFd);

  if (!child.pid) {
    throw new Error('Failed to start registry proxy');
  }

  fs.writeFileSync(PROXY_PID_FILE, String(child.pid));
  core.info(`Registry proxy started (PID: ${child.pid})`);
  return child.pid;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readProxyLogs(): string {
  try {
    return fs.readFileSync(PROXY_LOG_FILE, 'utf-8').trim();
  } catch {
    return '';
  }
}

export async function waitForProxy(port: number, timeoutMs = 20000, pid?: number): Promise<void> {
  const start = Date.now();
  const interval = 500;

  while (Date.now() - start < timeoutMs) {
    if (pid && !isProcessAlive(pid)) {
      const logs = readProxyLogs();
      throw new Error(`Registry proxy exited before becoming ready${logs ? `:\n${logs}` : ''}`);
    }

    try {
      const ok = await new Promise<boolean>((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/v2/`, (res) => {
          resolve(res.statusCode === 200 || res.statusCode === 401);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(1000, () => {
          req.destroy();
          resolve(false);
        });
      });
      if (ok) {
        core.info('Registry proxy is ready');
        return;
      }
    } catch {
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  const logs = readProxyLogs();
  throw new Error(`Registry proxy did not become ready within ${timeoutMs}ms${logs ? `:\n${logs}` : ''}`);
}

export async function stopRegistryProxy(pid: number): Promise<void> {
  if (pid <= 0) {
    core.info('No proxy PID to stop (was reused from another invocation)');
    return;
  }
  core.info(`Stopping registry proxy (PID: ${pid})...`);
  try {
    process.kill(pid, 'SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 2000));
    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
    } catch {
    }
    core.info('Registry proxy stopped');
  } catch (err) {
    core.warning(`Failed to stop registry proxy: ${(err as Error).message}`);
  }
}

export async function setupQemuIfNeeded(platforms: string): Promise<void> {
  if (!platforms) return;

  const result = await exec.exec(
    'docker',
    ['run', '--privileged', '--rm', 'tonistiigi/binfmt', '--install', 'all'],
    { ignoreReturnCode: true }
  );

  if (result !== 0) {
    throw new Error(`Failed to set up QEMU for multi-platform builds (exit ${result})`);
  }
}

export async function setupBuildxBuilder(
  driver: string,
  driverOpts: string[],
  buildkitdConfigInline: string,
  registryMode = false
): Promise<string> {
  const builderName = 'boringcache-builder';

  let driverToUse = driver || 'docker-container';
  if (driverToUse === 'docker') {
    core.warning('Buildx driver "docker" does not support cache export; falling back to "docker-container".');
    driverToUse = 'docker-container';
  }

  const effectiveDriverOpts = [...driverOpts];
  if (registryMode && driverToUse === 'docker-container') {
    const hasNetworkOpt = effectiveDriverOpts.some(opt => opt.startsWith('network='));
    if (!hasNetworkOpt) {
      core.info('Adding network=host to builder for registry proxy access');
      effectiveDriverOpts.push('network=host');
    }
  }

  let configPath = '';
  if (buildkitdConfigInline && buildkitdConfigInline.trim().length > 0) {
    configPath = path.join(os.tmpdir(), `buildkitd-${Date.now()}.toml`);
    fs.writeFileSync(configPath, buildkitdConfigInline);
  }

  const inspectResult = await exec.exec('docker', ['buildx', 'inspect', builderName], {
    ignoreReturnCode: true,
    silent: true
  });

  if (inspectResult === 0) {
    await exec.exec('docker', ['buildx', 'use', builderName]);
    return builderName;
  }

  const args = ['buildx', 'create', '--name', builderName, '--driver', driverToUse];
  effectiveDriverOpts.forEach(opt => {
    args.push('--driver-opt', opt);
  });
  if (configPath) {
    args.push('--config', configPath);
  }
  args.push('--use');

  const createResult = await exec.exec('docker', args, { ignoreReturnCode: true });
  if (createResult !== 0) {
    throw new Error(`Failed to create buildx builder (exit ${createResult})`);
  }

  return builderName;
}

export async function getBuilderPlatforms(builderName: string): Promise<string> {
  let output = '';

  const result = await exec.exec('docker', ['buildx', 'inspect', builderName, '--bootstrap'], {
    ignoreReturnCode: true,
    silent: true,
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      }
    }
  });

  if (result !== 0) return '';

  const match = output.split('\n').find(line => line.trim().startsWith('Platforms:'));
  if (!match) return '';
  return match.replace('Platforms:', '').trim();
}

export interface DockerBuildOptions {
  dockerfile: string;
  context: string;
  image: string;
  tags: string[];
  buildArgs: string[];
  secrets: string[];
  target?: string;
  platforms?: string;
  push: boolean;
  load: boolean;
  noCache: boolean;
  builder: string;
  cacheMode: string;
  cacheDirFrom?: string;
  cacheDirTo?: string;
  cacheFrom?: string;
  cacheTo?: string;
}

export async function buildDockerImage(opts: DockerBuildOptions): Promise<void> {
  const args = [
    'buildx',
    'build',
    '--builder',
    opts.builder,
    '-f',
    opts.dockerfile
  ];

  opts.tags.forEach(tag => {
    args.push('-t', `${opts.image}:${tag}`);
  });

  opts.buildArgs.forEach(arg => {
    args.push('--build-arg', arg);
  });

  opts.secrets.forEach(secret => {
    args.push('--secret', secret);
  });

  if (opts.target) {
    args.push('--target', opts.target);
  }

  if (opts.platforms) {
    args.push('--platform', opts.platforms);
  }

  if (opts.push) {
    args.push('--push');
  }

  if (opts.load) {
    args.push('--load');
  }

  if (opts.noCache) {
    args.push('--no-cache');
  }

  if (opts.cacheFrom) {
    args.push('--cache-from', opts.cacheFrom);
    args.push('--cache-to', opts.cacheTo || opts.cacheFrom);
  } else if (opts.cacheDirFrom) {
    args.push('--cache-from', `type=local,src=${opts.cacheDirFrom}`);
    args.push('--cache-to', `type=local,dest=${opts.cacheDirTo},mode=${opts.cacheMode}`);
  }

  args.push('--metadata-file', METADATA_FILE);
  args.push('.');

  const result = await exec.exec('docker', args, {
    cwd: opts.context,
    env: {
      ...process.env,
      DOCKER_BUILDKIT: '1'
    }
  });

  if (result !== 0) {
    throw new Error(`docker buildx build failed with exit code ${result}`);
  }
}

export function readMetadata(): { imageId: string; digest: string } {
  if (!fs.existsSync(METADATA_FILE)) {
    return { imageId: '', digest: '' };
  }

  try {
    const data = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
    return {
      imageId: data['containerimage.config.digest'] || '',
      digest: data['containerimage.digest'] || ''
    };
  } catch (err) {
    core.warning(`Failed to parse metadata file: ${(err as Error).message}`);
    return { imageId: '', digest: '' };
  }
}
