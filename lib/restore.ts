import * as core from '@actions/core';
import * as path from 'path';
import {
  CACHE_DIR,
  parseBoolean,
  parseList,
  parseMultiline,
  slugify,
  ensureDir,
  getWorkspace,
  ensureBoringCache,
  restoreCache,
  setupQemuIfNeeded,
  setupBuildxBuilder,
  getBuilderPlatforms,
  buildDockerImage,
  readMetadata
} from './utils';

async function run(): Promise<void> {
  try {
    const context = path.resolve(process.cwd(), core.getInput('context') || '.');
    const dockerfile = core.getInput('dockerfile') || 'Dockerfile';
    const image = core.getInput('image', { required: true });
    const tags = parseList(core.getInput('tags') || 'latest');
    const buildArgs = parseMultiline(core.getInput('build-args') || '');
    const secrets = parseMultiline(core.getInput('secrets') || '');
    const target = core.getInput('target') || '';
    const platforms = core.getInput('platforms') || '';
    const push = parseBoolean(core.getInput('push'), false);
    const load = parseBoolean(core.getInput('load'), true) && !platforms;
    const noCache = parseBoolean(core.getInput('no-cache'), false);
    const cacheMode = core.getInput('cache-mode') || 'max';
    const cliVersion = core.getInput('cli-version') || '';
    const driver = core.getInput('driver') || 'docker-container';
    const driverOpts = parseMultiline(core.getInput('driver-opts') || '');
    const buildkitdConfigInline = core.getInput('buildkitd-config-inline') || '';

    const workspace = getWorkspace(core.getInput('workspace') || '');

    // Cache tag: user-provided or default to slugified image name
    // BoringCache is content-addressed, so no hash needed in the tag
    const cacheTag = core.getInput('cache-tag') || slugify(image);

    // Save state for post phase
    core.saveState('workspace', workspace);
    core.saveState('cacheDir', CACHE_DIR);
    core.saveState('cacheTag', cacheTag);

    ensureDir(CACHE_DIR);

    if (cliVersion.toLowerCase() !== 'skip') {
      await ensureBoringCache({ version: cliVersion || 'v1.0.0' });
    }
    const builderName = await setupBuildxBuilder(driver, driverOpts, buildkitdConfigInline);
    core.setOutput('buildx-name', builderName);
    core.setOutput('buildx-platforms', await getBuilderPlatforms(builderName));
    await setupQemuIfNeeded(platforms);

    const cacheHit = await restoreCache(workspace, cacheTag, CACHE_DIR);
    core.setOutput('cache-hit', cacheHit ? 'true' : 'false');

    await buildDockerImage({
      dockerfile,
      context,
      image,
      tags,
      buildArgs,
      secrets,
      target,
      platforms,
      push,
      load,
      noCache,
      builder: builderName,
      cacheDir: CACHE_DIR,
      cacheMode
    });

    const { imageId, digest } = readMetadata();
    core.setOutput('image-id', imageId);
    core.setOutput('digest', digest);

    // Compatibility outputs
    core.setOutput('buildx-name', 'default');
    core.setOutput('buildx-platforms', platforms || '');
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

run();
