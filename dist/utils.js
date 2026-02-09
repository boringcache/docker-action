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
exports.METADATA_FILE = exports.CACHE_DIR = exports.ensureBoringCache = void 0;
exports.parseBoolean = parseBoolean;
exports.parseList = parseList;
exports.parseMultiline = parseMultiline;
exports.slugify = slugify;
exports.ensureDir = ensureDir;
exports.computeDockerfileHash = computeDockerfileHash;
exports.getWorkspace = getWorkspace;
exports.execBoringCache = execBoringCache;
exports.wasCacheHit = wasCacheHit;
exports.restoreCache = restoreCache;
exports.saveCache = saveCache;
exports.setupQemuIfNeeded = setupQemuIfNeeded;
exports.setupBuildxBuilder = setupBuildxBuilder;
exports.getBuilderPlatforms = getBuilderPlatforms;
exports.buildDockerImage = buildDockerImage;
exports.readMetadata = readMetadata;
const core = __importStar(require("@actions/core"));
const exec = __importStar(require("@actions/exec"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const crypto = __importStar(require("crypto"));
const action_core_1 = require("@boringcache/action-core");
Object.defineProperty(exports, "ensureBoringCache", { enumerable: true, get: function () { return action_core_1.ensureBoringCache; } });
exports.CACHE_DIR = path.join(os.tmpdir(), 'buildkit-cache');
exports.METADATA_FILE = path.join(os.tmpdir(), 'docker-metadata.json');
let lastOutput = '';
function parseBoolean(value, defaultValue = false) {
    if (value === undefined || value === null || value === '')
        return defaultValue;
    return String(value).trim().toLowerCase() === 'true';
}
function parseList(input, separator = ',') {
    return input
        .split(separator)
        .map(item => item.trim())
        .filter(item => item.length > 0);
}
function parseMultiline(input) {
    return input
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
}
function slugify(value) {
    return value.replace(/[^a-zA-Z0-9]/g, '-');
}
function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}
function computeDockerfileHash(dockerfilePath) {
    if (!fs.existsSync(dockerfilePath)) {
        return '';
    }
    const content = fs.readFileSync(dockerfilePath);
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}
function getWorkspace(inputWorkspace) {
    let workspace = inputWorkspace || process.env.BORINGCACHE_DEFAULT_WORKSPACE || '';
    if (!workspace) {
        core.setFailed('Workspace is required. Set workspace input or BORINGCACHE_DEFAULT_WORKSPACE env var.');
        throw new Error('Workspace required');
    }
    if (!workspace.includes('/')) {
        workspace = `default/${workspace}`;
    }
    return workspace;
}
async function execBoringCache(args) {
    lastOutput = '';
    let output = '';
    const code = await (0, action_core_1.execBoringCache)(args, {
        silent: true,
        listeners: {
            stdout: (data) => {
                const text = data.toString();
                output += text;
                process.stdout.write(text);
            },
            stderr: (data) => {
                const text = data.toString();
                output += text;
                process.stderr.write(text);
            }
        }
    });
    lastOutput = output;
    return code;
}
function wasCacheHit(exitCode) {
    if (exitCode !== 0) {
        return false;
    }
    if (!lastOutput) {
        return true;
    }
    const missPatterns = [/Cache miss/i, /No cache entries/i, /Found 0\//i];
    return !missPatterns.some(pattern => pattern.test(lastOutput));
}
async function restoreCache(workspace, cacheKey, cacheDir, flags = {}) {
    if (!process.env.BORINGCACHE_API_TOKEN) {
        core.notice('Skipping cache restore (BORINGCACHE_API_TOKEN not set)');
        return false;
    }
    const args = ['restore', workspace, `${cacheKey}:${cacheDir}`];
    if (flags.verbose) {
        args.push('--verbose');
    }
    const result = await execBoringCache(args);
    if (wasCacheHit(result)) {
        return true;
    }
    core.info('Cache miss');
    return false;
}
async function saveCache(workspace, cacheKey, cacheDir, flags = {}) {
    if (!process.env.BORINGCACHE_API_TOKEN) {
        core.notice('Skipping cache save (BORINGCACHE_API_TOKEN not set)');
        return;
    }
    if (!fs.existsSync(cacheDir) || fs.readdirSync(cacheDir).length === 0) {
        core.notice('No cache files to save');
        return;
    }
    const args = ['save', workspace, `${cacheKey}:${cacheDir}`, '--force'];
    if (flags.verbose) {
        args.push('--verbose');
    }
    if (flags.exclude) {
        args.push('--exclude', flags.exclude);
    }
    await execBoringCache(args);
    core.info('Cache saved');
}
async function setupQemuIfNeeded(platforms) {
    if (!platforms)
        return;
    const result = await exec.exec('docker', ['run', '--privileged', '--rm', 'tonistiigi/binfmt', '--install', 'all'], { ignoreReturnCode: true });
    if (result !== 0) {
        throw new Error(`Failed to set up QEMU for multi-platform builds (exit ${result})`);
    }
}
async function setupBuildxBuilder(driver, driverOpts, buildkitdConfigInline) {
    const builderName = 'boringcache-builder';
    core.saveState('builderName', builderName);
    let driverToUse = driver || 'docker-container';
    if (driverToUse === 'docker') {
        core.warning('Buildx driver "docker" does not support cache export; falling back to "docker-container".');
        driverToUse = 'docker-container';
    }
    let configPath = '';
    if (buildkitdConfigInline && buildkitdConfigInline.trim().length > 0) {
        configPath = path.join(os.tmpdir(), `buildkitd-${Date.now()}.toml`);
        fs.writeFileSync(configPath, buildkitdConfigInline);
    }
    const inspectResult = await exec.exec('docker', ['buildx', 'inspect', builderName], {
        ignoreReturnCode: true,
        silent: true
    });
    if (inspectResult === 0) {
        await exec.exec('docker', ['buildx', 'use', builderName]);
        return builderName;
    }
    const args = ['buildx', 'create', '--name', builderName, '--driver', driverToUse];
    driverOpts.forEach(opt => {
        args.push('--driver-opt', opt);
    });
    if (configPath) {
        args.push('--config', configPath);
    }
    args.push('--use');
    const createResult = await exec.exec('docker', args, { ignoreReturnCode: true });
    if (createResult !== 0) {
        throw new Error(`Failed to create buildx builder (exit ${createResult})`);
    }
    return builderName;
}
async function getBuilderPlatforms(builderName) {
    let output = '';
    const result = await exec.exec('docker', ['buildx', 'inspect', builderName], {
        ignoreReturnCode: true,
        silent: true,
        listeners: {
            stdout: (data) => {
                output += data.toString();
            }
        }
    });
    if (result !== 0)
        return '';
    const match = output.split('\n').find(line => line.trim().startsWith('Platforms:'));
    if (!match)
        return '';
    return match.replace('Platforms:', '').trim();
}
async function buildDockerImage(opts) {
    const args = [
        'buildx',
        'build',
        '--builder',
        opts.builder,
        '-f',
        opts.dockerfile
    ];
    opts.tags.forEach(tag => {
        args.push('-t', `${opts.image}:${tag}`);
    });
    opts.buildArgs.forEach(arg => {
        args.push('--build-arg', arg);
    });
    opts.secrets.forEach(secret => {
        args.push('--secret', secret);
    });
    if (opts.target) {
        args.push('--target', opts.target);
    }
    if (opts.platforms) {
        args.push('--platform', opts.platforms);
    }
    if (opts.push) {
        args.push('--push');
    }
    if (opts.load) {
        args.push('--load');
    }
    if (opts.noCache) {
        args.push('--no-cache');
    }
    args.push('--cache-from', `type=local,src=${opts.cacheDir}`);
    args.push('--cache-to', `type=local,dest=${opts.cacheDir},mode=${opts.cacheMode}`);
    args.push('--metadata-file', exports.METADATA_FILE);
    args.push('.');
    const result = await exec.exec('docker', args, {
        cwd: opts.context,
        env: {
            ...process.env,
            DOCKER_BUILDKIT: '1'
        }
    });
    if (result !== 0) {
        throw new Error(`docker buildx build failed with exit code ${result}`);
    }
}
function readMetadata() {
    if (!fs.existsSync(exports.METADATA_FILE)) {
        return { imageId: '', digest: '' };
    }
    try {
        const data = JSON.parse(fs.readFileSync(exports.METADATA_FILE, 'utf8'));
        return {
            imageId: data['containerimage.config.digest'] || '',
            digest: data['containerimage.digest'] || ''
        };
    }
    catch (err) {
        core.warning(`Failed to parse metadata file: ${err.message}`);
        return { imageId: '', digest: '' };
    }
}
