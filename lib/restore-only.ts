import * as core from '@actions/core';
import {
  CACHE_DIR,
  slugify,
  ensureDir,
  getWorkspace,
  ensureBoringCache,
  restoreCache,
  startRegistryProxy,
  waitForProxy,
  getRegistryRef,
  getRegistryCacheFlags,
  parseBoolean,
  CacheFlags
} from './utils';

async function run(): Promise<void> {
  try {
    const workspace = getWorkspace(core.getInput('workspace', { required: true }));
    const cacheDir = core.getInput('cache-dir') || CACHE_DIR;
    const cliVersion = core.getInput('cli-version') || 'v1.5.0';
    const registryTag = core.getInput('registry-tag') || '';
    const proxyNoGit = parseBoolean(core.getInput('proxy-no-git'), false);
    const proxyNoPlatform = parseBoolean(core.getInput('proxy-no-platform'), false);
    const verbose = parseBoolean(core.getInput('verbose'), false);
    const exclude = core.getInput('exclude') || '';
    const cacheBackend = core.getInput('cache-backend') || 'registry';
    const proxyPort = parseInt(core.getInput('proxy-port') || '5000', 10);
    const cacheMode = core.getInput('cache-mode') || 'max';

    const image = core.getInput('image') || '';
    const cacheTag = core.getInput('cache-tag') || (image ? slugify(image) : 'docker');

    const cacheFlags: CacheFlags = { verbose, exclude };
    const useRegistryProxy = cacheBackend !== 'local';

    if (cliVersion.toLowerCase() !== 'skip') {
      await ensureBoringCache({ version: cliVersion });
    }

    core.saveState('workspace', workspace);
    core.saveState('cacheTag', cacheTag);
    core.saveState('registryTag', registryTag);
    core.saveState('proxyNoGit', proxyNoGit.toString());
    core.saveState('proxyNoPlatform', proxyNoPlatform.toString());
    core.saveState('verbose', verbose.toString());
    core.saveState('exclude', exclude);

    if (useRegistryProxy) {
      const effectiveTag = registryTag || cacheTag;
      const proxy = await startRegistryProxy({
        command: 'docker-registry',
        workspace,
        tag: effectiveTag,
        host: '127.0.0.1',
        port: proxyPort,
        noGit: proxyNoGit,
        noPlatform: proxyNoPlatform,
        verbose,
      });
      await waitForProxy(proxy.port, 20000, proxy.pid);
      core.saveState('proxyPid', String(proxy.pid));

      const ref = getRegistryRef(proxyPort, cacheTag);
      const registryCache = getRegistryCacheFlags(ref, cacheMode);
      const cacheFrom = registryCache.cacheFrom;
      const cacheTo = registryCache.cacheTo;

      core.setOutput('cache-tag', cacheTag);
      core.setOutput('registry-ref', ref);
      core.setOutput('cache-from', cacheFrom);
      core.setOutput('cache-to', cacheTo);
      core.setOutput('cache-dir', '');
      core.setOutput('save-cache-dir', '');

      core.notice(`Registry proxy started (ref: ${ref})`);
    } else {
      const saveCacheDir = `${cacheDir}-to`;

      ensureDir(cacheDir);
      ensureDir(saveCacheDir);
      core.saveState('cacheDir', saveCacheDir);

      await restoreCache(workspace, cacheTag, cacheDir, cacheFlags);

      core.setOutput('cache-tag', cacheTag);
      core.setOutput('cache-dir', cacheDir);
      core.setOutput('save-cache-dir', saveCacheDir);
      core.setOutput('cache-from', `type=local,src=${cacheDir}`);
      core.setOutput('cache-to', `type=local,dest=${saveCacheDir},mode=${cacheMode}`);
      core.setOutput('registry-ref', '');
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

run();
