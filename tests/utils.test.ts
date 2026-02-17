import { slugify, getWorkspace, parseBoolean, parseList, parseMultiline, getRegistryRef, CACHE_DIR_FROM, CACHE_DIR_TO, CACHE_DIR, buildDockerImage } from '../lib/utils';
import * as core from '@actions/core';
import * as exec from '@actions/exec';

describe('Docker Utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BORINGCACHE_DEFAULT_WORKSPACE;
  });

  describe('slugify', () => {
    it('should replace non-alphanumeric characters with hyphens', () => {
      expect(slugify('ghcr.io/org/app')).toBe('ghcr-io-org-app');
      expect(slugify('my-image:latest')).toBe('my-image-latest');
      expect(slugify('simple')).toBe('simple');
    });
  });

  describe('parseBoolean', () => {
    it('should parse boolean strings correctly', () => {
      expect(parseBoolean('true')).toBe(true);
      expect(parseBoolean('TRUE')).toBe(true);
      expect(parseBoolean('false')).toBe(false);
      expect(parseBoolean('')).toBe(false);
      expect(parseBoolean(undefined)).toBe(false);
    });

    it('should use default value when undefined', () => {
      expect(parseBoolean(undefined, true)).toBe(true);
      expect(parseBoolean('', true)).toBe(true);
    });
  });

  describe('parseList', () => {
    it('should parse comma-separated lists', () => {
      expect(parseList('a,b,c')).toEqual(['a', 'b', 'c']);
      expect(parseList('a, b, c')).toEqual(['a', 'b', 'c']);
    });

    it('should filter empty items', () => {
      expect(parseList('a,,b')).toEqual(['a', 'b']);
      expect(parseList('')).toEqual([]);
    });
  });

  describe('parseMultiline', () => {
    it('should parse multiline strings', () => {
      expect(parseMultiline('a\nb\nc')).toEqual(['a', 'b', 'c']);
    });

    it('should trim whitespace', () => {
      expect(parseMultiline('  a  \n  b  ')).toEqual(['a', 'b']);
    });
  });

  describe('getWorkspace', () => {
    it('should return input workspace when provided', () => {
      expect(getWorkspace('my-org/my-project')).toBe('my-org/my-project');
    });

    it('should use BORINGCACHE_DEFAULT_WORKSPACE as fallback', () => {
      process.env.BORINGCACHE_DEFAULT_WORKSPACE = 'default-org/default-project';
      expect(getWorkspace('')).toBe('default-org/default-project');
    });

    it('should add default/ prefix when no slash present', () => {
      expect(getWorkspace('my-project')).toBe('default/my-project');
    });

    it('should fail when no workspace available', () => {
      expect(() => getWorkspace('')).toThrow('Workspace required');
      expect(core.setFailed).toHaveBeenCalled();
    });
  });

  describe('getRegistryRef', () => {
    it('should construct registry ref from port and cache tag', () => {
      expect(getRegistryRef(5000, 'my-cache')).toBe('localhost:5000/my-cache');
      expect(getRegistryRef(5001, 'ghcr-io-org-app')).toBe('localhost:5001/ghcr-io-org-app');
    });
  });

  describe('cache directories', () => {
    it('should have separate from and to directories', () => {
      expect(CACHE_DIR_FROM).toContain('buildkit-cache-from');
      expect(CACHE_DIR_TO).toContain('buildkit-cache-to');
      expect(CACHE_DIR_FROM).not.toBe(CACHE_DIR_TO);
      expect(CACHE_DIR_FROM).not.toBe(CACHE_DIR);
      expect(CACHE_DIR_TO).not.toBe(CACHE_DIR);
    });
  });

  describe('buildDockerImage', () => {
    it('should use type=local when cacheDirFrom/To are set', async () => {
      (exec.exec as jest.Mock).mockResolvedValue(0);

      await buildDockerImage({
        dockerfile: 'Dockerfile',
        context: '/workspace',
        image: 'my-app',
        tags: ['latest'],
        buildArgs: [],
        secrets: [],
        push: false,
        load: true,
        noCache: false,
        builder: 'test-builder',
        cacheDirFrom: '/tmp/cache-from',
        cacheDirTo: '/tmp/cache-to',
        cacheMode: 'max',
      });

      const callArgs = (exec.exec as jest.Mock).mock.calls[0];
      const args: string[] = callArgs[1];

      const cacheFromIdx = args.indexOf('--cache-from');
      expect(cacheFromIdx).toBeGreaterThan(-1);
      expect(args[cacheFromIdx + 1]).toBe('type=local,src=/tmp/cache-from');

      const cacheToIdx = args.indexOf('--cache-to');
      expect(cacheToIdx).toBeGreaterThan(-1);
      expect(args[cacheToIdx + 1]).toBe('type=local,dest=/tmp/cache-to,mode=max');
    });

    it('should use type=registry when cacheFrom/To strings are set', async () => {
      (exec.exec as jest.Mock).mockResolvedValue(0);

      await buildDockerImage({
        dockerfile: 'Dockerfile',
        context: '/workspace',
        image: 'my-app',
        tags: ['latest'],
        buildArgs: [],
        secrets: [],
        push: false,
        load: true,
        noCache: false,
        builder: 'test-builder',
        cacheMode: 'max',
        cacheFrom: 'type=registry,ref=localhost:5000/my-cache',
        cacheTo: 'type=registry,ref=localhost:5000/my-cache,mode=max',
      });

      const callArgs = (exec.exec as jest.Mock).mock.calls[0];
      const args: string[] = callArgs[1];

      const cacheFromIdx = args.indexOf('--cache-from');
      expect(cacheFromIdx).toBeGreaterThan(-1);
      expect(args[cacheFromIdx + 1]).toBe('type=registry,ref=localhost:5000/my-cache');

      const cacheToIdx = args.indexOf('--cache-to');
      expect(cacheToIdx).toBeGreaterThan(-1);
      expect(args[cacheToIdx + 1]).toBe('type=registry,ref=localhost:5000/my-cache,mode=max');
    });

    it('should never use the same directory for cache-from and cache-to in local mode', async () => {
      (exec.exec as jest.Mock).mockResolvedValue(0);

      await buildDockerImage({
        dockerfile: 'Dockerfile',
        context: '/workspace',
        image: 'my-app',
        tags: ['latest'],
        buildArgs: [],
        secrets: [],
        push: false,
        load: true,
        noCache: false,
        builder: 'test-builder',
        cacheDirFrom: CACHE_DIR_FROM,
        cacheDirTo: CACHE_DIR_TO,
        cacheMode: 'min',
      });

      const callArgs = (exec.exec as jest.Mock).mock.calls[0];
      const args: string[] = callArgs[1];

      const cacheFromIdx = args.indexOf('--cache-from');
      const cacheToIdx = args.indexOf('--cache-to');
      const fromValue = args[cacheFromIdx + 1];
      const toValue = args[cacheToIdx + 1];

      const fromPath = fromValue.replace('type=local,src=', '');
      const toPath = toValue.replace(/type=local,dest=([^,]+).*/, '$1');
      expect(fromPath).not.toBe(toPath);
    });
  });
});
