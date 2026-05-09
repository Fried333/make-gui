// Timing-instrumented visibility test (lean version).
//
// Measures end-to-end propagation: each broadcast → counterparty's GUI
// first sighting. Drops the loan.offer step (offer form has finicky
// chip-style fields); the meaningful timings are around request/match/
// accept which mirror what you typically care about.
//
// Phases:
//   T0  test starts (browsers ready)
//   T1  borrower broadcasts loan.request (target_lender_iaddr=lender)
//   T2  lender's daemon mempool sees it (P2P propagation)
//   T3  lender's GUI surfaces the request (Fund panel auto-loads)
//   T4  lender broadcasts loan.match
//   T5  lender's daemon mempool sees own match
//   T6  borrower's GUI surfaces the match
//   T7  Tx-A broadcast (auto-accept fired) — loan.status appears
//   T8  Tx-A confirms in a block
//
// Final report: deltas + which path each sighting used (mempool merge
// via -1 vs explorer's confirmed view).

import { chromium } from "playwright";
import { execSync } from "child_process";

const BORROWER_GUI = "http://127.0.0.1:7777/";
const LENDER_GUI   = "http://127.0.0.1:7778/";
const BORROWER_IA  = "i7b7Tq8JYXX9iqS7FBevC6LaG3ioh8z3RM";
const LENDER_IA    = "i7A9fa8c3xZnA3uLK3SLYa58cUipganewg";

const VDXF = {
  request: "iFg76F9M8CV5xEg3L2NvCDBXufaxjUWhaW",
  match:   "i4G69W7e3UJRCinuP7TFBRnm3ZUiXzPkFt",
  status:  "iPnrakyY951QEy6xUYBuJoobHA9JKY6G8j",
};
const VERUS = "/home/dev/Downloads/verus-cli-v1.2.16/verus";
const CONF  = "/home/dev/.komodo/VRSC/VRSC.conf";
const SSH   = `ssh -p 2400 -i ${process.env.HOME}/.ssh/id_ed25519 -o IdentitiesOnly=yes root@86.107.168.44`;
const REMOTE_VERUS = "/root/verus-cli-v1.2.16/verus";
const REMOTE_CONF  = "/root/.komodo/VRSC/VRSC.conf";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt   = (ms) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

function cli(cmd, remote = false) {
  const cmdStr = remote
    ? `${SSH} "${REMOTE_VERUS} -conf=${REMOTE_CONF} ${cmd.replace(/"/g, '\\"')}"`
    : `${VERUS} -conf=${CONF} ${cmd}`;
  return execSync(cmdStr, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024, stdio: ["pipe","pipe","pipe"] }).trim();
}
const cliJ = (cmd, remote = false) => JSON.parse(cli(cmd, remote));
const multimapOf = (iaddr, remote = false) =>
  cliJ(`getidentity ${iaddr} -1`, remote).identity?.contentmultimap || {};
const decode = (e) => {
  const h = typeof e === "string" ? e : (e?.serializedhex || e?.message || "");
  if (!h) return null;
  try { return JSON.parse(Buffer.from(h, "hex").toString("utf8")); } catch { return null; }
};

async function pollUntil(predicate, intervalMs = 500) {
  while (true) {
    const r = await predicate();
    if (r) return r;
    await sleep(intervalMs);
  }
}

async function openPage(url, iaddr, label) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("dialog", async (d) => await d.accept());
  page.on("pageerror", (e) => console.log(`    [${label} pageerror] ${e.message}`));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#mp-r-picker", { timeout: 15000 });
  await sleep(1500);
  await page.evaluate((t) => {
    const s = document.getElementById("mp-id-picker");
    s.value = t;
    s.dispatchEvent(new Event("change"));
  }, iaddr);
  await sleep(3000);
  return { browser, page };
}

const events = [];
function record(name, t = Date.now()) {
  events.push({ name, t });
  return t;
}

(async () => {
  console.log(`\n=== timing-visibility test — ${new Date().toISOString()} ===\n`);

  const T0 = record("test start");
  console.log("opening borrower + lender browsers…");
  const { browser: bb, page: bp } = await openPage(BORROWER_GUI, BORROWER_IA, "borrower");
  const { browser: lb, page: lp } = await openPage(LENDER_GUI,   LENDER_IA,   "lender");
  console.log(`  T+${fmt(Date.now() - T0)} — both pages ready\n`);

  try {
    // ── Phase A: borrower posts request, time when lender sees it ──
    console.log("[A] borrower posts loan.request (target_lender_iaddr=lender)…");
    await bp.evaluate(() => document.querySelector('[data-mp-tab="market"]').click());
    await bp.waitForSelector('#mp-post-request', { timeout: 30000 });
    await bp.click('#mp-post-request');
    await bp.waitForFunction(() => {
      const el = document.getElementById("mp-id-info");
      return el && el.dataset && el.dataset.iaddr;
    }, { timeout: 30000 });
    await bp.evaluate((lender) => {
      const f = document.getElementById("mp-post-form");
      const setVal = (sel, v) => { const el = f.querySelector(sel); if (el) { el.value = v; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); } };
      setVal('[data-f="target_lender"]', lender);
      setVal('[data-f="principal_amount"]', "5");
      setVal('[data-f="principal_currency"]', "DAI.vETH");
      setVal('[data-f="collateral_amount"]', "10");
      setVal('[data-f="collateral_currency"]', "VRSC");
      setVal('[data-f="repay_amount"]', "5.05");
      setVal('[data-f="term_days"]', "30");
      const auto = f.querySelector('[data-f="auto_accept"]');
      if (auto) auto.checked = true;
    }, LENDER_IA);
    await bp.click('[data-mp-do="preview-request"]');
    await pollUntil(async () => await bp.evaluate(() => {
      const f = document.getElementById("mp-post-form");
      const btn = Array.from(f.querySelectorAll('button')).find(b => /broadcast/i.test(b.textContent));
      return btn && !btn.disabled;
    }));
    await bp.evaluate(() => {
      const btn = Array.from(document.getElementById("mp-post-form").querySelectorAll('button')).find(b => /broadcast/i.test(b.textContent));
      btn.click();
    });
    const T1 = record("[A1] borrower broadcast request");
    console.log(`  T+${fmt(T1 - T0)} — broadcast issued`);

    // T2: borrower's local daemon sees it
    await pollUntil(() => (multimapOf(BORROWER_IA)[VDXF.request] || []).length > 0);
    const T2a = record("[A2] borrower daemon mempool has it");
    console.log(`  T+${fmt(T2a - T0)} — borrower local daemon mempool has request (Δ from broadcast: ${fmt(T2a - T1)})`);

    // T2b: REMOTE lender's daemon sees it (P2P propagation)
    await pollUntil(() => (multimapOf(BORROWER_IA, true)[VDXF.request] || []).length > 0);
    const T2b = record("[A3] lender's daemon (remote) mempool has it");
    console.log(`  T+${fmt(T2b - T0)} — lender's REMOTE daemon mempool has request (Δ from broadcast: ${fmt(T2b - T1)})  [P2P gossip]`);

    // T3: lender's GUI surfaces the request (Fund panel auto-loads)
    await lp.evaluate(() => document.querySelector('[data-mp-tab="loans"]').click());
    await pollUntil(async () => {
      await lp.evaluate(() => document.getElementById("market-refresh")?.click());
      await sleep(1500);
      return await lp.evaluate(() => !!document.querySelector('[data-mp-row-act="post-match-go"]'));
    }, 1500);
    const T3 = record("[A4] lender's GUI Fund panel ready");
    console.log(`  T+${fmt(T3 - T0)} — lender's GUI Fund panel rendered (Δ from broadcast: ${fmt(T3 - T1)})`);

    // ── Phase B: lender posts match, time when borrower sees it ──
    console.log("\n[B] lender clicks Confirm — broadcasts loan.match…");
    await lp.evaluate(() => document.querySelector('[data-mp-row-act="post-match-go"]').click());
    const T4 = record("[B1] lender clicked Confirm");
    console.log(`  T+${fmt(T4 - T0)} — Confirm clicked`);

    await pollUntil(() => (multimapOf(LENDER_IA, true)[VDXF.match] || []).length > 0);
    const T5 = record("[B2] lender daemon mempool has match");
    console.log(`  T+${fmt(T5 - T0)} — lender daemon mempool has match (Δ from click: ${fmt(T5 - T4)})`);

    // T5b: BORROWER's daemon sees the lender's match
    await pollUntil(() => (multimapOf(LENDER_IA)[VDXF.match] || []).length > 0);
    const T5b = record("[B3] borrower's daemon (local) mempool has match");
    console.log(`  T+${fmt(T5b - T0)} — borrower's daemon mempool has match (Δ from broadcast: ${fmt(T5b - T5)})  [P2P gossip]`);

    // T6: borrower's GUI surfaces it
    await bp.evaluate(() => document.querySelector('[data-mp-tab="loans"]').click());
    await pollUntil(async () => {
      await bp.evaluate(() => document.getElementById("market-refresh")?.click());
      await sleep(1500);
      return await bp.evaluate(() => !!document.querySelector('.mp-row[data-match-key]'));
    }, 1500);
    const T6 = record("[B4] borrower's GUI sees match");
    console.log(`  T+${fmt(T6 - T0)} — borrower's GUI sees match (Δ from broadcast: ${fmt(T6 - T5)})`);

    // ── Phase C: auto-accept fires, Tx-A broadcast ─────────────
    console.log("\n[C] waiting for auto-accept watcher → Tx-A broadcast…");
    const status = await pollUntil(() => {
      const cm = multimapOf(BORROWER_IA);
      const ents = (cm[VDXF.status] || []).map(decode).filter(Boolean);
      return ents.find((s) => s.match_iaddr === LENDER_IA && s.active === true);
    }, 1000);
    const T7 = record("[C1] auto-accept fired, loan.status active");
    console.log(`  T+${fmt(T7 - T0)} — auto-accept fired + Tx-A broadcast (Δ from match seen: ${fmt(T7 - T6)})`);
    console.log(`  loan_id: ${status.loan_id?.slice(0,16)}…`);

    // ── Phase D: Tx-A confirms ─────────────────────────────────
    console.log("\n[D] waiting for Tx-A to confirm in a block…");
    await pollUntil(() => {
      try {
        return (cliJ(`gettransaction ${status.loan_id}`).confirmations ?? 0) >= 1;
      } catch { return false; }
    }, 3000);
    const T8 = record("[D1] Tx-A confirmed in block");
    console.log(`  T+${fmt(T8 - T0)} — Tx-A confirmed (Δ from broadcast: ${fmt(T8 - T7)})`);

  } finally {
    await bb.close();
    await lb.close();
  }

  // ── Summary ─────────────────────────────────────────────────
  console.log("\n┌─────── timeline ────────────────────────────────────────────");
  for (const e of events) {
    console.log(`│ T+${fmt(e.t - events[0].t).padStart(7)}  ${e.name}`);
  }
  console.log("└──────────────────────────────────────────────────────────────\n");

  const evt = (n) => events.find((x) => x.name === n);
  const Δ = (a, b) => evt(a) && evt(b) ? fmt(evt(b).t - evt(a).t) : "—";
  console.log("┌─────── key visibility latencies ───────────────────────────");
  console.log(`│ borrower broadcast req → lender daemon mempool:  ${Δ("[A1] borrower broadcast request", "[A3] lender's daemon (remote) mempool has it")}  (P2P gossip)`);
  console.log(`│ borrower broadcast req → lender GUI sees it:     ${Δ("[A1] borrower broadcast request", "[A4] lender's GUI Fund panel ready")}  (mempool-merge or explorer)`);
  console.log(`│ lender broadcast match → borrower daemon mempool: ${Δ("[B1] lender clicked Confirm", "[B3] borrower's daemon (local) mempool has match")}  (P2P gossip)`);
  console.log(`│ lender broadcast match → borrower GUI sees it:   ${Δ("[B1] lender clicked Confirm", "[B4] borrower's GUI sees match")}  (mempool-merge or explorer)`);
  console.log(`│ match seen → Tx-A broadcast (auto-accept):       ${Δ("[B4] borrower's GUI sees match", "[C1] auto-accept fired, loan.status active")}`);
  console.log(`│ Tx-A broadcast → confirmed in block:             ${Δ("[C1] auto-accept fired, loan.status active", "[D1] Tx-A confirmed in block")}  (block production)`);
  console.log("└──────────────────────────────────────────────────────────────\n");
})();
