import * as core from '@actions/core';
import * as os from 'os';
import {
  CACHE_DIR,
  slugify,
  ensureBoringCache,
  saveCache
} from './utils';

async function run(): Promise<void> {
  try {
    // Try to get values from state first (set by restore action), then fall back to inputs
    let workspace = core.getState('workspace') || core.getInput('workspace') || '';
    let cacheTag = core.getState('cacheTag') || core.getInput('cache-tag') || '';
    let cacheDir = core.getState('cacheDir') || core.getInput('cache-dir') || CACHE_DIR;
    const cliVersion = core.getInput('cli-version') || 'v1.0.0';

    // Resolve workspace
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

    // Generate cache tag if not provided
    // BoringCache is content-addressed, so no hash needed in the tag
    if (!cacheTag) {
      const image = core.getInput('image') || '';
      cacheTag = image ? slugify(image) : 'docker';
    }

    // Re-add expected PATH entries in case they were lost
    const homedir = os.homedir();
    core.addPath(`${homedir}/.local/bin`);
    core.addPath(`${homedir}/.boringcache/bin`);

    if (cliVersion.toLowerCase() !== 'skip') {
      await ensureBoringCache({ version: cliVersion });
    }

    await saveCache(workspace, cacheTag, cacheDir);

    core.info('Save to BoringCache complete');
  } catch (error) {
    if (error instanceof Error) {
      core.warning(`Save failed: ${error.message}`);
    }
  }
}

run();
