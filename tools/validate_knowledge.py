#!/usr/bin/env python3
"""Offline knowledge integrity and economy-v2 arithmetic checks; no network or transactions."""
import argparse
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def load(path):
    return json.loads((ROOT / path).read_text(), object_pairs_hook=unique_object)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write-report', action='store_true')
    args = parser.parse_args()
    checks = []

    def check(name, condition):
        checks.append((name, bool(condition)))

    paths = sorted((ROOT / 'knowledge').rglob('*.json')) + sorted((ROOT / 'portfolio').rglob('*.json'))
    for path in paths:
        load(path.relative_to(ROOT))
    check('All JSON parses without duplicate keys', True)
    rules = load('knowledge/rules.json')
    sources = load('knowledge/sources.json')
    decisions = load('knowledge/decisions.json')
    integrations = load('knowledge/integrations.json')
    review = load('knowledge/snapshots/verified-contracts-2026-09-11/review.json')
    deployment = load('knowledge/reviewed-deployment.json')
    source_ids = {s['id'] for s in sources['source_records']}
    check('Unique source IDs', len(source_ids) == len(sources['source_records']))

    def visit(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key == 'sources' and isinstance(child, list):
                    check('Source references: ' + ', '.join(child), set(child) <= source_ids)
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    for data in [rules, integrations, load('knowledge/questions.json')]:
        visit(data)
    for item in sources['local_evidence']:
        check('Evidence exists: ' + item['path'], (ROOT / 'knowledge' / item['path']).is_file())
    for doc in [ROOT / 'README.md', ROOT / 'AGENTS.md', *(ROOT / 'knowledge').glob('*.md'), *(ROOT / 'portfolio').glob('*.md')]:
        for target in re.findall(r'\]\(([^)]+)\)', doc.read_text()):
            if '://' not in target and not target.startswith('#'):
                check('Local link: ' + target, (doc.parent / target.split('#')[0]).exists())
    for item in load('knowledge/snapshots/site-2026-09-11/index.json'):
        raw = (ROOT / item['path']).read_bytes()
        check('Current page/client SHA256: ' + item['path'], hashlib.sha256(raw).hexdigest() == item['sha256'])
    for item in load('knowledge/snapshots/api-index.json'):
        raw = (ROOT / 'knowledge' / item['path']).read_bytes()
        check('Historical API SHA256: ' + item['source_id'], hashlib.sha256(raw).hexdigest() == item['sha256'])
        if item['source_id'] == 'manifest':
            manifest = json.loads(raw)
            check('3333 unique manifest rows', len(manifest) == 3333 and {r['row'] for r in manifest} == set(range(3333)))
            check('Manifest tier counts', Counter(r['tier'] for r in manifest) == {t['tier']: t['count'] for t in rules['plots']['rarities']})
    check('Current NFT matches cached manifest commitment', review['manifest']['matches'] and review['manifest']['cached_keccak256'] == review['reads']['nft.manifestHash'])

    check('Current knowledge date and economy revision', rules['reviewed_on_utc'] == '2026-09-11' and rules['emissions']['economy_version'] == 2)
    check('Historical economy retained', load('knowledge/history/2026-09-07/rules.json')['levels']['entries'][-1]['incremental_upgrade_cost_crop'] == '150000')
    check('Chain and pinned review agree', review['chain_id'] == rules['network']['chain_id'] == integrations['network']['chain_id'] == deployment['chain_id'] == 4663)
    check('Current review has block hash and UTC time', review['block_number'] == deployment['block_number'] == 60592342 and re.fullmatch(r'0x[0-9a-f]{64}', review['block_hash']) and review['block_time'].endswith('Z'))
    for name, record in review['contracts'].items():
        address = record['address'].lower()
        source = load(f'knowledge/snapshots/verified-contracts-2026-09-11/{name}.json')
        check('Address provenance: ' + name, address == integrations['contracts'][name]['address'] == deployment['contracts'][name]['address'] == source['address'].lower())
        check('Exact source/runtime evidence: ' + name, source['creationMatch'] == source['runtimeMatch'] == 'exact_match' and record['matches'] and record['runtime_keccak256'] == record['runtime_source_keccak256'] == deployment['contracts'][name]['runtime_keccak256'])
        for key, value in source['sources'].items():
            local = ROOT / 'knowledge/snapshots/verified-contracts-2026-09-11/source' / name / key
            if key.startswith('src/'):
                check('Archived Solidity: ' + name + '/' + key, local.read_text() == value['content'])
    for name in ['activation', 'levels']:
        for linked in ['crop', 'nft', 'emissions']:
            check('Current link: ' + name + '.' + linked, review['reads'][name + '.' + linked].lower() == integrations['contracts'][linked]['address'])
    check('Current NFT transfer hook', review['reads']['nft.transferHook'].lower() == integrations['contracts']['activation']['address'])

    levels = rules['levels']['entries']
    tiers = rules['plots']['rarities']
    costs = [int(l['incremental_upgrade_cost_crop']) for l in levels]
    check('Levels and costs reflect economy v2', [l['level'] for l in levels] == [1, 2, 3, 4, 5] and costs == [0, 5000, 10000, 20000, 50000])
    check('Full upgrade path is 85000', sum(costs) == int(rules['derived']['upgrade_total_per_plot_crop']) == 85000)
    for level in levels[1:]:
        check('New pinned upgrade cost: ' + str(level['level']), int(review['reads']['levels.costToReach.' + str(level['level'])]) == int(level['incremental_upgrade_cost_crop']) * 10**18)
    check('Plant cost and split', int(review['reads']['activation.FEE']) == int(rules['planting']['cost_crop']) * 10**18 == 2500 * 10**18 and rules['planting']['burn_bps'] + rules['planting']['treasury_bps'] == 10000)
    check('Seed bag fee and treasury burn', int(review['reads']['activation.BAG_BURN']) == int(rules['planting']['seed_bag']['town_burn_crop']) * 10**18 and int(review['reads']['activation.MAX_BAG_PRICE']) == 10**16)
    check('Pool fee replaces old site fee', rules['fees']['site_swap_fee_bps'] == 0 and rules['fees']['pool_swap_fee_bps'] == 100)
    check('3333 rarity allocation', sum(t['count'] for t in tiers) == rules['plots']['max_supply'] == 3333)
    weight = sum(t['count'] * t['multiplier_bps'] for t in tiers)
    check('All level-1 farm weight 3613.5', weight == rules['derived']['all_level1_exact_farm_weight_bps'] == 36135000)
    check('Maximum individual weight 6', levels[-1]['multiplier_bps'] * tiers[-1]['multiplier_bps'] // 10000 == 60000)
    check('Historical personal arithmetic remains an example', sum(costs) * 22 == int(rules['derived']['upgrade_total_22_crop']) and (2500 + sum(costs)) * 22 == int(rules['derived']['plant_and_max_22_crop']))
    emissions = rules['emissions']
    budgets = [int(x) for x in emissions['annual_budgets_crop']]
    check('760M four-year base ceiling', budgets == [380000000, 190000000, 95000000, 95000000] and sum(budgets) == 760000000)
    check('Nominal per-weight rate verified', int(emissions['nominal_crop_per_weight_week']) * 10**18 == int(review['reads']['emissions.RATE_PER_WEIGHT_PER_WEEK']) == 2000 * 10**18)
    check('365-day contract years', emissions['illustration_year_seconds'] == int(review['reads']['emissions.YEAR']) == 31536000)
    check('2B token allocation', sum(int(x['crop']) for x in rules['token_allocations']['allocations']) == 2000000000)
    genesis = int(datetime.fromisoformat(rules['schedule']['genesis_utc'].replace('Z', '+00:00')).timestamp())
    check('Genesis agrees with current source getter', genesis == int(review['reads']['emissions.start']) == int(review['reads']['weather.genesis']))
    soil = emissions['first_soil']
    check('First Soil factors', [x['multiplier_bps'] for x in soil] == [20000, 15000])
    check('First Soil exact dates', int(datetime.fromisoformat(soil[0]['end_utc'].replace('Z', '+00:00')).timestamp()) == int(review['reads']['emissions.foundingWeekEnd']) == genesis + 7*86400 and int(datetime.fromisoformat(soil[1]['end_utc'].replace('Z', '+00:00')).timestamp()) == int(review['reads']['emissions.firstSoilEnd']) == genesis + 28*86400)
    check('Empty public default portfolio', decisions['portfolio']['wallets'] == [] and decisions['portfolio']['expected_plot_count'] is None)
    check('No public personal funding target', decisions['funding_target']['usd_per_wallet'] is None)
    check('Almanac remains primary gameplay authority', decisions['rule_authority']['primary'] == 'almanac')
    check('Both return measures and funding modes retained', decisions['objectives'] == ['net_crop_accumulation', 'net_eth_profit'] and {x['id'] for x in decisions['funding_models']} == {'harvest_funded', 'extra_investment'})
    check('Required horizons retained', all(d in decisions['horizons_days'] for d in [30, 90, 365]))
    check('Missing gas is not zero', rules['harvest']['wallet_paid_gas'] is None)

    # Exact rational illustrations isolate v2 behavior; implementation tests exercise integer simulation.
    nominal = Fraction(2000)
    scheduled_week = Fraction(budgets[0] * 7, 365)
    def segment(w, weather=Fraction(1), soil=Fraction(1), carry=Fraction(0), granary=Fraction(0)):
        available = scheduled_week + carry
        base = min(nominal*w, available)
        target = base*weather*soil
        drawn = min(max(target-base, 0), granary)
        added = max(base-target, 0)
        return (base+drawn-added, available-base, granary-drawn+added)
    check('Uncapped rate independent of new weight', segment(1)[0] == 2000 and segment(100)[0]/100 == 2000)
    check('Ceiling binds before multipliers', segment(4000)[0] == scheduled_week and segment(4000, soil=2, granary=10**8)[0] == scheduled_week*2)
    check('Carry extends later base rate without duplicate spend', segment(4000, carry=1000000)[0] == 8000000 and segment(4000, carry=1000000)[1] == scheduled_week+1000000-8000000)
    check('Idle schedule enters carry, not Granary', segment(0, granary=40000000) == (0, scheduled_week, 40000000))
    check('Empty Granary clips First Soil', segment(1, soil=2, granary=500)[0] == 2500 and segment(1, soil=2, granary=500)[2] == 0)
    check('Harsh combined weather refills Granary', segment(1, weather=Fraction(1,2), granary=0)[2] == 1000)
    check('Locusts during founding is combined 1x', segment(1, weather=Fraction(1,2), soil=2)[0] == 2000)
    check('Capped 2x weather and founding can combine 4x', segment(1, weather=2, soil=2, granary=10000)[0] == 8000)
    check('Plant payback 4.375 days in founding Fair', Fraction(2500*7,4000) == Fraction(35,8))
    check('Common first-step normal Fair payback 70 days', Fraction(5000*7,2000*Fraction(1,4)) == 70)
    check('Golden first-step normal Fair payback 35 days', Fraction(5000*7,2000*Fraction(1,2)) == 35)
    check('Golden second step ties Common first on marginal weight per cost', Fraction(1,2)/10000 == Fraction(1,4)/5000)
    gross30 = 4000 + 3000*3 + Fraction(2000*2,7)
    examples = {'common_fair_genesis_30d_gross_crop': str(float(gross30)), 'common_fair_genesis_90d_gross_crop': str(float(4000+9000+Fraction(2000*62,7))), 'common_fair_genesis_365d_gross_crop': str(float(4000+9000+Fraction(2000*337,7))), 'year1_zero_carry_ceiling_weight': str(float(scheduled_week/nominal))}
    check('30-day boundary arithmetic', gross30 == Fraction(95000,7))
    failures = [name for name, passed in checks if not passed]
    print(f"{'PASS' if not failures else 'FAIL'}: {len(checks)-len(failures)}/{len(checks)} knowledge checks; {len(paths)} JSON files; no network access.")
    print(json.dumps({'illustrations_only': examples}, indent=2))
    for failure in failures:
        print('FAIL: ' + failure, file=sys.stderr)
    if args.write_report:
        text = ['# Knowledge validation', '', f"Generated {datetime.now(timezone.utc).isoformat()} with `python tools/validate_knowledge.py --write-report`.", '', f"**{'PASS' if not failures else 'FAIL'}: {len(checks)-len(failures)}/{len(checks)} checks across {len(paths)} JSON files.** No network calls or transactions.", '', 'Checks cover source references, dated page hashes, archived source consistency, pinned deployment/linkage/cost records, the manifest, empty public defaults, v2 base ceilings, carry, finite Granary, First Soil boundaries and exact rational worked examples. Application and transaction tests are separate.', '', '| Illustration | Value |', '| --- | ---: |', *[f'| {k} | {v} |' for k,v in examples.items()], '', 'These examples assume fixed weights/weather and sufficient reserves where stated. Validation proves internal consistency, not current chain state, a full audit, executable market prices or global optimality.', '']
        if failures:
            text += ['Failures:', *['- '+f for f in failures]]
        (ROOT / 'knowledge/validation.md').write_text('\n'.join(text))
    return int(bool(failures))


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError, StopIteration) as exc:
        print(f'Validation could not complete: {exc}', file=sys.stderr)
        sys.exit(2)
