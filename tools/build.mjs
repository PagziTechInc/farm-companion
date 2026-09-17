import { build } from 'esbuild';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { zipFiles } from './zip.mjs';
const root = new URL('../', import.meta.url);
process.chdir(fileURLToPath(root));
await mkdir('dist', { recursive: true });
await mkdir('dist-collector', { recursive: true });
await build({entryPoints:['tools/collect-assets.mjs'],outfile:'dist-collector/collector.mjs',bundle:true,platform:'node',target:'node24',format:'esm',logLevel:'warning'});
await rm('dist-extension', { recursive: true, force: true });
await mkdir('dist-extension', { recursive: true });
const common = { bundle: true, target: ['chrome110', 'firefox115'], logLevel: 'warning', legalComments: 'eof', loader: { '.css': 'text', '.md': 'text', '.ttf': 'dataurl', '.woff2': 'dataurl', '.webp': 'dataurl', '.png': 'dataurl' } };
const worker = await build({ ...common, entryPoints: ['src/worker.js'], write: false, format: 'iife', minify: true });
await writeFile('dist/plan-worker.js', worker.outputFiles[0].text);
await writeFile('dist-extension/plan-worker.js', worker.outputFiles[0].text);
const rows = JSON.parse(await readFile('knowledge/snapshots/manifest-2026-09-07.json', 'utf8'));
// Public artifacts are independent of all local portfolio files.
const defines = { __WORKER_SOURCE__: JSON.stringify(worker.outputFiles[0].text), __MANIFEST_TIERS__: JSON.stringify(rows.map(r => r.tier)), __INITIAL_WORKSPACE__: 'null' };
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const fontLicense = (await Promise.all(['assets/press-start-2p-LICENSE.txt','assets/site/IBM-Plex-LICENSE.txt'].map(file=>readFile(file,'utf8')))).join('\n\n');
await writeFile('dist/FONT-LICENSES.txt',fontLicense);
const artworkSources = await Promise.all(['assets/site/sources.json', 'assets/site/expansion-sources.json'].map(async path => JSON.parse(await readFile(path, 'utf8'))));
const artworkCredits = artworkSources.flatMap(source => [...source.assets, ...(source.inline_svg ?? [])]).map(({url, path, selector}) => ({url, path, ...(selector ? {selector} : {})}));
const artCredits = 'Official Yield Farm reference artwork: https://rh.farm/\nSources: '+JSON.stringify(artworkCredits,null,2)+'\nSeason scenes and showcase artwork are visual examples, not owned token images or yield modifiers.\nCustom companion field-station illustration created for this fan project using the referenced game art.\n';
await writeFile('dist/ART-CREDITS.txt',artCredits);
const header = `// ==UserScript==
// @name         Yield Farm Companion
// @namespace    local.yield-farm-companion
// @version      ${version}
// @description  Your fan-made Yield Farm sidekick. Track plots, forecast harvests and plan the next upgrade.
// @match        https://rh.farm/*
// @connect      rpc.mainnet.chain.robinhood.com
// @connect      robinhood-rpc.publicnode.com
// @connect      api.rh.farm
// @connect      api.coinbase.com
// @connect      farm.pagzi.tech
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        unsafeWindow
// @grant        GM_setValue
// @run-at       document-idle
// @noframes
// ==/UserScript==`;
await build({ ...common, entryPoints: ['src/dashboard.js'], outfile: 'dist/app.js', format: 'esm', define: defines });
await build({ ...common, entryPoints: ['src/userscript.js'], outfile: 'dist/yield-farm-companion.user.js', format: 'iife', define: defines, banner: { js: header + '\n/* Bundled Press Start 2P and IBM Plex font licenses:\n' + fontLicense + '\n*/' } });
await build({ ...common, entryPoints: ['src/extension-content.js'], outfile: 'dist-extension/content.js', format: 'iife', define: defines });
await build({ ...common, entryPoints: ['src/extension-frame.js'], outfile: 'dist-extension/companion.js', format: 'esm', define: defines });
await build({ ...common, entryPoints: ['src/extension-background.js'], outfile: 'dist-extension/background.js', format: 'esm', define: defines });
const extensionManifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
extensionManifest.version = version;
await writeFile('dist-extension/manifest.json', JSON.stringify(extensionManifest, null, 2) + '\n');
await writeFile('dist-extension/companion.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Farm Companion</title><link rel="stylesheet" href="companion.css"></head><body><div id="app"></div><script type="module" src="companion.js"></script></body></html>\n');
await writeFile('dist-extension/companion.css', 'html,body{margin:0;min-height:100%;background:#0f1a0f}body{color:#f2d182}*{box-sizing:border-box}\n');
await writeFile('dist-extension/icon.png', await readFile('assets/site/corn.png'));
await writeFile('dist-extension/FONT-LICENSES.txt', fontLicense);
await writeFile('dist-extension/ART-CREDITS.txt', artCredits);
const installChrome = `Farm Companion ${version} - Chrome / Edge extension\n\n1. Extract farm-companion-chrome.zip to a folder you will keep.\n2. Open chrome://extensions (Edge: edge://extensions).\n3. Turn on Developer mode.\n4. Click Load unpacked and select the extracted folder containing manifest.json.\n5. Visit or reload https://rh.farm/ and click Farm Companion.\n\nUse the Chrome extension OR the Tampermonkey userscript; disable the other to avoid duplicate launchers.\nThe public website ZIP and dist directory are for hosting, not Load unpacked.\nFor an update in the same folder, click Reload on the extension card, then reload rh.farm.\nYour farm and action journal are saved by this extension, separately from the website and userscript. Export them before removing the extension.\n`;
await writeFile('dist-extension/INSTALL.txt', installChrome);
await writeFile('dist/INSTALL-CHROME.txt', installChrome);
await writeFile('dist/index.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><meta name="description" content="A fan-made sidekick for Yield Farm. Track your plots, forecast the harvest and make every upgrade count."><title>Farm Companion — Your Yield Farm Sidekick</title><style>body{margin:0;background:#0f1a0f}*{box-sizing:border-box}</style></head><body><div id="app"></div><script type="module" src="./app.js"></script></body></html>`);
await writeFile('dist/build.json', JSON.stringify({ version, built_at: new Date().toISOString(), interfaces: ['dashboard', 'tampermonkey', 'chromium-extension'], shared_engine: 'src/engine.js' }, null, 2));
await writeFile('dist/_headers', `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://api.rh.farm; frame-src https://api.rh.farm; worker-src 'self' blob:; font-src 'self' data:; connect-src 'self' https://rpc.mainnet.chain.robinhood.com https://robinhood-rpc.publicnode.com https://api.rh.farm https://api.coinbase.com https://farm.pagzi.tech; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
`);
await writeFile('dist/README.txt', 'Farm Companion public website release\nUpload this dist directory to a static HTTPS host. No application server is required.\nFor Chrome Load unpacked, extract farm-companion-chrome.zip and use that folder. See INSTALL-CHROME.txt.\nFor Tampermonkey, install yield-farm-companion.user.js through Tampermonkey.\nThis website directory is not a browser extension; _headers is a website host configuration file.\nPortfolio data stays in each browser. Public RPC/API reads disclose queried public addresses to those providers.\nThis is an independent community tool, not the official game.\n');
const artifacts = await Promise.all(['dist/plan-worker.js', 'dist/app.js', 'dist/yield-farm-companion.user.js', 'dist-extension/content.js', 'dist-extension/companion.js', 'dist-extension/background.js'].map(file => readFile(file, 'utf8')));
// Deployment-specific identifiers live only in ignored local configuration.
let privateConfig = {};
try { privateConfig = JSON.parse(await readFile(process.env.FARM_PRIVATE_CONFIG || '.local-deploy/private-config.json', 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const privateWallets = privateConfig.private_wallet_addresses ?? [];
if (!Array.isArray(privateWallets) || privateWallets.some(address => typeof address !== 'string' || !/^0x[0-9a-f]{38,40}$/i.test(address))) throw new Error('Invalid private wallet denylist');
for (const data of artifacts) if (privateWallets.some(address => data.toLowerCase().includes(address.slice(2).toLowerCase()))) throw new Error('Public build contains a private configured wallet profile.');
const extensionFiles = ['manifest.json', 'plan-worker.js', 'content.js', 'companion.js', 'background.js', 'companion.html', 'companion.css', 'icon.png', 'FONT-LICENSES.txt', 'ART-CREDITS.txt', 'INSTALL.txt'];
const archive = zipFiles(await Promise.all(extensionFiles.map(async name => [name, await readFile(`dist-extension/${name}`)])));
await mkdir('artifacts', { recursive: true });
await writeFile('dist/farm-companion-chrome.zip', archive);
await writeFile(`artifacts/farm-companion-chrome-${version}.zip`, archive);
console.log('Built website dist/, Tampermonkey userscript, and Chrome extension dist-extension/ + dist/farm-companion-chrome.zip');
