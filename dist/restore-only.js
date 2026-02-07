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
        // Cache tag: user-provided or default to slugified image name
        // BoringCache is content-addressed, so no hash needed in the tag
        const image = core.getInput('image') || '';
        const cacheTag = core.getInput('cache-tag') || (image ? (0, utils_1.slugify)(image) : 'docker');
        const cacheFlags = { verbose, exclude };
        (0, utils_1.ensureDir)(cacheDir);
        if (cliVersion.toLowerCase() !== 'skip') {
            await (0, utils_1.ensureBoringCache)({ version: cliVersion });
        }
        const cacheHit = await (0, utils_1.restoreCache)(workspace, cacheTag, cacheDir, cacheFlags);
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
        }
        else {
            core.notice(`Cache miss (tag: ${cacheTag})`);
        }
    }
    catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message);
        }
    }
}
run();
