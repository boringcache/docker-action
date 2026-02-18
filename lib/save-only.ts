import * as core from '@actions/core';
import * as os from 'os';
import * as path from 'path';
import {
  CACHE_DIR,
  slugify,
  ensureBoringCache,
  saveCache,
  stopRegistryProxy,
  parseBoolean,
  CacheFlags
} from './utils';

async function run(): Promise<void> {
  try {
    const proxyPid = core.getState('proxyPid');

    if (proxyPid) {
      await stopRegistryProxy(parseInt(proxyPid, 10));
      core.info('Registry proxy cache sync complete');
      return;
    }

    let workspace = core.getState('workspace') || core.getInput('workspace') || '';
    let cacheTag = core.getState('cacheTag') || core.getInput('cache-tag') || '';
    let cacheDir = core.getState('cacheDir') || core.getInput('cache-dir') || CACHE_DIR;
    const cliVersion = core.getInput('cli-version') || 'v1.0.2';
    const verbose = core.getState('verbose') === 'true' || parseBoolean(core.getInput('verbose'), false);
    const exclude = core.getState('exclude') || core.getInput('exclude') || '';

    if (!workspace) {
      workspace = process.env.BORINGCACHE_DEFAULT_WORKSPACE || '';
    }
    if (!workspace) {
      core.notice('No workspace provided, skipping cache save');
      return;
    }
    if (!workspace.includes('/')) {
      workspace = `default/${workspace}`;
    }

    if (!cacheTag) {
      const image = core.getInput('image') || '';
      cacheTag = image ? slugify(image) : 'docker';
    }

    const homedir = os.homedir();
    core.addPath(path.join(homedir, '.local', 'bin'));
    core.addPath(path.join(homedir, '.boringcache', 'bin'));

    if (cliVersion.toLowerCase() !== 'skip') {
      await ensureBoringCache({ version: cliVersion });
    }

    const cacheFlags: CacheFlags = { verbose, exclude };
    await saveCache(workspace, cacheTag, cacheDir, cacheFlags);

    core.info('Save to BoringCache complete');
  } catch (error) {
    if (error instanceof Error) {
      core.warning(`Save failed: ${error.message}`);
    }
  }
}

run();
