import * as core from '@actions/core';
import * as path from 'path';
import {
  CACHE_DIR_FROM,
  CACHE_DIR_TO,
  parseBoolean,
  parseList,
  parseMultiline,
  slugify,
  ensureDir,
  getWorkspace,
  ensureBoringCache,
  restoreCache,
  startRegistryProxy,
  waitForProxy,
  getRegistryRef,
  getRegistryCacheFlags,
  getContainerGateway,
  getContainerNetworkMode,
  setupQemuIfNeeded,
  setupBuildxBuilder,
  getBuilderPlatforms,
  buildDockerImage,
  readMetadata,
  CacheFlags
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
    const registryTag = core.getInput('registry-tag') || '';
    const proxyNoGit = parseBoolean(core.getInput('proxy-no-git'), false);
    const proxyNoPlatform = parseBoolean(core.getInput('proxy-no-platform'), false);
    const verbose = parseBoolean(core.getInput('verbose'), false);
    const exclude = core.getInput('exclude') || '';
    const cacheBackend = core.getInput('cache-backend') || 'registry';
    const proxyPort = parseInt(core.getInput('proxy-port') || '5000', 10);

    const cacheTag = core.getInput('cache-tag') || slugify(image);
    const cacheFlags: CacheFlags = { verbose, exclude };
    const useRegistryProxy = cacheBackend !== 'local';

    core.saveState('workspace', workspace);
    core.saveState('cacheTag', cacheTag);
    core.saveState('registryTag', registryTag);
    core.saveState('proxyNoGit', proxyNoGit.toString());
    core.saveState('proxyNoPlatform', proxyNoPlatform.toString());
    core.saveState('verbose', verbose.toString());
    core.saveState('exclude', exclude);
    if (cliVersion.toLowerCase() !== 'skip') {
      await ensureBoringCache({ version: cliVersion });
    }

    const builderName = await setupBuildxBuilder(driver, driverOpts, buildkitdConfigInline, useRegistryProxy);
    core.setOutput('buildx-name', builderName);
    core.setOutput('buildx-platforms', await getBuilderPlatforms(builderName));
    await setupQemuIfNeeded(platforms);

    if (useRegistryProxy) {
      let proxyBindHost = '127.0.0.1';
      let refHost = '127.0.0.1';

      if (driver === 'docker-container') {
        const containerName = `buildx_buildkit_${builderName}0`;
        const networkMode = await getContainerNetworkMode(containerName);

        if (networkMode === 'host') {
          core.info('Buildx container uses host networking; using loopback registry ref');
        } else {
          proxyBindHost = '0.0.0.0';
          refHost = await getContainerGateway(containerName);
          core.info(`Buildx in container network "${networkMode}", proxy binding to ${proxyBindHost}, ref using gateway ${refHost}`);
        }
      }

      const effectiveTag = registryTag || cacheTag;
      const proxy = await startRegistryProxy({
        command: 'docker-registry',
        workspace,
        tag: effectiveTag,
        host: proxyBindHost,
        port: proxyPort,
        noGit: proxyNoGit,
        noPlatform: proxyNoPlatform,
        verbose,
      });
      await waitForProxy(proxy.port, 20000, proxy.pid);
      core.saveState('proxyPid', String(proxy.pid));

      const ref = getRegistryRef(proxyPort, cacheTag, refHost);
      const registryCache = getRegistryCacheFlags(ref, cacheMode);

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
        cacheMode,
        cacheFrom: registryCache.cacheFrom,
        cacheTo: registryCache.cacheTo
      });
    } else {
      ensureDir(CACHE_DIR_FROM);
      ensureDir(CACHE_DIR_TO);
      core.saveState('cacheDir', CACHE_DIR_TO);

      await restoreCache(workspace, cacheTag, CACHE_DIR_FROM, cacheFlags);

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
        cacheMode,
        cacheDirFrom: CACHE_DIR_FROM,
        cacheDirTo: CACHE_DIR_TO
      });
    }

    const { imageId, digest } = readMetadata();
    core.setOutput('image-id', imageId);
    core.setOutput('digest', digest);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

run();
