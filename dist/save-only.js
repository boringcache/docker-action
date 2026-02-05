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
const os = __importStar(require("os"));
const utils_1 = require("./utils");
async function run() {
    try {
        // Try to get values from state first (set by restore action), then fall back to inputs
        let workspace = core.getState('workspace') || core.getInput('workspace') || '';
        let cacheTag = core.getState('cacheTag') || core.getInput('cache-tag') || '';
        let cacheDir = core.getState('cacheDir') || core.getInput('cache-dir') || utils_1.CACHE_DIR;
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
            cacheTag = image ? (0, utils_1.slugify)(image) : 'docker';
        }
        // Re-add expected PATH entries in case they were lost
        const homedir = os.homedir();
        core.addPath(`${homedir}/.local/bin`);
        core.addPath(`${homedir}/.boringcache/bin`);
        if (cliVersion.toLowerCase() !== 'skip') {
            await (0, utils_1.ensureBoringCache)({ version: cliVersion });
        }
        await (0, utils_1.saveCache)(workspace, cacheTag, cacheDir);
        core.info('Save to BoringCache complete');
    }
    catch (error) {
        if (error instanceof Error) {
            core.warning(`Save failed: ${error.message}`);
        }
    }
}
run();
