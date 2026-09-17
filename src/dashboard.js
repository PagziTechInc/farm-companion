import { mount } from './public-ui.js';
import { mountApproval } from './approval-panel.js';
mount(document.getElementById('app'), {
  // Keep this tab's planner on the same immutable release as its UI bundle.
  planWorkerFactory: () => new Worker(new URL('./plan-worker.js', import.meta.url)),
  storage: { get: () => localStorage.getItem('yield-farm-public-v2'), set: text => localStorage.setItem('yield-farm-public-v2', text) },
  approvalWidget: (host, options) => mountApproval(host, { ...options,
    storage: { get: () => localStorage.getItem('yield-farm-public-approvals-v2'), set: text => localStorage.setItem('yield-farm-public-approvals-v2', text) },
  }),
});
