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
const path = __importStar(require("path"));
const utils_1 = require("./utils");
async function run() {
    try {
        const context = path.resolve(process.cwd(), core.getInput('context') || '.');
        const dockerfile = core.getInput('dockerfile') || 'Dockerfile';
        const image = core.getInput('image', { required: true });
        const tags = (0, utils_1.parseList)(core.getInput('tags') || 'latest');
        const buildArgs = (0, utils_1.parseMultiline)(core.getInput('build-args') || '');
        const secrets = (0, utils_1.parseMultiline)(core.getInput('secrets') || '');
        const target = core.getInput('target') || '';
        const platforms = core.getInput('platforms') || '';
        const push = (0, utils_1.parseBoolean)(core.getInput('push'), false);
        const load = (0, utils_1.parseBoolean)(core.getInput('load'), true) && !platforms;
        const noCache = (0, utils_1.parseBoolean)(core.getInput('no-cache'), false);
        const cacheMode = core.getInput('cache-mode') || 'max';
        const cliVersion = core.getInput('cli-version') || '';
        const driver = core.getInput('driver') || 'docker-container';
        const driverOpts = (0, utils_1.parseMultiline)(core.getInput('driver-opts') || '');
        const buildkitdConfigInline = core.getInput('buildkitd-config-inline') || '';
        const workspace = (0, utils_1.getWorkspace)(core.getInput('workspace') || '');
        const verbose = (0, utils_1.parseBoolean)(core.getInput('verbose'), false);
        const exclude = core.getInput('exclude') || '';
        const cacheBackend = core.getInput('cache-backend') || 'registry';
        const proxyPort = parseInt(core.getInput('proxy-port') || '5000', 10);
        const cacheTag = core.getInput('cache-tag') || (0, utils_1.slugify)(image);
        const cacheFlags = { verbose, exclude };
        const useRegistryProxy = cacheBackend !== 'local';
        core.saveState('workspace', workspace);
        core.saveState('cacheTag', cacheTag);
        core.saveState('verbose', verbose.toString());
        core.saveState('exclude', exclude);
        if (cliVersion.toLowerCase() !== 'skip') {
            await (0, utils_1.ensureBoringCache)({ version: cliVersion || 'v1.0.0' });
        }
        const builderName = await (0, utils_1.setupBuildxBuilder)(driver, driverOpts, buildkitdConfigInline, useRegistryProxy);
        core.setOutput('buildx-name', builderName);
        core.setOutput('buildx-platforms', await (0, utils_1.getBuilderPlatforms)(builderName));
        await (0, utils_1.setupQemuIfNeeded)(platforms);
        if (useRegistryProxy) {
            const proxyPid = await (0, utils_1.startRegistryProxy)(workspace, proxyPort, verbose);
            await (0, utils_1.waitForProxy)(proxyPort, 20000, proxyPid);
            core.saveState('proxyPid', String(proxyPid));
            const ref = (0, utils_1.getRegistryRef)(proxyPort, cacheTag);
            await (0, utils_1.buildDockerImage)({
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
                cacheFrom: `type=registry,ref=${ref}`,
                cacheTo: `type=registry,ref=${ref},mode=${cacheMode}`
            });
        }
        else {
            (0, utils_1.ensureDir)(utils_1.CACHE_DIR_FROM);
            (0, utils_1.ensureDir)(utils_1.CACHE_DIR_TO);
            core.saveState('cacheDir', utils_1.CACHE_DIR_TO);
            await (0, utils_1.restoreCache)(workspace, cacheTag, utils_1.CACHE_DIR_FROM, cacheFlags);
            await (0, utils_1.buildDockerImage)({
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
                cacheDirFrom: utils_1.CACHE_DIR_FROM,
                cacheDirTo: utils_1.CACHE_DIR_TO
            });
        }
        const { imageId, digest } = (0, utils_1.readMetadata)();
        core.setOutput('image-id', imageId);
        core.setOutput('digest', digest);
    }
    catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message);
        }
    }
}
run();
