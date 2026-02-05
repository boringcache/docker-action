import { slugify, getWorkspace, parseBoolean, parseList, parseMultiline } from '../lib/utils';
import * as core from '@actions/core';

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
});
