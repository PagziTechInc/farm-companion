import { expect } from '@playwright/test';

const UTILITY_LABELS = {
  themes: 'Themes',
  valley: 'Valley',
  files: 'Saved farms',
  actions: 'Farm actions · connect & approve',
};

export async function openDetails(page, selector) {
  const details = page.locator(selector);
  await expect(details).toHaveCount(1);
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
  await expect(details).toHaveAttribute('open', '');
  return details;
}

export async function openUtility(page, name) {
  const control = page.getByRole('button', {name:UTILITY_LABELS[name], exact:true, includeHidden:true});
  if (name !== 'actions' && !(await control.isVisible())) await openDetails(page, '#tools-menu');
  if (await control.getAttribute('aria-pressed') !== 'true') await control.click();
  await expect(control).toHaveAttribute('aria-pressed', 'true');
}

export async function openMainTab(page, name) {
  const tab = page.getByRole('tab', {name, exact:true});
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

export async function openAddPlots(page) {
  const form = page.locator('#quick-farm');
  if (!await form.isVisible()) {
    const farmTab = page.getByRole('tab', {name:'My farm', exact:true});
    if (await farmTab.getAttribute('aria-selected') !== 'true') await farmTab.click();
    if (!await form.isVisible()) {
      const modelBuilder = page.locator('details.model-builder');
      if (await modelBuilder.count() && await modelBuilder.getAttribute('open') === null) {
        await modelBuilder.locator(':scope > summary').click();
      }
    }
    if (!await form.isVisible()) {
      const add = page.getByRole('button', {name:'Add wallets & model plots', exact:true});
      if (await add.count()) await add.click();
    }
    if (!await form.isVisible()) {
      const modelBuilder = page.locator('details.model-builder');
      if (await modelBuilder.count() && await modelBuilder.getAttribute('open') === null) {
        await modelBuilder.locator(':scope > summary').click();
      }
    }
  }
  await expect(form).toBeVisible();
}

export async function openWallets(page) {
  const control = page.getByRole('button', {name:'Wallets', exact:true});
  if (await control.getAttribute('aria-pressed') !== 'true') await control.click();
  await expect(page.getByRole('heading', {name:'Your wallets', level:1, exact:true})).toBeVisible();
}

export async function openForecastSettings(page) {
  const form = page.locator('#assumptions');
  if (!await form.isVisible()) {
    const customize = page.locator('#customize-forecast');
    if (await customize.count()) {
      const automaticDetails = page.locator('details.automatic-details');
      if (await automaticDetails.count() && await automaticDetails.getAttribute('open') === null) {
        await automaticDetails.locator(':scope > summary').click();
      }
      if (await customize.isVisible()) await customize.click();
    }
  }
  if (!await form.isVisible()) {
    const toggle = page.getByRole('button', {name:/Edit forecast/});
    if (await toggle.count() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  }
  await expect(form).toBeVisible();
}

export async function openForecastView(page, name) {
  const labels = {harvest:'Harvest', weather:'Weather lab', goal:'CROP goal', planting:'Planting'};
  const control = page.locator(`[data-forecast-view="${name}"]`);
  if (!await control.isVisible()) {
    const calculators = page.locator('details.extra-calculators');
    if (await calculators.count() && await calculators.getAttribute('open') === null) await calculators.locator(':scope > summary').click();
  }
  if (await control.getAttribute('aria-pressed') !== 'true') await control.click();
  await expect(control).toHaveAttribute('aria-pressed', 'true');
  if (labels[name]) await expect(control).toHaveText(new RegExp(labels[name]));
}

export async function openPlotFilters(page) {
  const filters = page.locator('details.plot-filter-options');
  if (await filters.count() && !(await filters.evaluate(element => element.open))) {
    await filters.locator(':scope > summary').click();
  }
}

export async function openHarvestLedger(page) {
  const ledger = page.locator('details.harvest-ledger');
  if (await ledger.count() && !(await ledger.evaluate(element => element.open))) await ledger.locator(':scope > summary').click();
}
