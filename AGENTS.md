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

Default mode (`cache-backend: registry`):
1. **Restore phase**: Starts a local OCI registry proxy (`boringcache serve`) for lazy layer resolution
2. **Build**: Runs `docker buildx build` with `--cache-from type=registry,ref=127.0.0.1:5000/<tag>` and `--cache-to type=registry,ref=127.0.0.1:5000/<tag>,mode=max`
3. **Save phase**: Stops the registry proxy (writes happen during build via proxy)

Local mode (`cache-backend: local`):
1. **Restore phase**: Downloads all cache blobs from BoringCache to local dir
2. **Build**: Runs `docker buildx build` with `type=local` cache flags
3. **Save phase**: Uploads updated cache blobs to BoringCache

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
| `image-id` | Image ID of the built image |
| `digest` | Image digest |
| `buildx-name` | Name of the buildx builder instance |
| `buildx-platforms` | Available platforms for the builder |

## Separate Actions

For advanced control (uses registry proxy by default):
```yaml
- uses: boringcache/docker/restore@v1
  id: cache
  with:
    workspace: my-org/my-project

- run: |
    docker buildx build \
      --cache-from ${{ steps.cache.outputs.cache-from }} \
      --cache-to ${{ steps.cache.outputs.cache-to }} \
      --load -t my-app:latest .

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
