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
| `ARCHIVE_MIRROR_STATUS_URL` | _(unset)_ | Optional, runtime. URL of the archive mirror's `status.json`, with `rebuild-status.json` beside it (both written by `archive-mirror.sh` in the chain repo and published by the mirror's operator). When set, `/status` shows an archive mirror card. |
| `SITE_URL` | _(unset)_ | Optional, runtime. This site's own public address. When set, `/status` checks its TLS certificate alongside those of the chain's API, the RPC and the explorer. |
| `PEER_CHAINS` | _(unset)_ | Optional, runtime, set by the launcher. JSON object of the chains this one relays with, `{"<chain id>": "<REST API URL>"}`. The federation register form reads a peer's identity from it, and `/status` reads the relayer's account and the chain's height on the peer's side. |
| `LCD_ENDPOINT` / `RPC_ENDPOINT` | _(unset)_ | Runtime overrides of the `NEXT_PUBLIC_*` endpoints, no rebuild needed. |
| `ZK_ASSETS_URL` | `/zk` | Where the anonymous prover lives: one directory per chain release, `<ZK_ASSETS_URL>/<version>/`. See [Anonymous prover](#anonymous-prover). |
| `ZK_VERSION` | _(unset)_ | Prover release to load. Unset, the node's `application_version` picks it, so a chain upgrade needs only the new directory published. |
| `ZK_DIGESTS` | _(unset)_ | Pinned sha256 of each prover file, as JSON: the `files` of that release's `manifest.json`. Unset, the release's `manifest.json` is trusted, which catches a stale or corrupt file but not a tampered directory; set it in production. |
| `CONTENT_SCAN_FEED_URL` | _(unset)_ | Optional. One or more merged scanner feed files (comma or space separated, `https://`). When set, the server reads verdicts from these instead of fetching each worker's own feed. See [Content scanning](#content-scanning). |
| `CONTENT_IMAGES_DISABLED` | _(unset)_ | Set to `true` to stop showing content images altogether: no image in a dream, reply or collection loads, whatever the scanners say. A runtime setting (no rebuild); open pages pick it up within a couple of minutes. Images a reader already loaded stay until they leave the page. Text and links are unaffected. |
| `IMAGE_S3_BUCKET` | _(unset)_ | Bucket for member image uploads. Uploads are on only when this, `IMAGE_PUBLIC_BASE`, `IMAGE_PRECHECK_URL` and `IMAGE_PRECHECK_TOKEN` are all set. Use a bucket of its own (every object in it is public); the snapshot bucket (`S3_BUCKET`) is never used. See [Image uploads](#image-uploads). |
| `IMAGE_S3_ENDPOINT` / `IMAGE_S3_REGION` / `IMAGE_S3_ACCESS_KEY` / `IMAGE_S3_SECRET_KEY` | the `S3_*` values | S3 endpoint, region (`us-west-2` by default) and keys for the image bucket. |
| `IMAGE_PUBLIC_BASE` | _(unset)_ | Public `https://` address the image bucket's objects are served under. The host must allow cross-origin reads. |
| `IMAGE_PRECHECK_URL` / `IMAGE_PRECHECK_TOKEN` | _(unset)_ | A content scanner's pre-check endpoint (`https://<scanner>/precheck`) and the shared token it was started with (`CS_PRECHECK_TOKEN`). An upload is stored only after this scanner calls its bytes clean. |
| `IMAGE_UPLOAD_MAX_BYTES` | `300000` | Largest stored image. The browser shrinks pictures to fit. Keep it at or below the scanner's `CS_PRECHECK_MAX_BYTES`. |
| `IMAGE_COPY_MAX_BYTES` | `4194304` | Largest full-size file kept for a permanent copy to be made from. Keep it at or below the scanner's `CS_PRECHECK_MAX_BYTES` (4 MiB by default) and whatever body size your reverse proxy allows. The chain's own limit per file (10 MiB at launch) applies as well. |
| `ARWEAVE_UPLOADS_DISABLED` | _(unset)_ | Set to `true` to stop this site offering new permanent copies: the composer option and the request form are switched off. A runtime setting (no rebuild). Ordinary uploads, copies already requested and reading existing copies are unaffected. The chain has its own switch (`storage.params.enabled`, by governance). |
| `ARWEAVE_GATEWAY` | `https://arweave.net/{id}` | Where `ar://` images and permanent copies are read from. Keep it the same as the scanners' `CS_ARWEAVE_GATEWAY`. |
| `CONTENT_SCAN_MAX_LAG_BLOCKS` | `1800` | Freshness limit. When the scanners' effective scanned height trails the chain by more than this many blocks, flagged content stays "Being checked" (text keeps working). `0` turns the check off. Workers checkpoint every 600 blocks by default, so keep this well above that. |

## Status page

`/status` shows live checks of what the app depends on, for the environment this build is configured for.

- **Chain.** The public node's REST API and RPC, checked from the visitor's browser: chain id, node name, versions, latest block and its age, syncing, response time. The node is whichever sentry holds the public domains at the moment, and the node name says which; the validators behind it are on their own card. The RPC card also checks the live connection the activity ticker uses: it opens the RPC's websocket, subscribes to new blocks and waits up to 20 seconds for one, once a minute and on "Check again", and is degraded when the connection can't be opened, is closed from the other end, or delivers nothing (the app then falls back to asking every few seconds). It is marked degraded when it is on the wrong chain, still syncing, has produced no block for a minute, or when one endpoint is more than 20 blocks behind the other. The REST API is checked through `/api/lcd`, the way the app reads it.
- **Network and services.** The validator set, chain governance, anonymous actions, certificates, the explorer, content scanners, image uploads, the Arweave gateway, the IBC relayer, federation bridges, permanent copies, the archive mirror, the permanent block archive and the remote snapshot list, checked by this server at `/api/status` and cached for 15 seconds. A service the site doesn't have set up is shown as such, not as a failure. The response names no private address. The validators card reads the active set and its voting power, who signed the last block, each validator's missed blocks (x/slashing) and who is jailed: it is degraded when under 75% of the voting power signed the last block (a block needs more than two thirds), or when a validator has used half of the misses it is allowed before being jailed. How the power is spread (the largest validator, and how few together hold over a third) is shown, not judged. The chain governance card reads x/gov and x/upgrade. It does not repeat the Governance page: it shows how many proposals are in voting or collecting a deposit and any scheduled upgrade, for context, and otherwise speaks only when something needs someone to act. It is degraded when a proposal in the last quarter of its voting period is short of quorum, when a proposal passed its vote but failed on execution within the past week, or when the chain stands at its upgrade height with no new block for two minutes. The anonymous actions card reads x/shield: it is degraded when the chain holds no verification key, when the reserve that pays for anonymous actions is empty or is below its minimum and can't be refilled (today's limit used up, or the community pool short), when the prover files for the chain's version aren't where the browser looks for them (`ZK_ASSETS_URL`, or this site's `public/zk`), or when encrypted batches are switched on without the validators' shared key. The certificates card asks each https host from the site's own settings for its certificate (never an address read from the chain): it is degraded when one has expired, isn't accepted, or has under 14 days left. The permanent block archive card reads the `chain-archiver` operators and their checkpoints from the chain and looks up the newest range's transaction in the gateway's index (`/graphql`): it is degraded when the checkpoint trails the chain by more than the type's `checkpoint_max_lag_blocks` (or, where the chain sets none because archiving is best effort, by more than 34,560 blocks, about two days), or when that transaction is missing, isn't the range the checkpoint claims, or is signed by a wallet the archiver doesn't list. The card also shows the archive worker by what the operator's listed wallets have done on Arweave: the newest range uploaded (which can be one range ahead of the checkpoint, while it gathers confirmations) and the wallets' balance against the price of another range. It is degraded when the wallets can't pay for the next range, or when uploads are two ranges ahead of the checkpoint, which means the worker runs and its checkpoints aren't getting through. It does not download or verify the copy; `archiveworker verify` does. The content scanners card judges the scanners the way a reader's browser does (a quorum of active scanners whose feeds are within `CONTENT_SCAN_MAX_LAG_BLOCKS` of the chain), and also shows their feed hosts, any registered scanner that isn't counted and why, and the age of the newest onchain checkpoint against the type's `checkpoint_max_lag_blocks`. The IBC relayer card covers each active federation peer that names an IBC channel. A relayer has no record on chain, so the card reads what it leaves there, on this chain's side only: it is degraded when a channel isn't open, when the peer's light client is expired or frozen, when the client hasn't been updated for more than two thirds of its trusting period (a running Hermes refreshes it by then), or when packets are waiting and the client hasn't moved for 30 minutes. The relayer's account on this chain is taken from the last transaction that updated the client (found through the node's transaction index, and kept for ten minutes): the card shows its balance in the fee denomination and how many more transactions that pays for at the fee it last paid, and is degraded when it can pay for fewer than 20. From this chain alone the card also catches a peer record that names a replaced connection: a later light client of the same chain that carries open channels on every port the record names, the federation port among them, which is what a peer reset followed by a new connection leaves behind. A single stray channel is not taken as that, since anyone may open one. Where `PEER_CHAINS` gives the peer chain's API, the card reads that side too: the relayer's account there (the signer of the last update of the peer's client of this chain, with its funds in the peer's own denomination) the peer's light client of this chain (the one the connection names as its counterparty, judged by the same rules as the client here: expired, frozen, or not updated for two thirds of its trusting period) and the peer chain's height. A peer whose height is below what this chain's light client has already seen was reset (a reset keeps the chain id and starts a new chain), and the card says the link is dead and a new connection is needed; the client itself still reads active for days after. The same test the other way round catches a reset of this chain: its height well below what the peer's light client has seen of it. Heights are only taken from a node at its chain's tip (a latest block under two minutes old), and a shortfall under 1,000 blocks is ignored, so a node that merely lags another is never read as a reset. The scanner, archiver, storage and bridge cards also show the session key each operator granted its worker (x/session): its expiry, when it was last used, and the share of its fee budget and uses left. A card is degraded when a key has expired or run out, and ahead of that when it expires within three days or has under 5% of its budget or uses left. The chain removes a session in the block it expires, so an expired key reads as no session: the server remembers the expiry of each key it has seen and reports the expiry once it passes, but that memory is lost on a restart, after which the card shows none. A scanner approved for permanent copies needs `MsgFlagRemoved` in its key beside `MsgSubmitCheckpoint`, and the card is degraded when it is missing. The storage worker's key is also checked against the rest of what the worker sends: a key that lacks `MsgExtendClaim`, `MsgCompleteRequest` or `MsgDeclineRequest` degrades the card, and one that lacks `MsgSubmitCheckpoint` is only noted, since an operator may turn check-ins off; the key is shown for an active operator that isn't approved yet. An operator with no session for its worker's messages is otherwise shown as such and not counted as a failure, since a worker may sign with the operator's own key. The archive mirror runs outside the deployment, so its card appears only when `ARCHIVE_MIRROR_STATUS_URL` points at the status documents it publishes: it is degraded when no sync has finished for three hours, when the last sync couldn't fetch blocks or found the vault damaged, when a later sync or rebuild check failed before producing a result (`last_failed_at`), when the last rebuild check failed or didn't match the chain, or when none has finished for three weeks. Only numbers, times and results are shown from those documents, never their free text. The federation bridges card reads x/federation's bridge bindings: a bridge is degraded when its binding is suspended, its x/service operator or its peer is not active, or its last submission is older than the chain's own warning limit (more than `bridge_inactivity_threshold` whole `rate_limit_window`s). Each binding's endpoint (the peer's server, for example a Mastodon instance) is sent a bare `HEAD` and the bridge is degraded when it doesn't answer; since the address is one an operator wrote on chain, only a public https origin is contacted, at the address that was checked so a changed DNS answer can't redirect the request (`src/lib/publicUrl.ts`), and no redirect is followed. For each bridge the card also shows the operator behind it: its x/service status and bond, reports against it that nobody has resolved yet (shown, not counted as a fault), and how many of its posts were verified, rejected and left unverified. A post rejected on verification in the current reward period degrades the bridge. The same card covers the verifiers of what the bridges bring in, the holders of x/rep's bonded federation-verifier role: how many are in good standing, how many posts they have verified, how many bridged posts wait for one, and the session key each granted its daemon for `MsgVerifyContent`. It is degraded when no verifier may verify (normal, recovery, or unbonding while the bond that stays covers the role's minimum), when every verifier that may is locked out by the overturn cooldown (x/rep's `role_activity`, shown as its own row with the time the first is free), or when a post has waited more than an hour, since a verifier's daemon polls about every minute. A quiet peer gives a bridge nothing to submit, so short of that limit the card cannot tell whether a daemon is running. The permanent copies card reads x/storage and x/service: it is degraded when no storage operator is both active and approved for the backend, when fewer content scanners are approved for storage than the scanner quorum (the chain then refuses image requests), when the operators' Arweave wallets are empty or can't pay for a copy of the largest file the backend takes (the funds row says how many such copies the balance covers, and already shows for an active operator that isn't approved yet), or when `ARWEAVE_UPLOADS_DISABLED` is set. The storage worker checkpoints on chain to say it is running (every 600 blocks by default): the card shows how long ago the newest one was, and is degraded when it is older than the type's `checkpoint_max_lag_blocks`, or 1,800 blocks when the type sets none, or when its root names an Arweave wallet the operator doesn't list. For a worker that has never checkpointed, the card falls back on what else the chain holds: how many blocks ago a ready operator last claimed or completed a request, how long the oldest request has waited, and claims left to lapse. It is degraded on a lapsed claim, and, only when no checkpoint exists, when a request has waited more than `claim_window_blocks` with no operator acting since it opened, which may be a stopped worker or a file it can't fetch or that isn't cleared.

The app has no node failover of its own: the launcher moves the public domains to a standby sentry when the serving one fails, and the app follows them.

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

## Image uploads

Members can attach a picture to a dream by uploading it instead of linking to one hosted elsewhere. Linking stays available to everyone.

- **Who.** Active members, signing with their own wallet (not a session key). The wallet signs a plain-text permission once per browser session; it is not a transaction.
- **How much.** New images per week by trust level: New 3, Provisional 5, Established 10, Trusted 20, Core 40 (`src/lib/imageUpload/policy.ts`).
- **What is stored.** The browser shrinks the picture to at most 1600 px and re-encodes it as a still WebP under `IMAGE_UPLOAD_MAX_BYTES`, which also drops its metadata. The server accepts only still WebP, JPEG or PNG within the limits.
- **Scanner first.** The server sends the bytes to `IMAGE_PRECHECK_URL` and stores them only on a `clean` answer. That is the site's own gate; readers still see the image only once the scanners' signed verdicts clear it, like any linked image.
- **Where.** `img/<sha256>.<ext>` in the image bucket, so the same picture is stored once and its address doesn't name the uploader. Empty `quota/<week>/<keyed hash of the address>/<sha256>` markers count each member's uploads.
- **Permanent copies.** On a chain with x/storage, a member can tick "Keep a permanent copy" while uploading, or use the Permanent copies page (`/storage`) and its "Upload it to this site" button. Either way:
  - The copy is made from the picture at its full size, not from the small image a dream shows. The browser prepares it for the chain's storage profile: a PNG or JPEG with no metadata, no colour profile and no transparency (`src/lib/fileProfile.ts`, `src/lib/imagePrepare.ts`). It is made smaller only when it is over `IMAGE_COPY_MAX_BYTES` or the storage network's limit.
  - That file goes to the image bucket as `src/<sha256>.<ext>`, after the same scanner pre-check, and stays only until the copy is made (see Cleanup). It is counted in a weekly allowance of its own, the same size as the one for images (`srcquota/` markers).
  - In the composer the dream's own image is uploaded as usual (a small WebP), so the dream shows it straight away and loads quickly.
  - The member then signs `MsgRequestPermanentCopy` with their own wallet, naming the full-size file's bucket address as the place to fetch it from. The fee is the chain's quote, which grows with the file's size; nothing is paid to this site.
  - A bonded storage operator approved on chain fetches the file and makes the copy in the background. This site holds no storage-network key and makes no copy itself.
  - It is not offered for anonymous dreams, since the request names its requester on chain.
  - If an image ever stops loading, readers are shown its permanent copy instead, found on chain by the image's hash and checked against that same hash. Any frontend does this, whichever site first stored the image. This applies when the dream links the very file that was copied. A dream written in the composer shows the small image, whose hash is not the full-size copy's, so it has no such fallback.
- **Cleanup.** `npm run images:gc` lists images that were uploaded but never published (older than 48 hours), images a scanner has removed, full-size files that no open permanent-copy request needs any more, and old quota markers; add `-- --delete` to remove them. It needs `IMAGE_GC_FEED_URL` (the scanners' feed roots), and `LCD_ENDPOINT` so that an image an open permanent-copy request still needs is kept. Images of dreams that later expire or are deleted are not cleaned up yet.

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
