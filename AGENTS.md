# BoringCache Docker

## What It Does

Builds Docker images with BuildKit and caches build layers via BoringCache. Handles buildx setup, multi-platform builds, and layer caching automatically.

## Quick Reference

```yaml
- uses: boringcache/docker@v1
  with:
    workspace: my-org/my-project
    image: ghcr.io/org/app
    tags: latest,v1.0.0
  env:
    BORINGCACHE_API_TOKEN: ${{ secrets.BORINGCACHE_API_TOKEN }}
```

## How It Works

1. **Restore phase**: Downloads BuildKit layer cache from BoringCache
2. **Build**: Runs `docker buildx build` with `--cache-from` and `--cache-to` pointing to local cache dir
3. **Save phase**: Uploads layer cache to BoringCache

## Key Features

- Uses buildx with docker-container driver for cache export
- Installs QEMU via `tonistiigi/binfmt` for multi-platform builds
- Cache tag defaults to slugified image name (e.g., `ghcr.io/org/app` → `ghcr-io-org-app`)

## Inputs

| Input | Description |
|-------|-------------|
| `workspace` | BoringCache workspace |
| `image` | Image name to build |
| `tags` | Comma-separated tags |
| `dockerfile` | Dockerfile path (default: `Dockerfile`) |
| `context` | Build context (default: `.`) |
| `platforms` | Target platforms (e.g., `linux/amd64,linux/arm64`) |
| `build-args` | Build arguments |
| `cache-tag` | Cache tag (defaults to slugified image name) |

## Outputs

| Output | Description |
|--------|-------------|
| `cache-hit` | `true` if cache was restored |
| `cache-dir` | Path to local cache directory |
| `image-digest` | Built image digest |

## Separate Actions

For advanced control:
```yaml
- uses: boringcache/docker/restore@v1
  id: cache
  with:
    workspace: my-org/my-project

- run: docker buildx build --cache-from=type=local,src=${{ steps.cache.outputs.cache-dir }} ...

- uses: boringcache/docker/save@v1
  with:
    workspace: my-org/my-project
```

## Code Structure

- `lib/restore.ts` - Restore cache, setup buildx
- `lib/save.ts` - Save layer cache
- `lib/utils.ts` - Shared utilities

## Build

```bash
npm install && npm run build && npm test
```

---
**See [../AGENTS.md](../AGENTS.md) for shared conventions.**
