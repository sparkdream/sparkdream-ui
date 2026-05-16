# Spark Dream UI

Next.js frontend for the Spark Dream Cosmos SDK blockchain.

## Development

```bash
npm install
npm run dev
```

## Deployment (Akash)

### Prerequisites

Install a container runtime:

```bash
# Docker
sudo apt-get update && sudo apt-get install -y docker.io
sudo usermod -aG docker $USER
# Log out and back in for group change to take effect

# Or Podman (daemonless alternative)
sudo apt-get install -y podman
```

### Build the image

```bash
docker build -t sparkdreamnft/sparkdream-ui:v1.0.2 .
```

No `--build-arg` flags are needed. Chain endpoints and other configuration are set at runtime via environment variables in the SDL.

### Push to a registry

```bash
docker tag sparkdreamnft/sparkdream-ui:latest <YOUR_REGISTRY>/sparkdream-ui:latest
docker push <YOUR_REGISTRY>/sparkdream-ui:latest
```

### Deploy on Akash

Update the `image:` field in `deploy.sdl.yml` to match your registry image, then configure the chain endpoints in the `env:` section of the SDL:

```yaml
env:
  - NEXT_PUBLIC_CHAIN_ID=sparkdream-test-1
  - NEXT_PUBLIC_LCD_ENDPOINT=https://api-test.sparkdream.io
  - NEXT_PUBLIC_RPC_ENDPOINT=https://rpc-test.sparkdream.io
```

Deploy with:

```bash
akash tx deployment create deploy.sdl.yml --from <your-key> --chain-id akashnet-2 --node <akash-rpc>
```

The SDL is configured with 0.5 CPU, 512Mi RAM, and exposes port 3000 as port 80.

## Environment Variables

All configuration is read at runtime. Set these as environment variables in the SDL or container.

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_CHAIN_ID` | `sparkdream-test-1` | Chain ID |
| `NEXT_PUBLIC_LCD_ENDPOINT` | `https://api-test.sparkdream.io` | LCD REST API |
| `NEXT_PUBLIC_RPC_ENDPOINT` | `https://rpc-test.sparkdream.io` | Tendermint RPC |
| `NEXT_PUBLIC_DENOM` | `uspark` | Base denomination |
| `NEXT_PUBLIC_DISPLAY_DENOM` | `SPARK` | Display denomination |
| `NEXT_PUBLIC_BECH32_PREFIX` | `sprkdrm` | Bech32 address prefix |
| `NEXT_PUBLIC_CHAIN_NAME` | `Spark Dream` | Chain display name |
| `NEXT_PUBLIC_REMOTE_MANIFEST_URL` | _(unset)_ | Optional. URL of `manifests.json` hosted in object storage. When set, the `/archive` picker reads from there instead of the local filesystem — lets you add snapshots after deploy without rebuilding the image. |

## Testnet snapshots

When a testnet resets, you can capture the pre-reset state and serve it read-only under `/archive/<snapshotId>/…` so users can still browse past content. Snapshots are stored under `public/archive/` (gitignored) and optionally uploaded to S3-compatible storage so the deployed frontend can read them without baking the data into the Docker image.

### Capture

Run against a live LCD to dump every queryable resource (posts, collections, forum threads, governance proposals, futarchy markets, validators, names, members, …) into `public/archive/<snapshotId>/`:

```bash
npm run snapshot:capture -- --lcd https://api-test.sparkdream.io --label first-run
```

Flags:

- `--lcd <url>` (required) — the LCD REST endpoint to capture from.
- `--label <slug>` — optional human-friendly suffix on the snapshot id.
- `--resume` — re-run without re-fetching anything already on disk.
- `--force` — overwrite an existing snapshot directory.

The snapshot id is `<chainId>-<YYYYMMDD-HHmm>[-<label>]`. The script appends an entry to `public/archive/manifests.json` and self-prunes any local entries whose directory was deleted manually.

### Upload to object storage

Set your bucket creds in `.env.local` (loaded automatically by the upload/delete scripts):

```bash
S3_ENDPOINT=https://endpoint.4everland.co
S3_BUCKET=my-bucket
S3_ACCESS_KEY=…
S3_SECRET_KEY=…
S3_PUBLIC_BASE=https://my-bucket.example.com   # the bucket's public URL
# S3_REGION=us-west-2                          # optional, defaults to us-west-2
```

Then push a captured snapshot to the bucket:

```bash
npm run snapshot:upload -- --id sparkdream-test-1-20260515-1716-first-run
```

The script:

1. Walks `public/archive/<id>/` and uploads every file in parallel (default concurrency 8 — override with `--concurrency 16`).
2. Flips that entry in the local `manifests.json` to `location: "remote"` with `remoteBase = $S3_PUBLIC_BASE`.
3. Uploads `manifests.json` itself to the bucket root with a 60 s cache.

Set `NEXT_PUBLIC_REMOTE_MANIFEST_URL=$S3_PUBLIC_BASE/manifests.json` in your Akash SDL once. After that, adding a new snapshot to production is just `snapshot:capture` + `snapshot:upload` — no redeploy.

### Delete

Removes a snapshot everywhere it lives — local directory, bucket prefix, manifests.json entry, and the bucket's copy of `manifests.json`:

```bash
npm run snapshot:delete -- --id sparkdream-test-1-20260515-1716-first-run
```

Works on local-only, remote-only, or orphaned-bucket-prefix snapshots. Bucket operations are skipped silently if no S3 creds are configured.
