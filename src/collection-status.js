export const COLLECTION_ORIGIN = 'https://farm.pagzi.tech';
export const COLLECTION_STATUS_URL = `${COLLECTION_ORIGIN}/collection/status.json`;
export const COLLECTION_CATALOG_URL = `${COLLECTION_ORIGIN}/collection/plots.json`;
const phases = ['waiting_for_reveal', 'waiting_for_assets', 'collecting', 'complete', 'unavailable'];

function mintedCount(raw) {
  const chain=raw?.chain_observation;
  if (!chain || chain.chain_id!==4663 || chain.runtime_verified!==true || chain.manifest_verified!==true ||
      !['sealed','revealed'].includes(chain.status) || !Number.isSafeInteger(chain.block_number) || chain.block_number<=0 ||
      !Number.isFinite(Date.parse(chain.observed_at_utc)) || !Number.isInteger(chain.total_supply) ||
      chain.total_supply<0 || chain.total_supply>3333) return null;
  return chain.total_supply;
}

export function validateCollectionStatus(raw) {
  if (!raw || raw.schema_version !== 1 || raw.environment !== 'production' || !phases.includes(raw.phase) ||
      raw.target_count !== 3333 || !Number.isInteger(raw.collected_count) || raw.collected_count < 0 || raw.collected_count > 3333 ||
      !Number.isFinite(Date.parse(raw.last_checked_at_utc)) ||
      (raw.phase === 'complete' && raw.collected_count !== 3333)) throw Error('Collection status is unavailable.');
  return Object.freeze({ schema_version: 1, environment: 'production', phase: raw.phase,
    target_count: 3333, collected_count: raw.collected_count, minted_count: mintedCount(raw),
    last_checked_at_utc: raw.last_checked_at_utc,
    next_check_at_utc: Number.isFinite(Date.parse(raw.next_check_at_utc)) ? raw.next_check_at_utc : null,
    error: typeof raw.error === 'string' ? raw.error.slice(0, 400) : '' });
}

export async function readCollectionStatus(transport) {
  return validateCollectionStatus(await transport(COLLECTION_STATUS_URL, {
    method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error'
  }));
}
