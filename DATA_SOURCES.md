# Data sources

This GUI talks to two systems: your local Verus daemon (`verusd`) and the
public block explorer (`scan.verus.cx`). The split is intentional — most
of the GUI runs against your own daemon, with the explorer reserved for
the one thing a daemon alone can't do: discover what *strangers* are
publishing on chain.

## Per-feature breakdown

| Feature | Daemon | Explorer | Notes |
|---|---|---|---|
| List your identities + balances | ✓ | — | `listidentities`, `getaddressbalance` |
| Loans tab — own loans | ✓ | — | `getidentity <me> -1` (mempool) |
| Loans tab — counterparty traffic (known parties) | ✓ | — | `getidentity <them> -1` for anyone in your watch list |
| Marketplace tab — discover others' offers | — | ✓ | `/api/contracts/loans/offers` |
| Marketplace tab — directed-request discovery | partial | partial | watch-list daemon walk + explorer fallback |
| Reputation history (full settled-loan list) | — | ✓ | explorer walks `identity_history` for past `loan.history` entries |
| Post a request / offer / match | ✓ | — | `signrawtransaction` + `updateidentity` |
| Accept a match (broadcast Tx-A) | ✓ | — | `sendrawtransaction` |
| Repay (broadcast Tx-Repay) | ✓ | — | `sendrawtransaction` |
| Settle bookkeeping (`loan.history`) | ✓ | — | `updateidentity` |
| Tx-detail / address-page links | — | ✓ | links to scan.verus.cx |

## The "-1" trick (mempool-aware reads)

Verus's `getidentity <iaddr> -1` returns the most recent state of an
identity *including unconfirmed updateidentity transactions sitting in
the daemon's mempool*. Without `-1`, you only see confirmed state — at
best one block behind.

The GUI uses `-1` everywhere:
- Reading your own multimap (so a freshly-posted `loan.request` shows up
  immediately, not after the next block).
- Reading a known counterparty's multimap (so a `loan.match` from a
  lender appears within ~5 seconds of P2P propagation, not ~75 seconds
  of block + indexer lag).

## Why the explorer at all?

P2P gossip propagates a tx in ~5 seconds, but only your *own* daemon
sees mempool. To find out what a *stranger* is publishing, you have two
options: ask every node on the network (impractical), or query an
indexer that's already seen them (the explorer).

So the explorer's role is **stranger discovery**: the marketplace tab
where you browse the network's open offers. Once you've interacted
with someone (a directed `loan.request` from borrower → lender, or a
`loan.match` from lender → borrower), they're in your **watch list**
and the GUI reads them from your own daemon directly. No explorer needed
for that thread anymore.

The GUI builds the watch list automatically from your identity history
(via `getidentityhistory`) — anyone you've ever transacted with is in
it forever, so post-first-contact every loan thread is daemon-only.

## What confirmation lag looks like

| Path | Lag | Why |
|---|---|---|
| Your daemon mempool → counterparty's daemon mempool | ~5s | P2P gossip |
| Daemon mempool → confirmed (in a block) | ~60s | Verus block time |
| Confirmed → indexed by `scan.verus.cx` | up to 4–5min | indexer catch-up |
| `/api/contracts/loans/offers` cache | 15s | explorer-side response cache |

For loans, **only the marketplace browse** sees the indexer lag — every
other operation is mempool-fresh via your daemon. For offers in the
marketplace, expect ~75 seconds total for an offer to appear network-wide
(60s block + 15s cache).

## Privacy

- Daemon queries are local; nobody else sees them.
- Explorer queries leak interest in specific addresses. The marketplace
  browse is anonymous (just a generic listing call). Per-address API
  calls — `/api/contracts/loans/by-party?address=<x>` — leak that you
  asked about that address. If you care, run your own indexer (it's
  open source) or just don't visit those endpoints.

## Reputation: chain-derived, no GUI dependency

After Phases 1–5 of the soft-delete cleanup:
- On settle, both parties' identities have **`loan.history`** entries (size-1
  overwrite, terminal record). Old `loan.history` entries persist in
  prior identity revisions.
- The explorer walks `identity_history` to surface every past settled
  loan for any identity. **Both parties' attestations** count toward
  reputation, so a loan shows up on the lender's view even if their
  attestation watcher wasn't running when the borrower repaid (cross-party
  reputation aggregation).

You don't have to keep your GUI open to "earn" reputation. The chain
records every settlement; the explorer aggregates from chain.

## Failure modes

| What | What happens | Recovery |
|---|---|---|
| Explorer down | Marketplace browse fails. Loans tab unaffected (daemon-only). | Wait, or switch to a different explorer host. |
| Daemon down | GUI is dead. | Restart `verusd`. |
| Daemon falling behind chain tip | Loans tab + marketplace stale, but consistent within mempool of your daemon's view. | Wait for daemon sync. |
| You posted to the wrong identity | `loan.*` entry on the wrong party's multimap. Cancel it (drops the entry; refunds locked UTXO). | Use the cancel button on the loans tab. |

## Summary

> **The GUI works without `scan.verus.cx`.** Marketplace browse breaks
> (no stranger discovery), but every active loan, repay, settle, and
> recovery flow runs entirely on your own daemon. If you self-host an
> indexer, you don't need scan.verus.cx at all.
