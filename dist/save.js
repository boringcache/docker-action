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
const path = __importStar(require("path"));
const utils_1 = require("./utils");
async function run() {
    try {
        const workspace = core.getState('workspace');
        const cacheDir = core.getState('cacheDir');
        const cacheTag = core.getState('cacheTag');
        const verbose = core.getState('verbose') === 'true';
        const exclude = core.getState('exclude') || '';
        if (!workspace || !cacheDir || !cacheTag) {
            core.notice('Cache save skipped because required state is missing');
            return;
        }
        const cacheFlags = { verbose, exclude };
        // Re-add expected PATH entries in case the post phase lost them
        const homedir = os.homedir();
        core.addPath(path.join(homedir, '.local', 'bin'));
        core.addPath(path.join(homedir, '.boringcache', 'bin'));
        await (0, utils_1.saveCache)(workspace, cacheTag, cacheDir, cacheFlags);
        core.info('Save to BoringCache complete');
    }
    catch (error) {
        if (error instanceof Error) {
            core.warning(`Save failed: ${error.message}`);
        }
    }
}
run();
