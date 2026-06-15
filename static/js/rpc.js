// Thin RPC client. Talks to /rpc on the local server which forwards to verusd.

let nextId = 1;

// Diagnostic: trace every updateidentity call to help track down the
// "borrower cm goes empty after Loan B request" mystery (#101). Logs the
// caller location, the cm keys we're about to commit, the acting iaddr,
// and a high-res timestamp to both the console AND a localStorage ring
// buffer (so the trace survives a page-close).
// Cheap (only runs for updateidentity, only does string ops). Remove once
// the bug is found.
function _traceUpdateIdentity(params) {
  try {
    const arg = (params || [])[0] || {};
    const cm = arg.contentmultimap || {};
    const cmKeys = Object.keys(cm);
    const stack = (new Error().stack || "").split("\n").slice(2, 7).join(" | ");
    const entry = {
      t: Date.now(),
      iso: new Date().toISOString(),
      name: arg.name,
      parent: arg.parent,
      cmKeys,
      cmEmpty: cmKeys.length === 0,
      stack,
    };
    console.warn(`[ui-trace] updateidentity name=${arg.name} cmKeys=${JSON.stringify(cmKeys)}`, entry);
    const ring = JSON.parse(localStorage.getItem("vl_ui_trace") || "[]");
    ring.push(entry);
    while (ring.length > 100) ring.shift();
    localStorage.setItem("vl_ui_trace", JSON.stringify(ring));
  } catch {}
}

// Short-TTL coalesce cache for read-only RPCs that loadMarket may call
// 5+ times for the same args within one render cycle. Each loadMarket on a
// slow daemon (.44 over SSH tunnel ≈ 1.3s per getidentity) was making 5
// sequential getidentity(iaddr,-1) calls for the same iaddr — total 6-8s
// just for the daemon walk. Coalescing collapses concurrent identical
// calls to one promise + 2s result reuse. Write/state-mutating methods
// (updateidentity, sendrawtransaction, sendcurrency, signrawtransaction,
// dumpprivkey, addmultisigaddress, z_*) bypass entirely.
const COALESCE_METHODS = new Set([
  "getidentity",
  "getidentityhistory",
  "getaddressutxos",
  "getaddressbalance",
  "getaddressmempool",
  "getrawmempool",
  "getblockcount",
  "getinfo",
  "validateaddress",
  "listidentities",
  "gettxout",
  "getrawtransaction",
  "createmultisig",
  "estimateconversion",
  "decoderawtransaction",
]);
const COALESCE_TTL_MS = 2000;
const _rpcCache = new Map();   // key → { at, result }
const _rpcInflight = new Map(); // key → Promise

export async function rpc(method, params = []) {
  if (method === "updateidentity") _traceUpdateIdentity(params);

  // Coalesce path for read-only methods.
  let cacheKey = null;
  if (COALESCE_METHODS.has(method)) {
    cacheKey = method + ":" + JSON.stringify(params);
    const cached = _rpcCache.get(cacheKey);
    if (cached && (Date.now() - cached.at) < COALESCE_TTL_MS) return cached.result;
    const inflight = _rpcInflight.get(cacheKey);
    if (inflight) return inflight;
  }

  const body = {
    jsonrpc: "1.0",
    id: nextId++,
    method,
    params,
  };
  const doFetch = (async () => {
  const res = await fetch("/rpc", {
    method: "POST",
    // X-Requested-By is the CSRF guard — the server rejects /rpc without it.
    // Browsers preflight requests with non-safelisted headers, blocking
    // cross-origin POST attempts from a hostile page.
    headers: { "Content-Type": "application/json", "X-Requested-By": "vlocal" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // Non-JSON response (often the daemon dying or HTTP-level error). Surface
    // the method + status so the call site / browser console pinpoints the
    // failing call instead of just "500 Internal Server Error".
    console.error(`[rpc] ${method} → ${res.status} ${res.statusText}: non-JSON response: ${text.slice(0, 300)}`);
    throw new Error(`${method} (${res.status}): non-JSON response: ${text.slice(0, 200)}`);
  }
  if (json.error) {
    console.error(`[rpc] ${method} → error:`, json.error);
    throw new Error(`${method}: ${json.error.message || JSON.stringify(json.error)}`);
  }
  return json.result;
  })();
  if (cacheKey) {
    _rpcInflight.set(cacheKey, doFetch);
    doFetch.then(
      (result) => { _rpcCache.set(cacheKey, { at: Date.now(), result }); },
      () => {} // errors not cached — let the next call retry
    ).finally(() => { _rpcInflight.delete(cacheKey); });
  }
  return doFetch;
}

export async function ping() {
  try {
    const info = await rpc("getinfo");
    return { ok: true, blocks: info.blocks, version: info.version };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Decode a raw tx hex to its inputs/outputs (calls verusd).
export async function decodeRawTx(hex) {
  return rpc("decoderawtransaction", [hex]);
}

// Resolve an i-address to a VerusID friendly name (or return the i-address if not found).
const idCache = new Map();
export async function resolveId(addrOrId) {
  if (!addrOrId) return addrOrId;
  if (idCache.has(addrOrId)) return idCache.get(addrOrId);
  if (!addrOrId.startsWith("i")) {
    idCache.set(addrOrId, addrOrId);
    return addrOrId;
  }
  try {
    const r = await rpc("getidentity", [addrOrId]);
    const name = r?.identity?.name ? `${r.identity.name}@` : addrOrId;
    idCache.set(addrOrId, name);
    return name;
  } catch {
    idCache.set(addrOrId, addrOrId);
    return addrOrId;
  }
}
