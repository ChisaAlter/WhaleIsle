import { describe, expect, it } from "vitest";

import {
  ConnectionOfferSchema,
  DEFAULT_PUBLIC_STUN_URLS,
  decodeOfferFragmentPayload,
  getDefaultIceServers,
  parseConnectionOfferFromUrl,
  resolveOfferIceServers,
} from "./connection-offer.js";

function encodeBase64UrlNoPadUtf8(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

describe("connection offer", () => {
  it("decodes base64url JSON payloads", () => {
    const payload = {
      v: 2,
      serverId: "server-123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.chisacode.sh:443" },
    };

    expect(decodeOfferFragmentPayload(encodeBase64UrlNoPadUtf8(JSON.stringify(payload)))).toEqual(
      payload,
    );
  });

  it("parses connection offers from QR-style URLs", () => {
    const offer = ConnectionOfferSchema.parse({
      v: 2,
      serverId: "server-123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.chisacode.sh:443" },
    });
    const encoded = encodeBase64UrlNoPadUtf8(JSON.stringify(offer));

    expect(parseConnectionOfferFromUrl(`https://app.chisacode.sh/#offer=${encoded}`)).toEqual(
      offer,
    );
  });

  it("leaves relay TLS unset when absent", () => {
    expect(
      ConnectionOfferSchema.parse({
        v: 2,
        serverId: "server-123",
        daemonPublicKeyB64: "pubkey",
        relay: { endpoint: "relay.example.com:80" },
      }),
    ).toEqual({
      v: 2,
      serverId: "server-123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.example.com:80" },
    });
  });

  it("parses optional relay auth public key without requiring it for old offers", () => {
    expect(
      ConnectionOfferSchema.parse({
        v: 2,
        serverId: "server-123",
        daemonPublicKeyB64: "pubkey",
        relayAuthPublicKeyB64: "relay-auth-pubkey",
        relay: { endpoint: "relay.example.com:443" },
      }),
    ).toMatchObject({
      relayAuthPublicKeyB64: "relay-auth-pubkey",
    });
  });

  it("round-trips relay TLS in offers without rejecting extra relay fields", () => {
    const offer = ConnectionOfferSchema.parse({
      v: 2,
      serverId: "server-123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.example.com:443", useTls: true, extra: "future" },
    });
    const encoded = encodeBase64UrlNoPadUtf8(JSON.stringify(offer));

    expect(parseConnectionOfferFromUrl(`https://app.chisacode.sh/#offer=${encoded}`)).toEqual({
      v: 2,
      serverId: "server-123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.example.com:443", useTls: true },
    });
  });

  it("returns null when the URL has no offer fragment", () => {
    expect(parseConnectionOfferFromUrl("https://app.chisacode.sh/pair")).toBeNull();
  });

  it("accepts pure LAN offers without relay", () => {
    const offer = ConnectionOfferSchema.parse({
      v: 2,
      serverId: "server-lan",
      daemonPublicKeyB64: "pubkey",
      lan: { endpoints: ["192.168.1.10:3180"], useTls: false },
    });
    expect(offer.relay).toBeUndefined();
    expect(offer.lan).toEqual({ endpoints: ["192.168.1.10:3180"], useTls: false });
  });

  it("accepts hybrid LAN + relay offers with iceServers", () => {
    const offer = ConnectionOfferSchema.parse({
      v: 2,
      serverId: "server-hybrid",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "ayase.cn:443", useTls: true },
      lan: { endpoints: ["192.168.1.10:3180", "10.0.0.5:3180"] },
      iceServers: [
        { urls: "stun:stun.cloudflare.com:3478" },
        {
          urls: ["turn:turn.example.com:3478?transport=tcp"],
          username: "u",
          credential: "p",
        },
      ],
    });
    expect(offer.lan?.endpoints).toEqual(["192.168.1.10:3180", "10.0.0.5:3180"]);
    expect(offer.iceServers).toHaveLength(2);
  });

  it("rejects offers with neither relay nor lan endpoints", () => {
    expect(() =>
      ConnectionOfferSchema.parse({
        v: 2,
        serverId: "server-empty",
        daemonPublicKeyB64: "pubkey",
      }),
    ).toThrow(/relay\.endpoint|lan\.endpoints/i);

    expect(() =>
      ConnectionOfferSchema.parse({
        v: 2,
        serverId: "server-empty-lan",
        daemonPublicKeyB64: "pubkey",
        lan: { endpoints: [] },
      }),
    ).toThrow();
  });

  it("returns default public STUN servers when no custom ICE servers are provided", () => {
    expect(DEFAULT_PUBLIC_STUN_URLS).toEqual([
      "stun:stun.cloudflare.com:3478",
      "stun:stun.l.google.com:19302",
    ]);
    expect(getDefaultIceServers()).toEqual([
      { urls: "stun:stun.cloudflare.com:3478" },
      { urls: "stun:stun.l.google.com:19302" },
    ]);
    expect(resolveOfferIceServers(undefined, undefined)).toEqual(getDefaultIceServers());
    expect(
      resolveOfferIceServers([{ urls: "stun:offer.example.com:3478" }], [
        { urls: "turn:user.example.com:3478", username: "a", credential: "b" },
      ]),
    ).toEqual([
      { urls: "turn:user.example.com:3478", username: "a", credential: "b" },
      { urls: "stun:offer.example.com:3478" },
    ]);
  });
});
