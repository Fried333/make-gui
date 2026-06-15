# Oracle Pricing Methodology

This document describes how prices, collateral ratios, and conversion estimates are derived. Every number you see in the GUI traces back to one of the methods below. **All pricing is sovereign**: it comes from your local Verus daemon, not from a centralized oracle. You can independently verify any quote by issuing the same RPC call directly.

## 1. Where prices come from

The only price source the Software uses is the local Verus daemon's `estimateconversion` RPC:

```
verus estimateconversion '{"currency": "<src>", "amount": <n>, "convertto": "<dst>"}'
```

This RPC queries the on-chain reserve currency state. It returns the amount of `<dst>` that would be received if `<n>` units of `<src>` were converted right now, through the chain's basket curves.

The Software calls this RPC in three contexts:

- **Collateral suggestion** at request-form time: given a chosen principal currency + amount and a chosen collateral currency, suggest a collateral amount that covers the offer's `min_collateral_ratio` at the current oracle rate.
- **Auto-fund validation** (lender-side, every 15s polling cycle): re-quote the request's terms; refuse to fund if the collateral ratio is below the offer's accept floor (`min_collateral_ratio × (1 − slippage_pct / 100)`).
- **Auto-accept validation** (borrower-side): mirror check at acceptance time.

## 2. Route selection

A direct `estimateconversion` call may fail with `-8 Source currency cannot be converted to destination` when no single basket holds both currencies. The Software then retries via the standard reserve baskets in priority order:

1. Direct (no `via` parameter)
2. `Bridge.vETH`
3. `Bridge.vARRR`
4. `Bridge.vDEX`
5. `Pure`

The first route that returns a non-zero quote is used. If none work, the GUI surfaces "no on-chain conversion route" and asks the user to set collateral manually. **No off-chain or third-party oracle is consulted.**

Known basket caveats:
- `Bridge.vARRR` and `Bridge.vDEX` have starved tBTC reserves; quotes through them for tBTC pairs may be unreliable. The fallback walk reaches `Pure` (which has the only intact tBTC reserve) as a last resort.
- Reserve curves are continuous; large amounts produce significantly different per-unit prices than small probes. The Software queries the actual amount being collateralized, so the quote reflects the real slippage curve, not a unit-rate approximation.

## 3. Min-collateral-ratio enforcement

Every loan offer specifies a `min_collateral_ratio` (a multiplier ≥ 1.0). For a request to be valid against that offer, the following must hold at the moment of acceptance:

```
collateral_value_in_principal_currency = estimateconversion(collateral_amount, collateral_currency → principal_currency)
collateral_value_in_principal_currency / principal_amount ≥ min_collateral_ratio
```

The auto-fund and auto-accept paths additionally apply a per-wallet `slippage_pct` (default 1%, configurable in localStorage):

```
accept_floor = min_collateral_ratio × (1 − slippage_pct / 100)
```

This gives the lender a small tolerance for oracle drift between the borrower's request post and the lender's automatic acceptance. Below the floor, auto-fund refuses; the lender or borrower can still complete the trade manually.

**A hard floor of 1.5× is enforced regardless of offer terms.** This is a Software-level guardrail to prevent a malicious or misconfigured offer from triggering effectively-unsecured lending. The hard floor cannot be lowered by configuration.

## 4. Pre-flight sanity check (recommended; configurable)

When enabled in Settings, the Software cross-checks each oracle quote against a sanity threshold:

- The collateral ratio implied by the oracle must fall within `[0.7 × offer_ratio, 1.5 × offer_ratio]`. Outside that range, the GUI refuses the auto-execution path and surfaces a warning. The user can review the actual quote and either set up the trade manually or wait for the oracle to stabilize.
- The lender's quote at fund time must agree with the borrower's quote at request time within 5% of the implied ratio. Larger divergences indicate either rapid market movement or a corrupted quote; the trade is refused.

These checks add a small RPC cost per auto-execution and can be disabled per-offer if you have an external reason to trust the quotes (e.g., trading inside a stablecoin basket).

## 5. Marketplace data vs pricing

A separate concern: **marketplace data** (where offers, requests, and matches are posted on-chain) is fetched from a marketplace indexer endpoint. This is purely a discovery layer — it does not provide pricing. By default the Software queries `scan.verus.cx`; this is configurable from Settings → Explorer API URL. Users running their own indexer (the `verusexplorer-prod` repo) can point at it. The data the indexer returns is itself derived from on-chain state, so the indexer cannot fabricate offers or terms; it can only mis-index or be unavailable. The Software always cross-checks request data against the borrower's identity directly via local-daemon RPC before acting on it.

## 6. Verifying any quote independently

For any oracle-derived number displayed in the GUI:

1. Open the form or panel that shows the quote.
2. Note the principal and collateral currencies + amounts.
3. From a shell, run:
   ```
   verus estimateconversion '{"currency": "<collateral_currency>", "amount": <collateral_amount>, "convertto": "<principal_currency>"}'
   ```
4. The `estimatedcurrencyout` field is the same number the Software used.

If the GUI shows a number you can't reproduce this way, file a bug — that's a Software defect, not an oracle question.

## 7. What the oracle does NOT do

- It does not predict future prices.
- It does not aggregate from multiple off-chain sources.
- It does not smooth, time-weight, or sanitize the on-chain quote in any way the underlying RPC does not already do.
- It does not provide pricing for assets that have no basket route on the current chain.

If your use case requires any of those, do not rely on the Software for that decision.
