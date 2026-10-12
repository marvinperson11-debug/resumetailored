'use strict';
/*
 * client-ip.js — the visitor's address for per-IP quotas.
 *
 * Production traffic is Cloudflare -> Railway edge -> app. Express's `req.ip`
 * (trust proxy = 1) resolves one hop back, which is the Cloudflare edge — a
 * shared address, not the visitor. Cloudflare puts the real client address in
 * `CF-Connecting-IP`, so that wins. When it is absent (local runs, the Railway
 * hostname hit directly, tests) we fall back to `req.ip` — which honours
 * X-Forwarded-For through Railway's proxy — and only then to the raw socket,
 * which behind Railway is the proxy's own address and is a last resort.
 *
 * Trust note: the header is only authoritative when the request really came
 * through Cloudflare. A caller that reaches the origin directly (the
 * *.up.railway.app hostname) can set it to anything, so a per-IP cap built on
 * this is a fairness control, not a security boundary.
 *
 * IPv6 clients are bucketed by /64: a single subscriber is handed that whole
 * block, so a per-address cap on an IPv6 address would be trivially rotated.
 *
 * Pure and dependency-free (node:net only); unit-tested in test/client-ip.js.
 */
const net = require('net');

function v6Prefix64(ip) {
  if (ip.includes('.')) return ip; // embedded-IPv4 forms other than ::ffff: are rare; keep as-is
  const halves = ip.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length > 1 ? Array(Math.max(0, 8 - head.length - tail.length)).fill('0') : [];
  const groups = head.concat(fill, tail).map((g) => g.padStart(4, '0'));
  return groups.slice(0, 4).join(':') + '::/64';
}

// Canonical form for a quota key, or null when `raw` is not an IP address.
function normalizeIp(raw) {
  if (typeof raw !== 'string') return null;
  let ip = raw.trim().toLowerCase();
  if (!ip) return null;
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  if (ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7))) ip = ip.slice(7);
  if (net.isIPv4(ip)) return ip;
  if (net.isIPv6(ip)) return v6Prefix64(ip);
  return null;
}

function getClientIp(req) {
  const h = req && req.headers ? req.headers['cf-connecting-ip'] : undefined;
  return normalizeIp(Array.isArray(h) ? h[0] : h)
    || normalizeIp(req && req.ip)
    || normalizeIp(req && req.socket && req.socket.remoteAddress)
    || 'unknown';
}

module.exports = { getClientIp, normalizeIp };
