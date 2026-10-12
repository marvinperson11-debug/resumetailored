#!/usr/bin/env node
/**
 * client-ip.js — which address a per-IP quota keys on. Pure (no server boot).
 *   node test/client-ip.js
 */
const { getClientIp, normalizeIp } = require('../client-ip');
const TOOLS = require('../tools-core.js');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const req = (headers, ip, remote) => ({ headers: headers || {}, ip, socket: { remoteAddress: remote } });

// CF-Connecting-IP wins over req.ip (which behind Cloudflare is the CF edge).
check('prefers CF-Connecting-IP over req.ip', getClientIp(req({ 'cf-connecting-ip': '203.0.113.7' }, '172.70.1.1', '10.0.0.2')) === '203.0.113.7');
check('falls back to req.ip when the header is absent', getClientIp(req({}, '198.51.100.9', '10.0.0.2')) === '198.51.100.9');
check('falls back to the socket address last', getClientIp(req({}, undefined, '10.0.0.2')) === '10.0.0.2');
check('garbage header is ignored, not trusted', getClientIp(req({ 'cf-connecting-ip': 'not-an-ip' }, '198.51.100.9')) === '198.51.100.9');
check('whitespace around the header is trimmed', getClientIp(req({ 'cf-connecting-ip': '  203.0.113.7 ' }, '1.1.1.1')) === '203.0.113.7');
check('duplicate header values use the first', getClientIp(req({ 'cf-connecting-ip': ['203.0.113.7', '9.9.9.9'] }, '1.1.1.1')) === '203.0.113.7');
check('nothing usable => stable "unknown" bucket', getClientIp(req({}, undefined, undefined)) === 'unknown');
check('IPv4-mapped IPv6 normalizes to IPv4', normalizeIp('::ffff:203.0.113.7') === '203.0.113.7');
check('same visitor, mapped or plain, same key', getClientIp(req({}, '::ffff:203.0.113.7')) === getClientIp(req({}, '203.0.113.7')));
// IPv6: one subscriber owns a /64, so every address inside it is one visitor.
check('IPv6 buckets by /64', normalizeIp('2001:db8:aaaa:bbbb:1:2:3:4') === normalizeIp('2001:DB8:AAAA:BBBB:ffff:0:0:1'));
check('different /64s stay different', normalizeIp('2001:db8:aaaa:bbbb::1') !== normalizeIp('2001:db8:aaaa:bbbc::1'));
check('compressed IPv6 expands before bucketing', normalizeIp('2001:db8::1') === '2001:0db8:0000:0000::/64');
check('IPv6 zone id is dropped', normalizeIp('fe80::1%eth0') === normalizeIp('fe80::1'));
check('non-string input is null', normalizeIp(undefined) === null && normalizeIp(42) === null);

// Guest vs member caps (tools-core.capFor).
check('jobDecode: guest 3/day', TOOLS.capFor(TOOLS.LIMITS.jobDecode, false) === 3);
check('jobDecode: free member 10/day', TOOLS.capFor(TOOLS.LIMITS.jobDecode, true) === 10);
check('keywordExtract: guest 10/day', TOOLS.capFor(TOOLS.LIMITS.keywordExtract, false) === 10);
check('keywordExtract: free member 30/day', TOOLS.capFor(TOOLS.LIMITS.keywordExtract, true) === 30);
check('limit with no guest key applies free to both tiers (followUp)', TOOLS.capFor(TOOLS.LIMITS.followUp, false) === TOOLS.LIMITS.followUp.free && TOOLS.capFor(TOOLS.LIMITS.followUp, true) === TOOLS.LIMITS.followUp.free);
check('unmetered limit has no cap', TOOLS.capFor(TOOLS.LIMITS.salaryNegotiation, false) === undefined);
check('null limit has no cap', TOOLS.capFor(null, false) === undefined);

if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nALL PASS');
