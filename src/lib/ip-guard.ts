import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import net from "node:net";

import { AppError } from "./errors";

/**
 * Blocks requests to private/internal networks. This endpoint fetches a URL
 * supplied by the user, so without these checks it would be a textbook SSRF
 * hole: anyone could reach cloud metadata services, loopback ports, or other
 * hosts on the internal network the app is running on.
 */

// IPv4 ranges that must never be reachable: [network address, prefix length].
const BLOCKED_V4: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8], // 0.0.0.0/8        "this network"
  [0x0a000000, 8], // 10.0.0.0/8       private
  [0x64400000, 10], // 100.64.0.0/10    carrier-grade NAT
  [0x7f000000, 8], // 127.0.0.0/8      loopback
  [0xa9fe0000, 16], // 169.254.0.0/16   link-local (cloud metadata lives here)
  [0xac100000, 12], // 172.16.0.0/12    private
  [0xc0000000, 24], // 192.0.0.0/24     IETF protocol assignments
  [0xc0000200, 24], // 192.0.2.0/24     TEST-NET-1
  [0xc0a80000, 16], // 192.168.0.0/16   private
  [0xc6120000, 15], // 198.18.0.0/15    benchmarking
  [0xc6336400, 24], // 198.51.100.0/24  TEST-NET-2
  [0xcb007100, 24], // 203.0.113.0/24   TEST-NET-3
  [0xe0000000, 4], // 224.0.0.0/4      multicast
  [0xf0000000, 4], // 240.0.0.0/4      reserved + 255.255.255.255
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function isBlockedV4Number(value: number): boolean {
  return BLOCKED_V4.some(([network, prefix]) => {
    if (prefix === 0) return false;
    const mask = (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) >>> 0 === (network & mask) >>> 0;
  });
}

/**
 * Expands any IPv6 notation into its 8 hextets, including `::` compression,
 * zone suffixes (`fe80::1%eth0`) and the dotted-quad tail (`::ffff:127.0.0.1`).
 * Returns null when the input is not a valid address.
 */
function parseIPv6(input: string): number[] | null {
  let addr = input;
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);

  // Rewrite a trailing dotted-quad into two hex groups.
  const lastColon = addr.lastIndexOf(":");
  const tail = addr.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = ipv4ToInt(tail);
    if (v4 === null) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    addr = `${addr.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const toHextet = (group: string): number =>
    /^[0-9a-f]{1,4}$/i.test(group) ? parseInt(group, 16) : Number.NaN;

  const compression = addr.indexOf("::");
  let groups: string[];

  if (compression === -1) {
    groups = addr.split(":");
    if (groups.length !== 8) return null;
  } else {
    // "::" may only appear once, and must stand for at least one zero group.
    if (addr.indexOf("::", compression + 1) !== -1) return null;
    const head = addr.slice(0, compression);
    const rest = addr.slice(compression + 2);
    const headGroups = head ? head.split(":") : [];
    const tailGroups = rest ? rest.split(":") : [];
    const fill = 8 - headGroups.length - tailGroups.length;
    if (fill < 1) return null;
    groups = [...headGroups, ...Array<string>(fill).fill("0"), ...tailGroups];
  }

  const hextets = groups.map(toHextet);
  if (hextets.length !== 8 || hextets.some(Number.isNaN)) return null;
  return hextets;
}

function isBlockedV6(hextets: number[]): boolean {
  const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets;

  // :: (unspecified) and ::1 (loopback)
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0 && h6 === 0) {
    return true;
  }

  // IPv4-mapped ::ffff:0:0/96 — judge the embedded IPv4 address.
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff) {
    return isBlockedV4Number((h6 << 16) | h7);
  }

  // IPv4-compatible ::/96 (deprecated, but still routable in some stacks)
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
    return isBlockedV4Number((h6 << 16) | h7);
  }

  // NAT64 well-known prefix 64:ff9b::/96, and its local-use 64:ff9b:1::/48.
  if (h0 === 0x0064 && h1 === 0xff9b) {
    if (h2 === 1) return true;
    if (h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
      return isBlockedV4Number((h6 << 16) | h7);
    }
  }

  // 100::/64 discard-only
  if (h0 === 0x0100 && h1 === 0 && h2 === 0 && h3 === 0) return true;

  // 2001::/23 IETF protocol assignments (covers Teredo at 2001::/32)
  if (h0 === 0x2001 && (h1 & 0xfe00) === 0) return true;

  // 2001:db8::/32 documentation
  if (h0 === 0x2001 && h1 === 0x0db8) return true;

  // 2002::/16 6to4 — judge the embedded IPv4 address.
  if (h0 === 0x2002) return isBlockedV4Number((h1 << 16) | h2);

  // fc00::/7 unique local addresses
  if ((h0 & 0xfe00) === 0xfc00) return true;

  // fe80::/10 link-local (includes fe80::/64 for IPv4 mapping at fe80::a.b.c.d)
  if ((h0 & 0xffc0) === 0xfe80) return true;

  // ff00::/8 multicast
  if ((h0 & 0xff00) === 0xff00) return true;

  return false;
}

/** Fails closed: anything that isn't a recognised public address is blocked. */
export function isBlockedAddress(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    const value = ipv4ToInt(ip);
    return value === null ? true : isBlockedV4Number(value);
  }
  if (version === 6) {
    const hextets = parseIPv6(ip);
    return hextets === null ? true : isBlockedV6(hextets);
  }
  return true;
}

/**
 * Resolves a hostname and rejects it if any address it maps to is private.
 * IP literals are checked directly so `http://127.0.0.1` never hits DNS.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  if (net.isIP(hostname) !== 0) {
    if (isBlockedAddress(hostname)) {
      throw new AppError(
        "That address points to a private or internal network.",
        "BLOCKED_ADDRESS",
        400,
      );
    }
    return;
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new AppError(
      `Could not resolve "${hostname}".`,
      "DNS_FAILURE",
      400,
    );
  }

  if (addresses.length === 0) {
    throw new AppError(
      `Could not resolve "${hostname}".`,
      "DNS_FAILURE",
      400,
    );
  }

  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new AppError(
        "That hostname resolves to a private or internal network.",
        "BLOCKED_ADDRESS",
        400,
      );
    }
  }
}
