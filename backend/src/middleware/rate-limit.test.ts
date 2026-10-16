import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ipBucket } from './rate-limit.js';

test('IPv6 addresses count per /64, IPv4 per address', () => {
  assert.equal(ipBucket('203.0.113.7'), '203.0.113.7');
  assert.equal(ipBucket('::ffff:203.0.113.7'), '203.0.113.7');
  // Every address a client can pick inside its /64 lands in one bucket.
  assert.equal(ipBucket('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:0db8:0001:0002::/64');
  assert.equal(ipBucket('2001:db8:1:2::1'), '2001:0db8:0001:0002::/64');
  assert.equal(ipBucket('2001:DB8:1:2:ffff::'), '2001:0db8:0001:0002::/64');
  assert.notEqual(ipBucket('2001:db8:1:3::1'), ipBucket('2001:db8:1:2::1'));
  assert.equal(ipBucket('::1'), '0000:0000:0000:0000::/64');
  assert.equal(ipBucket('fe80::1%eth0'), 'fe80:0000:0000:0000::/64');
  assert.equal(ipBucket(undefined), 'unknown');
  assert.equal(ipBucket('not-an-ip'), 'not-an-ip');
});
