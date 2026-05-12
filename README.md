# make-gui

A minimal local web app for browsing and acting on Make Protocol contract
markets (loan offers, loan requests, loan matches, loan status, option
offers) directly against your local `verusd` daemon.

This is a reference client for the data layer specified in
[make-protocol/SCHEMA.md](https://github.com/Fried333/make-protocol/blob/main/SCHEMA.md).
Anyone can fork, extend, or replace it — the chain is the source of truth.

## What it does

- Lists VerusIDs in your wallet, grouped by their primary R-address
- Shows the network-wide marketplace (open requests, open offers, matches)
  pulled from the [scan.verus.cx](https://scan.verus.cx) explorer API
- Lets you post `loan.request` and `loan.offer` entries on any of your
  identities
- **Borrower-first origination flow** — borrower posts a v2 `loan.request`
  pre-signed against a fresh single-currency UTXO; lender posts a `loan.match`
  containing all three pre-signed partials (Tx-A, Tx-Repay, Tx-B); borrower
  clicks Accept to broadcast Tx-A and open the loan
- **Oracle-driven collateral suggestion** — when the borrower picks a
  principal currency + amount + collateral currency, the request form
  fetches a live price via the local daemon's `estimateconversion`
  (multi-route fallback: direct → Bridge.vETH → Bridge.vARRR → Pure) and
  auto-populates the suggested collateral at the lender's target ratio.
  User can override; suggestion stays live as inputs change
- **Lender auto-fund (per-offer)** — lender's offer can carry
  `auto_fund: true` and the GUI runs a 30s watcher that auto-posts a
  loan.match when a request matches the offer's criteria (lend
  currency, VRSC cap, term cap, oracle-priced collateral ratio with a
  1.5× hard floor). Wallet stays unlocked, GUI signs locally — never
  holds keys server-side. The offer's `auto_fund` flag is the lender's
  declared consent; to pause, cancel the offer or re-post with
  `auto_fund: false`. Counterparties see a `🤖 Auto-fund` badge on the
  offer card so they know what to expect.
- **Borrower auto-accept (per-request)** — borrower's request can carry
  `auto_accept: true` (the "Auto-confirm if the lender's match honors
  these exact terms" checkbox on the request form). When the lender
  posts a `loan.match`, the borrower's GUI runs a 7-check safety
  verification on the match against the original request:
  - principal/collateral/repay amounts match (8-dp exact, integer
    satoshi)
  - principal output pays the borrower's R; repay + Tx-B outputs pay
    the lender's R; vault output address matches the P2SH derived
    from both pubkeys
  - maturity_block ≤ today + term_days × 1440 (chain-wall protection
    against a malicious lender setting an impossibly-distant maturity)
  - currencies match between request and match (i-address compare,
    SCHEMA.md §2)

  If all seven checks pass, Tx-A broadcasts automatically — no second
  click. If anything fails, the match surfaces in Inbox for manual
  review. The flag is on-chain in the request payload; to pause, cancel
  + re-post with the checkbox off. Counterparties see a `🤖 Auto-accept`
  badge on the request card.
- **Active loans tab** — lists open loans on local identities, with a
  Repay button that auto-splits a clean repayment UTXO, extends Tx-Repay,
  broadcasts, and posts `loan.history` for trade history
- **Auto-split via `sendcurrency`** — no UTXO management; the GUI splits
  fresh single-currency UTXOs in mempool for clean signing. Chained
  parent-child broadcasts settle without confirmation waits
- Cancel button removes entries
- Activity tab — chronological feed of contract events scoped to acting ID
- Communications tab (placeholder) — will surface encrypted z-memos via
  identity `privateaddress` once Phase C lands

## Run it

Requires:
- Python 3.8+ (stdlib only — no pip install)
- A running `verusd` (Verus daemon) on the same machine
- The daemon's `~/.komodo/VRSC/VRSC.conf` accessible (for RPC credentials)

```bash
python3 server.py
# defaults to http://127.0.0.1:7777/
# default conf path: ~/.komodo/VRSC/VRSC.conf
```

Override:

```bash
python3 server.py --port 8080 --conf /path/to/VRSC.conf --bind 0.0.0.0
```

Then open the URL in any browser. No installation, no extension.

## Architecture

- `server.py` — stdlib HTTP server. Serves `static/`, proxies `/rpc` to
  `verusd` so the browser can speak to the daemon under one origin.
- `static/index.html` — three-tab dashboard (Marketplace / Active loans /
  Activity).
- `static/js/main.js` — vanilla JS. Talks to local daemon via `/rpc` and
  to the public explorer at `scan.verus.cx/api`.
- `static/js/rpc.js` — thin RPC client.
- `static/css/style.css` — minimal styling.

State model:
- **Browser localStorage**: ephemeral UI state (selected R-address, ID).
- **Local daemon**: source of truth for your own state and any
  counterparty you've transacted with (mempool-aware via
  `getidentity <iaddr> -1`).
- **Explorer API**: stranger discovery only — used by the Marketplace
  tab to find offers from parties you haven't met yet, and to walk
  full settlement history. The Loans tab is **daemon-only** — works
  even if the explorer is down.
- **Chain**: ultimate source of truth. Local + explorer are derivative.

See [`DATA_SOURCES.md`](./DATA_SOURCES.md) for the per-feature breakdown
of which calls go to your daemon vs. the explorer, why, and what the
privacy / latency tradeoffs are.

## VDXF keys recognised

All keys are namespaced under `make.VRSC@`
(`iLWvRsiWVCEuFYhCSt2Qba7LxWksrgVerX`), the registered owner of the
Make Protocol contracts standard.

| Key | VDXF id |
|---|---|
| `make.vrsc::contract.loan.offer` | `iMey7Y2idT6dt7jJvRiPXgtYcfAaKCQbHz` |
| `make.vrsc::contract.loan.request` | `iF7Ax6QpdwvTTqDJpNzDXVj1GpUSQX6vH5` |
| `make.vrsc::contract.loan.match` | `iKVShS5o56BLn8BpysrmfvUJbWCrgyio8U` |
| `make.vrsc::contract.loan.status` | `iRzM96sNYj95mUiJebzBnFwirjfws2q6o4` |
| `make.vrsc::contract.loan.history` | `i5qBwi3KWXfyo1UKuUBC3yyq67JagVennW` |
| `make.vrsc::contract.loan.decline` | `iEgciB3u2GwTxzShQR4eFhtj4k8Zv6frNb` |
| `make.vrsc::contract.option.offer` | `i5L8vkz9xsnM8yEDiXzPbP4Kix3SnJSsv5` |

VDXF ids are deterministic — re-derive any of them with
`verus getvdxfid "make.vrsc::contract.loan.offer"`.

## End-to-end validation

Full lifecycle (request → match → accept → repay, plus 8 edge cases —
cancels, manual accept, lost localStorage, insufficient funds, chain-only
recovery, replay safety) plus the new **lender auto-fund** pipeline
(scenario 14: offer + matching request → match auto-posted → loan
settled, no manual lender click) validated via Playwright driving two
browser instances against two local daemons on Verus mainnet. See
`test_e2e_v3_all.mjs` for the test driver.

## What's NOT yet wired

- **Lender's claim-collateral path** — after maturity, the GUI knows
  Tx-B is in the borrower's `loan.status.tx_b_complete` field but the
  one-click claim flow on the lender side isn't wired yet. Funds still
  reachable via cooperative manual sign as a workaround.
- **Z-memo messaging** — Communications tab is a placeholder. Real
  send/receive against identity `privateaddress` is Phase C+.
- **Tx-C rescue path** — the optional last-resort borrower-side
  recovery (far-future nLockTime) is in the spec but not in the GUI yet.

## License

MIT.

## Related

- Spec / protocol: [github.com/Fried333/make-protocol](https://github.com/Fried333/make-protocol)
- Public block explorer: [scan.verus.cx](https://scan.verus.cx)
- Verus: [verus.io](https://verus.io)
