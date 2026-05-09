// CLI-only timing test. No GUI overhead — just measures the protocol-
// level latencies the GUI is built on top of:
//   T0  borrower's GUI (or CLI) issues updateidentity for loan.request
//   T1  borrower's local daemon mempool sees it
//   T2  lender's REMOTE daemon mempool sees it (P2P gossip)
//   T3  request confirms in a block
//   T4  scan.verus.cx explorer surfaces it (typed loans/requests endpoint)
//
// Then we cleanup (drop the request entry).

import { execSync } from "child_process";
import { setTimeout as sleep } from "timers/promises";

const BORROWER_IA = "i7b7Tq8JYXX9iqS7FBevC6LaG3ioh8z3RM";
const LENDER_IA   = "i7A9fa8c3xZnA3uLK3SLYa58cUipganewg";
const VDXF_REQ    = "iFg76F9M8CV5xEg3L2NvCDBXufaxjUWhaW";
const VERUS = "/home/dev/Downloads/verus-cli-v1.2.16/verus";
const CONF  = "/home/dev/.komodo/VRSC/VRSC.conf";
const SSH   = `ssh -p 2400 -i ${process.env.HOME}/.ssh/id_ed25519 -o IdentitiesOnly=yes root@86.107.168.44`;
const REMOTE_VERUS = "/root/verus-cli-v1.2.16/verus";
const REMOTE_CONF  = "/root/.komodo/VRSC/VRSC.conf";

const fmt = (ms) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;

function cli(cmd, remote = false) {
  const cmdStr = remote
    ? `${SSH} "${REMOTE_VERUS} -conf=${REMOTE_CONF} ${cmd.replace(/"/g, '\\"')}"`
    : `${VERUS} -conf=${CONF} ${cmd}`;
  return execSync(cmdStr, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }).trim();
}
const cliJ = (cmd, remote = false) => JSON.parse(cli(cmd, remote));

async function pollUntil(name, predicate, intervalMs = 200) {
  const t0 = Date.now();
  while (true) {
    if (await predicate()) return Date.now();
    if (Date.now() - t0 > 600000) throw new Error(`pollUntil ${name}: timed out`);
    await sleep(intervalMs);
  }
}

(async () => {
  console.log(`\n=== CLI timing test — ${new Date().toISOString()} ===\n`);

  // Build a minimal loan.request payload
  const tip = parseInt(cli("getblockcount"));
  const requestPayload = {
    version: 3,
    iaddr: BORROWER_IA,
    target_lender_iaddr: LENDER_IA,
    principal: { currency: "DAI.vETH", amount: 5 },
    collateral: { currency: "VRSC", amount: 10 },
    repay: { currency: "DAI.vETH", amount: 5.05 },
    term_days: 30,
    auto_accept: false,    // simple metadata-only post — no real Tx-A skeleton needed
    posted_block: tip,
  };
  const hex = Buffer.from(JSON.stringify(requestPayload), "utf8").toString("hex");

  // Get borrower identity for updateidentity arg
  const borrower = cliJ(`getidentity ${BORROWER_IA} -1`).identity;
  const cm = borrower.contentmultimap || {};
  const newCm = {};
  for (const [k, arr] of Object.entries(cm)) {
    newCm[k] = (Array.isArray(arr) ? arr : [arr])
      .map((e) => typeof e === "string" ? e : (e?.serializedhex || e?.message || ""))
      .filter(Boolean);
  }
  newCm[VDXF_REQ] = [hex];
  const arg = JSON.stringify({ name: borrower.name, parent: borrower.parent || "", contentmultimap: newCm });

  console.log(`[T0] sending updateidentity from local (borrower) daemon…`);
  const T0 = Date.now();
  const txid = cli(`updateidentity '${arg.replace(/'/g, "'\\''")}'`);
  const T0_done = Date.now();
  console.log(`     tx ${txid.slice(0,16)}…  (RPC took ${fmt(T0_done - T0)})\n`);

  // T1: borrower's local daemon sees it
  console.log("[T1] polling borrower local daemon for mempool sighting…");
  const T1 = await pollUntil("local mempool", () => {
    try {
      const cm = cliJ(`getidentity ${BORROWER_IA} -1`).identity.contentmultimap || {};
      const ents = cm[VDXF_REQ] || [];
      return ents.some((e) => {
        const h = typeof e === "string" ? e : (e.serializedhex || e.message || "");
        try {
          const j = JSON.parse(Buffer.from(h, "hex").toString("utf8"));
          return j.target_lender_iaddr === LENDER_IA && j.posted_block === tip;
        } catch { return false; }
      });
    } catch { return false; }
  });
  console.log(`     T+${fmt(T1 - T0_done)}  borrower local daemon mempool sees it\n`);

  // T2: lender's REMOTE daemon sees it (P2P propagation)
  console.log("[T2] polling lender REMOTE daemon for mempool sighting (P2P gossip)…");
  const T2 = await pollUntil("remote mempool", () => {
    try {
      const cm = cliJ(`getidentity ${BORROWER_IA} -1`, true).identity.contentmultimap || {};
      const ents = cm[VDXF_REQ] || [];
      return ents.some((e) => {
        const h = typeof e === "string" ? e : (e.serializedhex || e.message || "");
        try {
          const j = JSON.parse(Buffer.from(h, "hex").toString("utf8"));
          return j.target_lender_iaddr === LENDER_IA && j.posted_block === tip;
        } catch { return false; }
      });
    } catch { return false; }
  }, 500);
  console.log(`     T+${fmt(T2 - T0_done)}  lender REMOTE daemon mempool sees it\n`);

  // T3: request confirms in a block
  console.log("[T3] polling for tx confirmation in a block…");
  const T3 = await pollUntil("confirmation", () => {
    try {
      return (cliJ(`gettransaction ${txid}`).confirmations ?? 0) >= 1;
    } catch { return false; }
  }, 2000);
  console.log(`     T+${fmt(T3 - T0_done)}  Tx confirmed in a block\n`);

  // T4: explorer surfaces it
  console.log("[T4] polling scan.verus.cx /contracts/loans/requests for the request…");
  const T4 = await pollUntil("explorer indexing", async () => {
    try {
      const r = await fetch("https://scan.verus.cx/api/contracts/loans/requests?pageSize=200");
      if (!r.ok) return false;
      const j = await r.json();
      return (j.results || []).some((x) =>
        x.iaddr === BORROWER_IA && x.posted_block === tip);
    } catch { return false; }
  }, 3000);
  console.log(`     T+${fmt(T4 - T0_done)}  scan.verus.cx surfaces it\n`);

  // ── Summary ─────────────────────────────────────────────────
  console.log("┌─────── visibility latencies (broadcast → first sighting) ────");
  console.log(`│ borrower local daemon mempool:   ${fmt(T1 - T0_done).padStart(8)}`);
  console.log(`│ lender REMOTE daemon mempool:    ${fmt(T2 - T0_done).padStart(8)}  ← P2P gossip`);
  console.log(`│ Tx confirmed in block:           ${fmt(T3 - T0_done).padStart(8)}  ← block production`);
  console.log(`│ scan.verus.cx explorer surfaces: ${fmt(T4 - T0_done).padStart(8)}  ← indexer lag after confirm`);
  console.log("└──────────────────────────────────────────────────────────────");

  // Cleanup: drop the request
  console.log("\ncleanup: dropping the test request entry…");
  delete newCm[VDXF_REQ];
  const cleanArg = JSON.stringify({ name: borrower.name, parent: borrower.parent || "", contentmultimap: newCm });
  const cleanTxid = cli(`updateidentity '${cleanArg.replace(/'/g, "'\\''")}'`);
  console.log(`  cleanup tx: ${cleanTxid.slice(0,16)}…`);
})();
