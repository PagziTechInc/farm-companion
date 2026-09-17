# Farm Companion VPS deployment

This static site runs in its own `farm-companion` Compose project. The existing host-networked Traefik instance reaches the Nginx container over the dedicated `farm-companion` bridge network and handles HTTPS for `farm.pagzi.tech`. The only host port is the loopback health endpoint at `127.0.0.1:18947`; no public Nginx port is opened.

## Publishing and automatic updates

Run `npm run deploy` for a publish pass and `npm run deploy:status` to inspect it. The local systemd user timer `farm-companion-deploy.timer` checks the stable source every 30 seconds while the workstation is online; inspect its state with `systemctl --user status farm-companion-deploy.timer`.

A publish runs `npm run check` against an isolated source snapshot, uploads only the exact public website allowlist, stages a versioned release, and atomically switches `current`. It then checks the live health endpoint and browser smoke path. A failed health or browser smoke check restores the previous `current` symlink. The deployer retains the newest 30 releases so open tabs can still fetch their version-pinned worker.

Activation intent is saved locally before the SSH switch. If the connection or process stops during activation/verification, the next invocation reconciles that intent and restores the previous release before attempting another publish. Recovery refuses to overwrite a release changed independently on the server. Failed source hashes retry after five minutes; edits to a new hash start a new stability check. The VPS continues serving the last published site while this workstation is offline. Open pages are not force-reloaded; refresh to use the newest UI. Installed browser extensions must be updated separately.

Install or update the local watcher from this workspace:

```sh
mkdir -p ~/.config/systemd/user
cp deployment/farm-companion-deploy.service deployment/farm-companion-deploy.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now farm-companion-deploy.timer
```

The service paths match this workstation and its installed Node 24.19.0; adjust them when moving machines or removing that runtime. User lingering is enabled on this host. Inspect checks in `.local-deploy/logs/`, live screenshots in `.local-deploy/screenshots/`, and service output with `journalctl --user -u farm-companion-deploy.service -n 60`. Pause publishing with `systemctl --user stop farm-companion-deploy.timer`; this does not stop the hosted site.

The watcher publishes application assets and the separately bundled collector runtime. Changes to the Nginx/Compose configuration or server-side `release_ops.py` require explicitly copying those files to `/opt/farm-companion/` and validating them as below before publishing a dependent application change. Never copy the repository or local deployment logs into the public site directory.

## Host layout

Install `compose.yaml` as `/opt/farm-companion/compose.yaml` and `nginx.conf` as `/opt/farm-companion/config/farm.conf`. Create `/opt/farm-companion/site/releases/`. Compose bind-mounts the whole `config` directory read-only, so atomic replacement of `farm.conf` remains visible inside the container. After a config update, check and reload Nginx with:

```sh
docker compose -p farm-companion -f /opt/farm-companion/compose.yaml exec -T nginx nginx -t
docker compose -p farm-companion -f /opt/farm-companion/compose.yaml exec -T nginx nginx -s reload
```

Each published site release lives at `site/releases/{release-id}/`, where the ID matches `YYYYMMDDTHHMMSSZ-` followed by 12 lowercase hexadecimal characters. The `current` symlink points to `releases/{release-id}`. A release contains the public files from `dist/`; its `index.html` must reference `/releases/{release-id}/app.js`. That versioned app URL keeps `new URL('./plan-worker.js', import.meta.url)` pinned to the matching worker. Promote `current` with an atomic symlink rename. Keep each release's `app.js` and `plan-worker.js` available while a page using that release may still be open.

Before the first `current` release is promoted, the root URL and `/build.json` return 404. The container healthcheck becomes healthy once the current release contains `build.json`.

## Serving and headers

Nginx additionally serves the exact `/collection/status.json` and `/collection/plots.json` paths from the collector’s public output directory, with public CORS and revalidation. The catalogue has a JSON download filename. No private collector path is mapped. Nginx otherwise serves only `/`, `/index.html`, `/app.js`, `/plan-worker.js`, the userscript, Chrome ZIP, `build.json`, `ART-CREDITS.txt`, `FONT-LICENSES.txt`, `INSTALL-CHROME.txt`, and `README.txt` from `current`. Under `/releases/{release-id}/`, only `app.js` and `plan-worker.js` are available. All other paths, including `/_headers`, `/source`, and `/portfolio`, return 404; there is no SPA fallback. Root responses require revalidation, while versioned JavaScript is immutable-cached for one year. The ZIP is marked for download.

The security policy carries over the headers generated in `dist/_headers`; HSTS applies to this hostname only. Header declarations stay at server scope so the cache policy cannot shadow the security headers under Nginx 1.28's inheritance rules. JS MIME types use the official image's `mime.types` mapping, and gzip covers JavaScript, JSON and text.

## Deployment verification

The first live release on September 13, 2026 UTC passed 183 application tests, 48 browser tests, 16 deployment tests and 196 knowledge checks. Trusted HTTPS, live content hashes, extension download, image decoding, a model forecast, the active plan worker and mobile layout passed on `farm.pagzi.tech`. Private/source paths returned 404. Per-release logs and browser screenshots are stored locally under `.local-deploy/`.

## References

- [Nginx headers module](https://nginx.org/en/docs/http/ngx_http_headers_module.html)
- [Traefik Docker provider](https://doc.traefik.io/traefik/reference/install-configuration/providers/docker/)
- [Traefik HTTP TLS routing](https://doc.traefik.io/traefik/reference/routing-configuration/http/tls/overview/)
- [Docker Compose services](https://docs.docker.com/reference/compose-file/services/)

## Production asset collector

The `farm-companion-assets` Compose project runs a separate read-only metadata collector without an exposed port. Install `collector-compose.yaml` as `/opt/farm-companion/collector/compose.yaml` and `collector_ops.py` beside it. Its pinned Node image runs as UID/GID 1000 with a read-only root filesystem and bounded resources. The existing Nginx site mount exposes only the two public collection aliases.

Prepare `/opt/farm-companion/collector/runtime/versions` as root-owned mode 0755. Prepare `/opt/farm-companion/collector/data` as UID 1000 mode 0700, its empty `public` mount point as UID 1000 mode 0755, and `/opt/farm-companion/site/collection` as UID 1000 mode 0755. Raw observations, private state and archives remain under the private data mount, outside the web root. Public output files are 0644 so Nginx can read them.

Every validated deploy bundles `dist-collector/collector.mjs`, scans it for private owner addresses, stages it under `runtime/versions/{sha256}/` with its hash manifest, and calls the collector helper before switching the website release. Version files must be root-owned 0644 and version directories 0755 so the unprivileged container can read them. A healthy identical runtime does not restart. Collector activation records durable intent and restores the previous runtime on failed health; data is preserved. The local deploy state tracks an interrupted collector activation and reconciles it before skipping an unchanged source.

```sh
ssh farm-vps 'python3 /opt/farm-companion/collector/collector_ops.py status'
ssh farm-vps 'docker compose -p farm-companion-assets -f /opt/farm-companion/collector/compose.yaml logs --tail 40 collector'
```

Status health means the process is running and its status heartbeat is fresh. `waiting_for_reveal` is expected before reveal; `unavailable` reports a source/read issue and does not prove assets are ready. Follow the dated chain evidence and counts in `/collection/status.json`. The collector resumes after a process or host restart and continues while the workstation is offline. Source/configuration changes still require a workstation deploy; installed browser extensions need a separate update.

For a bounded local live check, run `node dist-collector/collector.mjs --data-dir .local-deploy/collector-smoke --once`. This checks reveal and, only when valid, attempts at most one asset pair. It sends no wallet transactions.

## RPC read origin (2.9.2)

The website and extension explicitly allow `https://robinhood-rpc.publicnode.com` for public chain reads. The official RPC origin remains allowed for older open releases. Changing the configured provider also requires updating the running Nginx CSP from `deployment/nginx.conf`; static asset deployment alone does not update server headers. There is no server RPC proxy or API credential. After staging a config, validate with `docker exec farm-companion-nginx nginx -t`, reload that container’s Nginx, and verify the live CSP before promoting assets that need the new host.

### Local deployment configuration

The checked-in service is a template using `%h/farm` and Node from PATH. Set its working directory and Node PATH for your machine before installing it. Existing installed units do not need replacement.

Set the SSH alias with `FARM_DEPLOY_SSH_HOST`, or create ignored `.local-deploy/private-config.json` (permissions `0600`):

```json
{"ssh_host":"farm-vps","private_wallet_addresses":[]}
```

Add any personal wallet identifiers to this local denylist to reject them in releases. `FARM_PRIVATE_CONFIG` can point to another private config file; isolated release checks inherit its absolute path. Never commit that file. Public builds work without it.
