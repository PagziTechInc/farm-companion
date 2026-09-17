# Knowledge validation

Generated 2026-09-11T22:14:44.561338+00:00 with `python tools/validate_knowledge.py --write-report`.

**PASS: 187/187 checks across 43 JSON files.** No network calls or transactions.

Checks cover source references, dated page hashes, archived source consistency, pinned deployment/linkage/cost records, the manifest, empty public defaults, v2 base ceilings, carry, finite Granary, First Soil boundaries and exact rational worked examples. Application and transaction tests are separate.

| Illustration | Value |
| --- | ---: |
| common_fair_genesis_30d_gross_crop | 13571.42857142857 |
| common_fair_genesis_90d_gross_crop | 30714.285714285714 |
| common_fair_genesis_365d_gross_crop | 109285.71428571429 |
| year1_zero_carry_ceiling_weight | 3643.8356164383563 |

These examples assume fixed weights/weather and sufficient reserves where stated. Validation proves internal consistency, not current chain state, a full audit, executable market prices or global optimality.
