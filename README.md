# boringcache/docker-action

**Cache once. Reuse everywhere.**

BoringCache is a universal build artifact cache for CI, Docker, and local development. It stores and restores directories you choose so build outputs, dependencies, and tool caches can be reused across environments.

BoringCache does not run builds and is not tied to any build tool. It works with any language, framework, or workflow by caching directories explicitly selected by the user.

Caches are content-addressed and verified before restore. If identical content already exists, uploads are skipped. The same cache can be reused in GitHub Actions, Docker/BuildKit, and on developer machines using the same CLI.

This action caches BuildKit layer caches (the directories used by `docker buildx`). It does not cache Docker images unless you push them. Caches can be reused outside Docker builds.

## Quick start

```yaml
- uses: boringcache/docker-action@v1
  with:
    workspace: my-org/my-project
    image: my-app
  env:
    BORINGCACHE_API_TOKEN: ${{ secrets.BORINGCACHE_API_TOKEN }}
```

Cache is automatically restored before build and saved after.

## Mental model

By default, this action runs a local OCI registry proxy (`boringcache serve`) that BuildKit talks to via `type=registry` cache flags. Layers are fetched lazily on cache hit and pushed through the proxy during the build — no bulk restore/save steps needed.

You still control your Dockerfile, build args, and image tags.

Notes:
- If `platforms` is set, QEMU is installed via `tonistiigi/binfmt`.
- A `boringcache-builder` (docker-container driver with `network=host`) is created for cache export/import.
- Set `cache-backend: local` to fall back to the older bulk restore/save flow with `type=local` cache flags.
- For direct `buildctl` usage, use `boringcache/buildkit-action` instead.

## Common patterns

### Simple Docker build

```yaml
- uses: boringcache/docker-action@v1
  with:
    workspace: my-org/my-project
    image: ghcr.io/${{ github.repository }}
    tags: latest,${{ github.sha }}
  env:
    BORINGCACHE_API_TOKEN: ${{ secrets.BORINGCACHE_API_TOKEN }}
```

### Separate restore/save actions (advanced)

```yaml
- uses: boringcache/docker-action/restore@v1
  id: cache
  with:
    workspace: my-org/my-project

- name: Build with docker buildx
  run: |
    docker buildx build \
      --cache-from ${{ steps.cache.outputs.cache-from }} \
      --cache-to ${{ steps.cache.outputs.cache-to }} \
      --load \
      -t my-app:latest .

- uses: boringcache/docker-action/save@v1
  with:
    workspace: my-org/my-project
    cache-tag: ${{ steps.cache.outputs.cache-tag }}
```

### Push to registry

```yaml
- uses: docker/login-action@v3
  with:
    registry: ghcr.io
    username: ${{ github.actor }}
    password: ${{ secrets.GITHUB_TOKEN }}

- uses: boringcache/docker-action@v1
  with:
    workspace: my-org/my-project
    image: ghcr.io/${{ github.repository }}
    tags: latest,${{ github.sha }}
    push: 'true'
    load: 'false'
  env:
    BORINGCACHE_API_TOKEN: ${{ secrets.BORINGCACHE_API_TOKEN }}
```

### Multi-platform build

```yaml
- uses: boringcache/docker-action@v1
  with:
    workspace: my-org/my-project
    image: ghcr.io/${{ github.repository }}
    platforms: linux/amd64,linux/arm64
    push: 'true'
    load: 'false'
  env:
    BORINGCACHE_API_TOKEN: ${{ secrets.BORINGCACHE_API_TOKEN }}
```

### Advanced pattern: Shared bundle cache (runner + Dockerfile)

This pattern shows how to reuse the same cache across the GitHub Actions runner and a Docker image build.

```yaml
name: Docker Build (Shared Bundle Cache)

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-22.04
    env:
      BORINGCACHE_API_TOKEN: ${{ secrets.BORINGCACHE_API_TOKEN }}
      BORINGCACHE_WORKSPACE: my-org/my-project
      BUNDLE_TAG: bundle
      APP_DIR: action/examples/rails_app

    steps:
      - uses: actions/checkout@v4

      # Atomic cache on the runner (same tag reused in the Dockerfile)
      - uses: boringcache/action@v1
        with:
          workspace: ${{ env.BORINGCACHE_WORKSPACE }}
          entries: ${{ env.BUNDLE_TAG }}:${{ env.APP_DIR }}/vendor/bundle

      - run: |
          bundle config set path vendor/bundle
          bundle install
        working-directory: ${{ env.APP_DIR }}

      # Whole-image cache + BuildKit layer cache (BoringCache-backed)
      - uses: boringcache/docker-action@v1
        with:
          workspace: ${{ env.BORINGCACHE_WORKSPACE }}
          image: ghcr.io/${{ github.repository }}
          tags: latest,${{ github.sha }}
          dockerfile: ${{ github.workspace }}/docker/examples/Dockerfile.shared-bundle-cache
          context: ${{ env.APP_DIR }}
          build-args: |
            BORINGCACHE_WORKSPACE=${{ env.BORINGCACHE_WORKSPACE }}
            BUNDLE_TAG=${{ env.BUNDLE_TAG }}
          secrets: |
            id=boringcache_token,env=BORINGCACHE_API_TOKEN
```

```Dockerfile
# syntax=docker/dockerfile:1.5
FROM ruby:3.3-jammy

ARG BORINGCACHE_WORKSPACE
ARG BUNDLE_TAG=bundle

WORKDIR /app
# Expects Gemfile/Gemfile.lock in the build context root.
COPY Gemfile Gemfile.lock ./

RUN --mount=type=secret,id=boringcache_token \
  export BORINGCACHE_API_TOKEN="$(cat /run/secrets/boringcache_token)" && \
  curl -sSL https://install.boringcache.com/install.sh | sh && \
  boringcache restore "$BORINGCACHE_WORKSPACE" "${BUNDLE_TAG}:/usr/local/bundle" || true && \
  bundle config set path /usr/local/bundle && \
  bundle install && \
  boringcache save "$BORINGCACHE_WORKSPACE" "${BUNDLE_TAG}:/usr/local/bundle"

COPY . .
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `image` | Yes | - | Image name (e.g., `my-app` or `ghcr.io/org/app`). |
| `workspace` | No | repo name | Workspace in `org/repo` form. Defaults to `BORINGCACHE_DEFAULT_WORKSPACE` or repo name. |
| `context` | No | `.` | Build context path. |
| `dockerfile` | No | `Dockerfile` | Dockerfile path. |
| `tags` | No | `latest` | Image tags (comma-separated). |
| `build-args` | No | - | Build arguments (newline-separated). |
| `secrets` | No | - | Build secrets (newline-separated). |
| `target` | No | - | Target build stage. |
| `platforms` | No | - | Target platforms (enables QEMU). |
| `push` | No | `false` | Push to registry. |
| `load` | No | `true` | Load into local daemon. Ignored when `platforms` is set. |
| `no-cache` | No | `false` | Build without cache. |
| `cache-mode` | No | `max` | BuildKit cache mode (`min` or `max`). |
| `cache-tag` | No | slugified image name | Cache tag for BoringCache. |
| `cli-version` | No | `v1.0.2` | BoringCache CLI version. Set to `skip` to disable installation. |
| `buildx-version` | No | - | Buildx version to use (e.g., `v0.12.0`, `latest`). |
| `driver` | No | `docker-container` | Buildx driver. |
| `driver-opts` | No | - | Driver options (newline-separated). |
| `buildkitd-config-inline` | No | - | Inline BuildKit daemon config (TOML). |
| `cache-backend` | No | `registry` | Cache backend: `registry` (lazy proxy) or `local` (bulk restore/save). |
| `proxy-port` | No | `5000` | Port for the BoringCache registry proxy. |
| `verbose` | No | `false` | Enable verbose CLI output. |
| `exclude` | No | - | Glob pattern to exclude files from cache. |

## Outputs

| Output | Description |
|--------|-------------|
| `image-id` | Image ID |
| `digest` | Image digest |
| `buildx-name` | Name of the buildx builder |
| `buildx-platforms` | Available platforms |

## Platform behavior

Platform scoping is what makes it safe to reuse caches across machines.

By default, caches are isolated by OS and architecture. For multi-platform builds, QEMU is installed automatically when `platforms` is set.

## Environment variables

| Variable | Description |
|----------|-------------|
| `BORINGCACHE_API_TOKEN` | API token for BoringCache authentication |
| `BORINGCACHE_DEFAULT_WORKSPACE` | Default workspace if not specified in inputs |

## Troubleshooting

- Cache not restored: ensure `BORINGCACHE_API_TOKEN` is set and the workspace exists.
- No cache files to save: the BuildKit cache directory may be empty on the first run.
- Multi-platform build errors: verify the runner supports QEMU and use `push: true` instead of `load`.

## Release notes

See https://github.com/boringcache/docker-action/releases.

## License

MIT
