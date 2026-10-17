import http from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { UsageError } from './i18n.mjs';

// Where an image comes from when it is not a local file: an http(s) URL or base64 data.

// The largest image accepted from a URL or as base64.
export const MAX_BYTES = 50 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 30_000;
export const MAX_REDIRECTS = 5;

export const isUrl = (s) => typeof s === 'string' && /^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^[a-z]:[\\/]/i.test(s);

// Loopback, private, link-local, carrier-grade NAT, multicast and reserved ranges, IPv4-mapped IPv6
// included. A server reachable from the network must not be turned into a proxy into them.
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  BLOCKED.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  // Unspecified, loopback and IPv4-compatible addresses (::a.b.c.d).
  ['::', 96],
  // NAT64 (well-known and local-use prefixes), 6to4 and Teredo all carry an IPv4 address that can
  // reach a private network; none is needed to fetch a public image.
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['2002::', 16],
  ['2001::', 32],
  // Old site-local, discard-only and documentation ranges, unique local, link-local, multicast.
  ['fec0::', 10],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]) {
  BLOCKED.addSubnet(net, prefix, 'ipv6');
}

export function isPrivateAddress(address) {
  const family = isIP(address);
  if (!family) return true;
  if (family === 4) return BLOCKED.check(address, 'ipv4');
  // IPv4-mapped IPv6 ("::ffff:127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1"): check the IPv4
  // address inside. The URL parser writes every spelling in the short hex form.
  const short = new URL(`http://[${address.replace(/%.*$/, '')}]`).hostname.slice(1, -1);
  if (short.startsWith('::ffff:')) {
    const tail = short.slice('::ffff:'.length);
    if (isIP(tail) === 4) return BLOCKED.check(tail, 'ipv4');
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(tail);
    if (!hex) return true;
    const [hi, lo] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
    return BLOCKED.check(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, 'ipv4');
  }
  return BLOCKED.check(address, 'ipv6');
}

// dns.lookup that refuses private addresses. It runs inside the connection, so the address checked is
// the address used (no window for DNS rebinding between a check and the request).
function safeLookup(hostname, options, callback) {
  dnsLookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const list = Array.isArray(address) ? address : [{ address, family }];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad) return callback(Object.assign(new UsageError(`${hostname} resolves to a private or loopback address (${bad.address}); only public URLs are fetched here`), { code: 'PRIVATE_ADDRESS' }));
    callback(null, address, family);
  });
}

const hostOf = (url) => url.hostname.replace(/^\[|\]$/g, '');

// Our own agents, so a proxy from the environment (NODE_USE_ENV_PROXY with HTTP_PROXY / HTTPS_PROXY)
// is never used: through a proxy the address check would see the proxy, not the image host.
const AGENTS = { 'http:': new http.Agent(), 'https:': new https.Agent() };

// Downloads an image: http and https only (https only with httpsOnly), at most MAX_REDIRECTS
// redirects, MAX_BYTES, and FETCH_TIMEOUT_MS for the whole download, redirects included. With
// allowPrivate false (HTTP mode), loopback and private addresses are refused, for the first URL and
// for every redirect.
export async function fetchImage(url, { allowPrivate = true, httpsOnly = false, maxBytes = MAX_BYTES, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  let current;
  try {
    current = new URL(url);
  } catch {
    throw new UsageError(`not a valid URL: ${url}`);
  }
  for (let hop = 0; ; hop++) {
    if (current.protocol !== 'https:' && current.protocol !== 'http:') throw new UsageError(`only http and https URLs are fetched, not ${current.protocol}`);
    if (httpsOnly && current.protocol !== 'https:') throw new UsageError(`only https URLs are fetched on this server, not ${current.protocol}${hop ? ' (after a redirect)' : ''}`);
    if (current.username || current.password) throw new UsageError('URLs with a user name or password are not fetched');
    if (!allowPrivate && isIP(hostOf(current)) && isPrivateAddress(hostOf(current))) {
      throw new UsageError(`${current.hostname} is a private or loopback address; only public URLs are fetched here`);
    }
    const res = await get(current, { allowPrivate, deadline, maxBytes });
    if (res.redirect) {
      if (hop >= MAX_REDIRECTS) throw new UsageError(`more than ${MAX_REDIRECTS} redirects: ${url}`);
      current = new URL(res.redirect, current);
      continue;
    }
    return { buffer: res.buffer, mime: res.mime, url: current.href };
  }
}

function get(url, { allowPrivate, deadline, maxBytes }) {
  const left = deadline - Date.now();
  if (left <= 0) return Promise.reject(new UsageError(`download timed out: ${url.href}`));
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let req;
    let res;
    let timer;
    let done = false;
    // Settles once; stops the clock and drops the connection on failure.
    const finish = (fn, value, abort) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (abort) {
        res?.destroy();
        req?.destroy();
      }
      fn(value);
    };
    const tooBig = () => finish(reject, new UsageError(`image is larger than ${Math.round(maxBytes / 1048576)} MB: ${url.href}`), true);
    // A deadline for the whole download, not an idle timeout: a server that sends one byte at a time
    // cannot hold a request open for longer than this.
    timer = setTimeout(() => finish(reject, new UsageError(`download timed out: ${url.href}`), true), left);
    const options = { agent: AGENTS[url.protocol], headers: { 'user-agent': 'ai-content-labels', accept: 'image/*' }, ...(!allowPrivate && { lookup: safeLookup }) };
    req = client.get(url, options, (response) => {
      res = response;
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return finish(resolve, { redirect: res.headers.location });
      }
      if (status !== 200) {
        res.resume();
        return finish(reject, new UsageError(`download failed: HTTP ${status} for ${url.href}`));
      }
      if (Number(res.headers['content-length']) > maxBytes) return tooBig();
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) tooBig();
        else chunks.push(chunk);
      });
      res.on('end', () => finish(resolve, { buffer: Buffer.concat(chunks), mime: res.headers['content-type'] ?? null }));
      res.on('error', (e) => finish(reject, new UsageError(`download failed: ${e.message}`), true));
      res.on('aborted', () => finish(reject, new UsageError(`download failed: connection closed: ${url.href}`), true));
    });
    req.on('error', (e) => finish(reject, e instanceof UsageError ? e : new UsageError(`download failed: ${e.message}`), true));
  });
}

// Base64 image data, with or without a data: URL prefix ("data:image/png;base64,...").
export function decodeBase64(data, mime) {
  if (typeof data !== 'string' || !data.length) throw new UsageError('input_base64 must be a non-empty base64 string');
  let body = data.trim();
  let type = mime ?? null;
  const prefix = /^data:([^;,]*)(;[^,]*)?,/i.exec(body);
  if (prefix) {
    if (!/;base64/i.test(prefix[2] ?? '')) throw new UsageError('a data: URL in input_base64 must be base64-encoded');
    type ??= prefix[1] || null;
    body = body.slice(prefix[0].length);
  }
  body = body.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(body)) throw new UsageError('input_base64 is not valid base64');
  if (Math.floor((body.length * 3) / 4) > MAX_BYTES + 3) throw new UsageError(`image is larger than ${MAX_BYTES / 1048576} MB`);
  const buffer = Buffer.from(body, 'base64');
  if (!buffer.length) throw new UsageError('input_base64 decodes to nothing');
  return { buffer, mime: type };
}
