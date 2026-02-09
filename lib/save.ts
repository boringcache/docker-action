import * as core from '@actions/core';
import * as os from 'os';
import * as path from 'path';
import { saveCache, CacheFlags } from './utils';

async function run(): Promise<void> {
  try {
    const workspace = core.getState('workspace');
    const cacheDir = core.getState('cacheDir');
    const cacheTag = core.getState('cacheTag');
    const verbose = core.getState('verbose') === 'true';
    const exclude = core.getState('exclude') || '';

    if (!workspace || !cacheDir || !cacheTag) {
      core.notice('Cache save skipped because required state is missing');
      return;
    }

    const cacheFlags: CacheFlags = { verbose, exclude };

    // Re-add expected PATH entries in case the post phase lost them
    const homedir = os.homedir();
    core.addPath(path.join(homedir, '.local', 'bin'));
    core.addPath(path.join(homedir, '.boringcache', 'bin'));

    await saveCache(workspace, cacheTag, cacheDir, cacheFlags);

    core.info('Save to BoringCache complete');
  } catch (error) {
    if (error instanceof Error) {
      core.warning(`Save failed: ${error.message}`);
    }
  }
}

run();
