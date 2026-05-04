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
- Cancel button removes entries
- Active loans + Activity tabs scope to the selected R-address / ID
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
- **Local daemon**: source of identity / wallet truth.
- **Explorer API**: aggregated network-wide marketplace data.
- **Chain**: ultimate source of truth. Local + explorer are derivative.

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

## What's NOT yet wired

- **Match acceptance / origination** — the "Accept this loan" button
  shows a preview but doesn't broadcast. Phase C blocker:
  cross-currency partial-tx flows on cryptocondition currencies
  (DAI.vETH etc.) need either `makeoffer`/`takeoffer` or
  `borrower-commits-UTXO` schemes (see SCHEMA.md notes).
- **Z-memo messaging** — Communications tab is a placeholder. Real
  send/receive against identity `privateaddress` is Phase C+.
- **Pre-signed Tx-Repay / Tx-B templates** — for cooperative repay and
  default-after-maturity. Same Phase C territory.

## License

MIT.

## Related

- Spec / protocol: [github.com/Fried333/veruslending](https://github.com/Fried333/veruslending)
- Public block explorer: [scan.verus.cx](https://scan.verus.cx)
- Verus: [verus.io](https://verus.io)
