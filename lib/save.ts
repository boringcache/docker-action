import * as core from '@actions/core';
import * as os from 'os';
import { saveCache } from './utils';

async function run(): Promise<void> {
  try {
    const workspace = core.getState('workspace');
    const cacheDir = core.getState('cacheDir');
    const cacheTag = core.getState('cacheTag');

    if (!workspace || !cacheDir || !cacheTag) {
      core.notice('Cache save skipped because required state is missing');
      return;
    }

    // Re-add expected PATH entries in case the post phase lost them
    const homedir = os.homedir();
    core.addPath(`${homedir}/.local/bin`);
    core.addPath(`${homedir}/.boringcache/bin`);

    await saveCache(workspace, cacheTag, cacheDir);

    core.info('Save to BoringCache complete');
  } catch (error) {
    if (error instanceof Error) {
      core.warning(`Save failed: ${error.message}`);
    }
  }
}

run();
