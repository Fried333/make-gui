# Terms of Use

```
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  NO  WARRANTY  —  NO  GUARANTEES  —  USE  AT  YOUR  OWN  RISK
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

# THE SOFTWARE IS PROVIDED **AS IS**, WITHOUT WARRANTY OF ANY KIND.

# NO ONE PROMISES THE PRICES ARE CORRECT.
# NO ONE PROMISES THE CODE IS BUG-FREE.
# NO ONE WILL REIMBURSE YOU IF YOU LOSE FUNDS.

**USE THIS SOFTWARE AT YOUR OWN RISK. IF YOU ARE NOT WILLING TO ACCEPT THAT RISK, DO NOT USE IT.**

---

This is an open-source project with no formal entity, no maintainer obligations, and no legal architecture behind it. The contributors are not your counterparty, your advisor, your custodian, or your service provider. They publish code; you decide whether to run it.

## 1. As-is, no warranty

The Software, the make-protocol, and any associated documentation are provided AS IS AND AS AVAILABLE, WITHOUT WARRANTIES OF ANY KIND, whether express, implied, statutory, or otherwise, including but not limited to:

- merchantability, fitness for a particular purpose, non-infringement;
- accuracy, reliability, timeliness, or completeness of any data, prices, or quotes;
- continuous availability or uninterrupted operation;
- correctness of any computation — including oracle-derived prices, collateral ratios, repay amounts, settlement values;
- compatibility with any wallet, daemon, identity, or smart contract;
- preservation of funds, identities, signatures, or any on-chain state.

## 2. Risk disclosure

By using the Software you acknowledge and accept the following risks:

- **Market risk.** Cryptocurrency prices are volatile. Collateral may fall below safe ratios between quote and acceptance. Loans may default. Liquidation is not automatic.
- **Oracle risk.** Prices used for collateral suggestion, ratio validation, and auto-fund / auto-accept decisions are derived from on-chain reserve currencies via the local daemon's `estimateconversion` RPC. They reflect the chain's current state, which may be **inaccurate, stale, or manipulated**. There is no centralized oracle; price discovery is purely on-chain.
- **Software risk.** The Software may contain bugs that cause unintended fund movements, failed transactions, or loss of funds. The protocol uses pre-signed partial transactions (SIGHASH_SINGLE|ANYONECANPAY); a malformed partial can be broadcast incorrectly.
- **Chain risk.** Reorgs, network partitions, mempool eviction, daemon crashes, or fork events may invalidate in-flight transactions.
- **Counterparty risk.** Loans are bilateral. The other party may default, fail to repay, or attempt griefing within the protocol's bounds. Recovery may require cooperation that is not always available.
- **Smart-contract risk.** Vault outputs use Bitcoin Script multisig (2-of-2 P2SH). Bugs in script handling at the daemon level, an unexpected hard fork, or a consensus-rule change can render funds inaccessible.
- **Regulatory risk.** The legal status of decentralized lending varies by jurisdiction. You are solely responsible for compliance with the laws applicable to you.

## 3. Auto-accept and auto-fund: heightened risk

Auto-accept and auto-fund delegate decision-making to the Software at the moment of execution, without your contemporaneous review. This delegation amplifies every risk listed above.

When you enable auto-accept or auto-fund, you specifically further acknowledge:

- The Software will execute on-chain transactions on your behalf without prompting.
- The oracle price used at the moment of execution may differ materially from what you saw when configuring the offer/request.
- A buggy Software version, a malicious update, or a configuration error can cause auto-execution against terms you would have rejected if reviewing manually.
- The kill-switch (a per-offer or per-request toggle, plus a global "pause auto-execute" setting) is the only mechanism by which you can stop auto-execution. **It is your responsibility to monitor your active loans and intervene if conditions change.**

A separate opt-in flow, requiring affirmative consent to specific acknowledgements, gates the first activation of auto-accept and auto-fund. Once enabled, you may disable at any time from the Settings panel.

## 4. No legal, financial, or tax advice

Nothing displayed by the Software or contained in any documentation constitutes legal, financial, investment, tax, or any other professional advice. Consult licensed professionals before participating.

## 5. Data sources and methodology

See [METHODOLOGY.md](./METHODOLOGY.md) for how oracle prices, collateral suggestions, and ratio validations are computed.

The Software is, by default, configured to query a public marketplace indexer at `scan.verus.cx`. You may change this in Settings → Explorer API URL. No representations are made about the accuracy, availability, or integrity of any third-party indexer, including the default. **The default endpoint is provided for convenience; you remain responsible for verifying any data on which you act.**

All oracle-derived prices come from your local Verus daemon's `estimateconversion` RPC. This is sovereign data — you can verify it independently by calling the RPC directly.

## 6. Consent record

When you enable auto-accept or auto-fund, the Software records the following in your browser's `localStorage`:

- A timestamp
- The version (commit hash) of the Software you consented to
- The specific acknowledgements you checked

This record is stored on your machine only. It is not transmitted to any server.

---

**By using the Software, you confirm you have read and accepted these Terms. If you do not accept any part of these Terms, do not use the Software.**
