"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const utils_1 = require("./utils");
async function run() {
    try {
        const workspace = (0, utils_1.getWorkspace)(core.getInput('workspace', { required: true }));
        const cacheDir = core.getInput('cache-dir') || utils_1.CACHE_DIR;
        const cliVersion = core.getInput('cli-version') || 'v1.0.0';
        const verbose = (0, utils_1.parseBoolean)(core.getInput('verbose'), false);
        const exclude = core.getInput('exclude') || '';
        const cacheBackend = core.getInput('cache-backend') || 'registry';
        const proxyPort = parseInt(core.getInput('proxy-port') || '5000', 10);
        const cacheMode = core.getInput('cache-mode') || 'max';
        const image = core.getInput('image') || '';
        const cacheTag = core.getInput('cache-tag') || (image ? (0, utils_1.slugify)(image) : 'docker');
        const cacheFlags = { verbose, exclude };
        const useRegistryProxy = cacheBackend !== 'local';
        if (cliVersion.toLowerCase() !== 'skip') {
            await (0, utils_1.ensureBoringCache)({ version: cliVersion });
        }
        core.saveState('workspace', workspace);
        core.saveState('cacheTag', cacheTag);
        core.saveState('verbose', verbose.toString());
        core.saveState('exclude', exclude);
        if (useRegistryProxy) {
            const proxyPid = await (0, utils_1.startRegistryProxy)(workspace, proxyPort, verbose);
            await (0, utils_1.waitForProxy)(proxyPort, 20000, proxyPid);
            core.saveState('proxyPid', String(proxyPid));
            const ref = (0, utils_1.getRegistryRef)(proxyPort, cacheTag);
            const registryCache = (0, utils_1.getRegistryCacheFlags)(ref, cacheMode);
            const cacheFrom = registryCache.cacheFrom;
            const cacheTo = registryCache.cacheTo;
            core.setOutput('cache-tag', cacheTag);
            core.setOutput('registry-ref', ref);
            core.setOutput('cache-from', cacheFrom);
            core.setOutput('cache-to', cacheTo);
            core.setOutput('cache-dir', '');
            core.setOutput('save-cache-dir', '');
            core.notice(`Registry proxy started (ref: ${ref})`);
        }
        else {
            const saveCacheDir = `${cacheDir}-to`;
            (0, utils_1.ensureDir)(cacheDir);
            (0, utils_1.ensureDir)(saveCacheDir);
            core.saveState('cacheDir', saveCacheDir);
            await (0, utils_1.restoreCache)(workspace, cacheTag, cacheDir, cacheFlags);
            core.setOutput('cache-tag', cacheTag);
            core.setOutput('cache-dir', cacheDir);
            core.setOutput('save-cache-dir', saveCacheDir);
            core.setOutput('cache-from', `type=local,src=${cacheDir}`);
            core.setOutput('cache-to', `type=local,dest=${saveCacheDir},mode=${cacheMode}`);
            core.setOutput('registry-ref', '');
        }
    }
    catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message);
        }
    }
}
run();
