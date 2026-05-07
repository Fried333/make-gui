// Per-loan vault key derivation via additive tweak.
//
//   tweak       = SHA256(R_pub || loan_id) mod n
//   vault_priv  = (R_priv + tweak) mod n
//   vault_pub   = R_pub + tweak·G        (= vault_priv·G)
//
// where loan_id is the borrower's collateral-split txid (32 bytes),
// public on chain in the loan.request payload.
//
// Lets a user who only backed up their R-address privkey re-derive every
// loan's vault privkey from chain data alone — no wallet seed needed.
//
// Uses BigInt for scalar arithmetic and a minimal pure-JS secp256k1
// pubkey-derivation routine (the wallet still does all signing — we only
// need point math to compute pubkeys + addresses for the multisig).

// secp256k1 params
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const Gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const Gy = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

// Verus VRSC mainnet WIF prefix (privkey export). 0x80 (Bitcoin) + 0x3C
// (VRSC pubkey-hash) → 0xBC. Confirmed by decoding a known dumpprivkey.
const WIF_VERSION = 0xbc;

// ---------- bytes / hex helpers ----------

function bytesToHex(bytes) {
  let h = '';
  for (const b of bytes) h += b.toString(16).padStart(2, '0');
  return h;
}
function hexToBytes(hex) {
  if (hex.length % 2) throw new Error('odd hex length');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function bytesToBigInt(bytes) {
  return bytes.length === 0 ? 0n : BigInt('0x' + bytesToHex(bytes));
}
function bigIntToBytes(n, len = 32) {
  let h = n.toString(16);
  if (h.length > len * 2) throw new Error('bigint too large');
  while (h.length < len * 2) h = '0' + h;
  return hexToBytes(h);
}
function concatBytes(...arrs) {
  const total = arrs.reduce((a, x) => a + x.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

// ---------- SHA256 (browser native) ----------

async function sha256(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(buf);
}
async function sha256Twice(bytes) {
  return sha256(await sha256(bytes));
}

// ---------- modular arithmetic ----------

function mod(a, m) {
  const r = a % m;
  return r >= 0n ? r : r + m;
}
function modInv(a, m) {
  // Extended Euclidean
  let [g, x] = [m, 0n];
  let [g2, x2] = [mod(a, m), 1n];
  while (g2 !== 0n) {
    const q = g / g2;
    [g, g2] = [g2, g - q * g2];
    [x, x2] = [x2, x - q * x2];
  }
  if (g !== 1n) throw new Error('not invertible');
  return mod(x, m);
}

// ---------- secp256k1 affine point math ----------

const POINT_AT_INFINITY = { inf: true };

function pointDouble(P1) {
  if (P1.inf) return POINT_AT_INFINITY;
  // λ = (3x²) / (2y)
  const num = mod(3n * P1.x * P1.x, P);
  const den = mod(2n * P1.y, P);
  const lam = mod(num * modInv(den, P), P);
  const x3 = mod(lam * lam - 2n * P1.x, P);
  const y3 = mod(lam * (P1.x - x3) - P1.y, P);
  return { x: x3, y: y3 };
}
function pointAdd(P1, P2) {
  if (P1.inf) return P2;
  if (P2.inf) return P1;
  if (P1.x === P2.x) {
    if (mod(P1.y + P2.y, P) === 0n) return POINT_AT_INFINITY;
    return pointDouble(P1);
  }
  // λ = (y₂ - y₁) / (x₂ - x₁)
  const num = mod(P2.y - P1.y, P);
  const den = mod(P2.x - P1.x, P);
  const lam = mod(num * modInv(den, P), P);
  const x3 = mod(lam * lam - P1.x - P2.x, P);
  const y3 = mod(lam * (P1.x - x3) - P1.y, P);
  return { x: x3, y: y3 };
}
function scalarMult(k, P1) {
  if (k <= 0n || k >= N) k = mod(k, N);
  let result = POINT_AT_INFINITY;
  let addend = P1;
  while (k > 0n) {
    if (k & 1n) result = pointAdd(result, addend);
    addend = pointDouble(addend);
    k >>= 1n;
  }
  return result;
}

// 33-byte compressed pubkey: 0x02 (even y) or 0x03 (odd y) || x (32 bytes)
function pointToCompressedHex(point) {
  if (point.inf) throw new Error('point at infinity');
  const prefix = (point.y & 1n) === 0n ? '02' : '03';
  return prefix + point.x.toString(16).padStart(64, '0');
}
function compressedHexToPoint(hex) {
  if (hex.length !== 66) throw new Error('compressed pubkey must be 33 bytes hex');
  const prefix = hex.slice(0, 2);
  const x = BigInt('0x' + hex.slice(2));
  // y² = x³ + 7
  let y2 = mod(x * x * x + 7n, P);
  // Tonelli-Shanks for p ≡ 3 (mod 4): y = y2^((p+1)/4)
  let y = modPow(y2, (P + 1n) / 4n, P);
  if (mod(y * y, P) !== y2) throw new Error('not on curve');
  const yIsOdd = (y & 1n) === 1n;
  if ((prefix === '03') !== yIsOdd) y = P - y;
  return { x, y };
}
function modPow(base, exp, m) {
  let result = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp & 1n) result = mod(result * base, m);
    exp >>= 1n;
    base = mod(base * base, m);
  }
  return result;
}

const G = { x: Gx, y: Gy };

// privkey (BigInt or 32 bytes) → 33-byte compressed pubkey hex
export function pubkeyFromPriv(privBytesOrBigInt) {
  const k = typeof privBytesOrBigInt === 'bigint' ? privBytesOrBigInt : bytesToBigInt(privBytesOrBigInt);
  if (k <= 0n || k >= N) throw new Error('priv out of range');
  return pointToCompressedHex(scalarMult(k, G));
}

// ---------- base58check ----------

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    const r = n % 58n;
    n /= 58n;
    out = B58_ALPHABET[Number(r)] + out;
  }
  for (const b of bytes) {
    if (b === 0) out = '1' + out; else break;
  }
  return out;
}
function base58Decode(str) {
  let n = 0n;
  for (const c of str) {
    const i = B58_ALPHABET.indexOf(c);
    if (i < 0) throw new Error(`invalid base58 char: ${c}`);
    n = n * 58n + BigInt(i);
  }
  const arr = [];
  while (n > 0n) {
    arr.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const c of str) {
    if (c === '1') arr.unshift(0); else break;
  }
  return new Uint8Array(arr);
}

// ---------- WIF (Wallet Import Format) ----------

export async function wifEncode(priv32, compressed = true) {
  if (priv32.length !== 32) throw new Error('priv must be 32 bytes');
  const ext = new Uint8Array(compressed ? 34 : 33);
  ext[0] = WIF_VERSION;
  ext.set(priv32, 1);
  if (compressed) ext[33] = 0x01;
  const checksum = (await sha256Twice(ext)).slice(0, 4);
  return base58Encode(concatBytes(ext, checksum));
}

export async function wifDecode(wif) {
  const bytes = base58Decode(wif);
  if (bytes.length !== 37 && bytes.length !== 38) {
    throw new Error(`bad WIF length: ${bytes.length}`);
  }
  const payload = bytes.slice(0, -4);
  const checksum = bytes.slice(-4);
  const expected = (await sha256Twice(payload)).slice(0, 4);
  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== expected[i]) throw new Error('WIF checksum mismatch');
  }
  return {
    version: payload[0],
    priv: payload.slice(1, 33),
    compressed: payload.length === 34,
  };
}

// ---------- the actual derivation ----------

// tweak = SHA256(R_pub || loan_id) mod N
export async function computeTweak(rPubHex, loanIdHex) {
  if (rPubHex.length !== 66) throw new Error('R_pub must be 33 bytes (compressed) hex');
  if (loanIdHex.length !== 64) throw new Error('loan_id must be 32 bytes hex');
  const concat = hexToBytes(rPubHex + loanIdHex);
  const t = mod(bytesToBigInt(await sha256(concat)), N);
  if (t === 0n) throw new Error('tweak is zero (cosmically unlikely)');
  return t;
}

// vault_priv = (R_priv + tweak) mod N
export async function tweakedPriv(rPriv32, rPubHex, loanIdHex) {
  const tweak = await computeTweak(rPubHex, loanIdHex);
  const rPrivInt = bytesToBigInt(rPriv32);
  if (rPrivInt === 0n || rPrivInt >= N) throw new Error('R_priv out of range');
  const vaultInt = mod(rPrivInt + tweak, N);
  if (vaultInt === 0n) throw new Error('vault priv is zero');
  return bigIntToBytes(vaultInt, 32);
}

// vault_pub = R_pub + tweak·G
export async function tweakedPub(rPubHex, loanIdHex) {
  const tweak = await computeTweak(rPubHex, loanIdHex);
  const rPubPoint = compressedHexToPoint(rPubHex);
  const tweakPoint = scalarMult(tweak, G);
  return pointToCompressedHex(pointAdd(rPubPoint, tweakPoint));
}

// Self-test on import: verify scalarMult(1)=G, that wifEncode/Decode round-
// trips a known privkey, and that tweakedPriv·G == tweakedPub for a
// canonical (R_priv, loan_id) pair. Throws on any mismatch — caller
// should call this before relying on the helpers in production paths.
export async function selfTest() {
  // 1. G·1 == G
  const g1 = scalarMult(1n, G);
  if (g1.x !== Gx || g1.y !== Gy) throw new Error('selfTest: G·1 != G');
  // 2. pubkeyFromPriv(1) == compress(G)
  const expectedG = '02' + Gx.toString(16).padStart(64, '0');
  if (pubkeyFromPriv(1n) !== expectedG) throw new Error('selfTest: pubkey(1) != G_compressed');
  // 3. priv=2: 2·G is a known point
  // 2·G.x = 0xc6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5
  const p2 = scalarMult(2n, G);
  if (p2.x !== 0xc6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5n) {
    throw new Error('selfTest: 2·G has wrong x');
  }
  // 4. WIF round-trip
  const priv32 = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
  const wif = await wifEncode(priv32);
  const dec = await wifDecode(wif);
  if (bytesToHex(dec.priv) !== '0000000000000000000000000000000000000000000000000000000000000001') {
    throw new Error('selfTest: WIF roundtrip');
  }
  if (!dec.compressed) throw new Error('selfTest: WIF compressed flag');
  // 5. Tweak coherence: tweakedPriv·G should equal tweakedPub
  const dummyRPriv = hexToBytes('0000000000000000000000000000000000000000000000000000000000000007');
  const dummyRPub = pubkeyFromPriv(dummyRPriv);
  const loanId = '11dd011b7376a8c5978591e09950a284111442d32aa5e56265334e103b3d7a19';
  const vp = await tweakedPriv(dummyRPriv, dummyRPub, loanId);
  const vpub = await tweakedPub(dummyRPub, loanId);
  if (pubkeyFromPriv(vp) !== vpub) {
    throw new Error('selfTest: tweakedPriv·G != tweakedPub');
  }
  return { ok: true };
}
