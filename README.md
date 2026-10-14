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
| `NEXT_PUBLIC_DREAM_DISPLAY_DENOM` | `DREAM` | Display ticker of the internal DREAM token, per-chain like the bond denom. The launcher renders this from the launch spec's `token.dreamDisplayDenom`, the same field it writes into the chain's `x/identity` genesis record. |
| `NEXT_PUBLIC_BECH32_PREFIX` | `sprkdrm` | Bech32 address prefix |
| `NEXT_PUBLIC_CHAIN_NAME` | `Spark Dream` | Chain display name |
| `NEXT_PUBLIC_REMOTE_MANIFEST_URL` | _(unset)_ | Optional. URL of `manifests.json` hosted in object storage. When set, the `/archive` picker reads from there instead of the local filesystem — lets you add snapshots after deploy without rebuilding the image. |
| `LCD_ENDPOINT` / `RPC_ENDPOINT` | _(unset)_ | Runtime overrides of the `NEXT_PUBLIC_*` endpoints, no rebuild needed. |
| `ZK_ASSETS_URL` | `/zk` | Where the anonymous prover lives: one directory per chain release, `<ZK_ASSETS_URL>/<version>/`. See [Anonymous prover](#anonymous-prover). |
| `ZK_VERSION` | _(unset)_ | Prover release to load. Unset, the node's `application_version` picks it, so a chain upgrade needs only the new directory published. |
| `ZK_DIGESTS` | _(unset)_ | Pinned sha256 of each prover file, as JSON: the `files` of that release's `manifest.json`. Unset, the release's `manifest.json` is trusted, which catches a stale or corrupt file but not a tampered directory; set it in production. |
| `CONTENT_SCAN_FEED_URL` | _(unset)_ | Optional. One or more merged scanner feed files (comma or space separated, `https://`). When set, the server reads verdicts from these instead of fetching each worker's own feed. See [Content scanning](#content-scanning). |
| `CONTENT_SCAN_MAX_LAG_BLOCKS` | `1800` | Freshness limit. When the scanners' effective scanned height trails the chain by more than this many blocks, flagged content stays "Being checked" (text keeps working). `0` turns the check off. Workers checkpoint every 600 blocks by default, so keep this well above that. |

## Anonymous prover

Anonymous actions (x/shield) are proved in the browser by `shield.wasm`, the chain's own Go prover, in a Web Worker ([public/zk/shield-worker.js](public/zk/shield-worker.js)). The prover must come from the same chain release as the node: one from another release can derive the proof's public inputs differently, and the chain then rejects every anonymous action with "ZK proof verification failed".

- **Building.** The chain repo's `deploy/scripts/prepare-release.sh` builds each release's prover into `build/zk/<version>/`: `shield.wasm` (stamped with the version), `wasm_exec.js`, the ceremony's `proving_key.raw.bin` and `circuit.r1cs`, and a `manifest.json` with every file's sha256. It also copies it to `public/zk/<version>/` in this checkout when it sits beside the chain repo (`--zk-publish DIR` / `--no-zk-publish` to change that); for a bucket, copy it to `<ZK_ASSETS_URL>/<version>/` yourself. `public/zk/<version>/` is gitignored and baked into the image; only `public/zk/shield-worker.js` is tracked, so don't delete it when clearing old releases.
- **Scope test.** `npm test` checks the client's nullifier scopes (`src/lib/shieldScope.ts`) against vectors the chain generates from its own scope rules for every default op (`x/shield/keeper/testdata/scope_vectors.json`, read from the chain checkout beside this one or `SPARKDREAM_CHAIN_REPO`). A wrong scope makes every proof for that op fail at broadcast as "ZK proof verification failed", so run it after any chain change to x/shield ops.
- **Local chains.** The prover's version must equal the node's, and an `ignite chain build` node reports something like `1.0.52-246bf2b2`. Build a matching prover from the chain repo with `V=$(sparkdreamd version); VERSION=$V tools/zk/wasm/build.sh ../sparkdream-ui/public/zk/$V build/ceremony`.
- **Loading.** The client picks the release (`ZK_VERSION`, else the node's version), checks every file against `ZK_DIGESTS` (else the release's manifest) before running or loading it, and asks the wasm which release it is. If that is not the node's version, anonymous actions are refused with a message saying so, instead of failing at broadcast.
- **Chain upgrades.** Publish the new release's directory before (or with) the upgrade. With `ZK_VERSION`/`ZK_DIGESTS` pinned, update them too; until then anonymous actions are refused.

## Content scanning

The UI applies the chain's content-scanning design (`docs/content-scanning.md` in the chain repo, §6). No filtering proxy sits in the request path: the `/api/lcd` proxy only works around CORS, and it and server-side reads (the RSS feed) skip Next's data cache.

- **Media labels.** The chain labels every blog post, blog reply, forum post and federated record (`media_flags`, `body_hash`) and returns the body as `""` from list and show queries whenever `media_flags != 0`.
- **Trusted workers** are read from the chain: `ACTIVE` operators of the `content-scanner` service type, with the ed25519 verdict key and feed URL in their operator metadata, and the service type's `attestation_quorum` / `elevated_attestation_quorum`.
- **Verdicts.** The Next server fetches the workers' feeds (`manifest.json` plus `segments/*.jsonl`), or the merged files in `CONTENT_SCAN_FEED_URL`, refreshes them every minute and relays the attestations a page needs at `/api/content-scan?record=blog/post/12&uri=…`. The browser verifies every signature itself (WebCrypto Ed25519, against the keys it read from the chain) and combines them: removed if any worker says removed, held if any says held, clean only when a quorum agrees on the same hash, else unchecked. Media by new or provisional members needs the elevated quorum.
- **Display.** Plain text shows at once. A labelled body shows "Being checked" until it is clean, is then fetched through `post_body` / `reply_body` / `post_content` / `federated_content_body`, and is shown only if its sha256 matches. Held content shows a placeholder, removed content "Not available on this site" (and drops out of lists and the RSS feed). Collection item images load only after a clean verdict, on request, from bytes whose hash matches; links stay plain text until clean. Bodies render as plain text, so URLs inside them are never loaded or clickable.
- **No scanners yet.** With no `ACTIVE` content-scanner operators (or `attestation_quorum = 0`), text works as usual and every labelled body and image stays "Being checked", with a line saying no scanners are running. The same happens when verdicts are stale, the relay is unreachable, or the browser lacks Ed25519 (WebCrypto needs a secure context: https or localhost).

The code is in `src/lib/contentScan/` (protocol, worker list, feed index, browser client), `src/hooks/useScannedBody.ts` and `src/components/content/`.

The browser still reads RPC directly (`RPC_ENDPOINT`) for tx broadcast, account and sequence lookups, the new-block ticker and x/shield. Keplr is configured with the same endpoints.

Separately, content that is moderation-hidden onchain (`*_STATUS_HIDDEN`) is concealed from everyone except its author and moderators.

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
