# verus_contract_gui

A minimal local web app for browsing and acting on Verus contract markets
(loan offers, loan requests, loan matches, loan status) directly against
your local `verusd` daemon.

This is a reference implementation of the contract-marketplace data layer
specified in [veruslending/SCHEMA.md](https://github.com/Fried333/veruslending/blob/main/SCHEMA.md).
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
- **Active loans tab** — lists open loans on local identities, with a
  Repay button that auto-splits a clean repayment UTXO, extends Tx-Repay,
  broadcasts, and posts `loan.history` for credit-score reputation
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
  full reputation history. The Loans tab is **daemon-only** — works
  even if the explorer is down.
- **Chain**: ultimate source of truth. Local + explorer are derivative.

See [`DATA_SOURCES.md`](./DATA_SOURCES.md) for the per-feature breakdown
of which calls go to your daemon vs. the explorer, why, and what the
privacy / latency tradeoffs are.

## VDXF keys recognised

| Key | VDXF id |
|---|---|
| `vrsc::contract.loan.offer` | `iA1vgVBV5B29h5pxQ67gxqCoEaLDZ8WbmY` |
| `vrsc::contract.loan.request` | `iPmnErqWbf5NhhWZEoccuX8yU8CgFt2d28` |
| `vrsc::contract.loan.match` | `iBvgGuNNVxEQYCeDD4uPykgrGbWnyTQhGT` |
| `vrsc::contract.loan.status` | `iP5b6uX8SM7ZSiiMbVWwGj9wG76KuJWZys` |
| `vrsc::contract.option.offer` | `i4a42EUWLvJTHYGW7F8RifY1Rvs5AQGioY` |
| `vrsc::contract.option.request` | `iDE4csgPBx9Rn7H4zkn4VhSShcxcwmknQo` |

VDXF ids are deterministic: `verus getvdxfid "vrsc::contract.loan.offer"`.

## End-to-end validation

Full lifecycle (request → match → accept → repay) validated via Playwright
driving two browser instances against two local daemons on Verus mainnet.
See `gui_e2e_borrower_first.mjs` in the spec repo for the test driver.

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

- Spec / protocol: [github.com/Fried333/veruslending](https://github.com/Fried333/veruslending)
- Public block explorer: [scan.verus.cx](https://scan.verus.cx)
- Verus: [verus.io](https://verus.io)
