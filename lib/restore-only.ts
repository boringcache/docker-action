import * as core from '@actions/core';
import {
  CACHE_DIR,
  slugify,
  ensureDir,
  getWorkspace,
  ensureBoringCache,
  restoreCache,
  parseBoolean,
  CacheFlags
} from './utils';

async function run(): Promise<void> {
  try {
    const workspace = getWorkspace(core.getInput('workspace', { required: true }));
    const cacheDir = core.getInput('cache-dir') || CACHE_DIR;
    const cliVersion = core.getInput('cli-version') || 'v1.0.0';
    const verbose = parseBoolean(core.getInput('verbose'), false);
    const exclude = core.getInput('exclude') || '';

    // Cache tag: user-provided or default to slugified image name
    // BoringCache is content-addressed, so no hash needed in the tag
    const image = core.getInput('image') || '';
    const cacheTag = core.getInput('cache-tag') || (image ? slugify(image) : 'docker');

    const cacheFlags: CacheFlags = { verbose, exclude };

    ensureDir(cacheDir);

    if (cliVersion.toLowerCase() !== 'skip') {
      await ensureBoringCache({ version: cliVersion });
    }

    const cacheHit = await restoreCache(workspace, cacheTag, cacheDir, cacheFlags);

    // Set outputs
    core.setOutput('cache-hit', cacheHit ? 'true' : 'false');
    core.setOutput('cache-tag', cacheTag);
    core.setOutput('cache-dir', cacheDir);

    // Save state for potential use by save action
    core.saveState('workspace', workspace);
    core.saveState('cacheTag', cacheTag);
    core.saveState('cacheDir', cacheDir);
    core.saveState('verbose', verbose.toString());
    core.saveState('exclude', exclude);

    if (cacheHit) {
      core.notice(`Cache restored from BoringCache (tag: ${cacheTag})`);
    } else {
      core.notice(`Cache miss (tag: ${cacheTag})`);
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

run();
