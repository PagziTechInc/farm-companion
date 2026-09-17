import { defineConfig } from '@playwright/test';
const origin=`http://127.0.0.1:${process.env.FARM_PORT??4173}`;
export default defineConfig({ testDir: './tests/browser', timeout: 30000, workers: 1,
  use: { baseURL: origin, viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure' },
  webServer: { command: 'node tools/serve.mjs', url: origin, reuseExistingServer: process.env.FARM_DEPLOY_CHECK!=='1' },
});
