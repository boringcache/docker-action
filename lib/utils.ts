import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { ensureBoringCache, execBoringCache as execBoringCacheCore } from '@boringcache/action-core';

export { ensureBoringCache };

export const CACHE_DIR = '/tmp/buildkit-cache';
export const METADATA_FILE = '/tmp/docker-metadata.json';

let lastOutput = '';

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
  lastOutput = '';
  let output = '';

  const code = await execBoringCacheCore(args, {
    silent: true,
    listeners: {
      stdout: (data: Buffer) => {
        const text = data.toString();
        output += text;
        process.stdout.write(text);
      },
      stderr: (data: Buffer) => {
        const text = data.toString();
        output += text;
        process.stderr.write(text);
      }
    }
  });

  lastOutput = output;
  return code;
}

export function wasCacheHit(exitCode: number): boolean {
  if (exitCode !== 0) {
    return false;
  }

  if (!lastOutput) {
    return true;
  }

  const missPatterns = [/Cache miss/i, /No cache entries/i, /Found 0\//i];
  return !missPatterns.some(pattern => pattern.test(lastOutput));
}

export async function restoreCache(workspace: string, cacheKey: string, cacheDir: string): Promise<boolean> {
  if (!process.env.BORINGCACHE_API_TOKEN) {
    core.notice('Skipping cache restore (BORINGCACHE_API_TOKEN not set)');
    return false;
  }

  const result = await execBoringCache(['restore', workspace, `${cacheKey}:${cacheDir}`]);

  if (wasCacheHit(result)) {
    return true;
  }

  core.info('Cache miss');
  return false;
}

export async function saveCache(workspace: string, cacheKey: string, cacheDir: string): Promise<void> {
  if (!process.env.BORINGCACHE_API_TOKEN) {
    core.notice('Skipping cache save (BORINGCACHE_API_TOKEN not set)');
    return;
  }

  if (!fs.existsSync(cacheDir) || fs.readdirSync(cacheDir).length === 0) {
    core.notice('No cache files to save');
    return;
  }

  await execBoringCache(['save', workspace, `${cacheKey}:${cacheDir}`, '--force']);
  core.info('Cache saved');
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
  buildkitdConfigInline: string
): Promise<string> {
  const builderName = 'boringcache-builder';
  core.saveState('builderName', builderName);

  let driverToUse = driver || 'docker-container';
  if (driverToUse === 'docker') {
    core.warning('Buildx driver "docker" does not support cache export; falling back to "docker-container".');
    driverToUse = 'docker-container';
  }

  let configPath = '';
  if (buildkitdConfigInline && buildkitdConfigInline.trim().length > 0) {
    configPath = path.join('/tmp', `buildkitd-${Date.now()}.toml`);
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
  driverOpts.forEach(opt => {
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

  const result = await exec.exec('docker', ['buildx', 'inspect', builderName], {
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
  cacheDir: string;
  cacheMode: string;
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

  args.push('--cache-from', `type=local,src=${opts.cacheDir}`);
  args.push('--cache-to', `type=local,dest=${opts.cacheDir},mode=${opts.cacheMode}`);
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
