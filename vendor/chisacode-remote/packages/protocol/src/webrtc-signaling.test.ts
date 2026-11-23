import { describe, expect, it } from "vitest";

import {
  RTC_MAX_SDP_BYTES,
  TRANSPORT_MODE_RANK,
  isRtcUpgradeMessageType,
  tryParseRtcUpgradeClientMessage,
  tryParseRtcUpgradeHostMessage,
} from "./webrtc-signaling.js";

describe("webrtc-signaling schemas", () => {
  it("parses all valid client->host signaling messages", () => {
    expect(
      tryParseRtcUpgradeClientMessage({
        type: "rtc_upgrade_offer",
        attemptId: "att-1",
        sdp: "v=0\r\n",
      }),
    ).toEqual({
      type: "rtc_upgrade_offer",
      attemptId: "att-1",
      sdp: "v=0\r\n",
    });

    expect(
      tryParseRtcUpgradeClientMessage({
        type: "rtc_upgrade_ice",
        attemptId: "att-1",
        candidate: { candidate: "candidate:1 1 UDP 1 192.168.1.2 5000 typ host", sdpMid: "0", sdpMLineIndex: 0 },
      }),
    ).toEqual({
      type: "rtc_upgrade_ice",
      attemptId: "att-1",
      candidate: { candidate: "candidate:1 1 UDP 1 192.168.1.2 5000 typ host", sdpMid: "0", sdpMLineIndex: 0 },
    });

    expect(
      tryParseRtcUpgradeClientMessage({
        type: "rtc_upgrade_ice",
        attemptId: "att-1",
        candidate: null,
      }),
    ).toEqual({
      type: "rtc_upgrade_ice",
      attemptId: "att-1",
      candidate: null,
    });

    expect(
      tryParseRtcUpgradeClientMessage({
        type: "rtc_upgrade_activate",
        attemptId: "att-1",
        clientPreviousLegEndSeq: 42,
      }),
    ).toEqual({
      type: "rtc_upgrade_activate",
      attemptId: "att-1",
      clientPreviousLegEndSeq: 42,
    });

    expect(
      tryParseRtcUpgradeClientMessage({
        type: "rtc_upgrade_abort",
        attemptId: "att-1",
        reason: "timeout",
      }),
    ).toEqual({
      type: "rtc_upgrade_abort",
      attemptId: "att-1",
      reason: "timeout",
    });
  });

  it("parses all valid host->client signaling messages", () => {
    expect(
      tryParseRtcUpgradeHostMessage({
        type: "rtc_upgrade_answer",
        attemptId: "att-1",
        sdp: "v=0\r\n",
        iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
      }),
    ).toEqual({
      type: "rtc_upgrade_answer",
      attemptId: "att-1",
      sdp: "v=0\r\n",
      iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
    });

    expect(
      tryParseRtcUpgradeHostMessage({
        type: "rtc_upgrade_activated",
        attemptId: "att-1",
        mode: "p2p",
        hostPreviousLegEndSeq: 17,
      }),
    ).toEqual({
      type: "rtc_upgrade_activated",
      attemptId: "att-1",
      mode: "p2p",
      hostPreviousLegEndSeq: 17,
    });
  });

  it("rejects oversized SDP, invalid attemptId, and invalid mode", () => {
    expect(
      tryParseRtcUpgradeClientMessage({
        type: "rtc_upgrade_offer",
        attemptId: "att-1",
        sdp: "a".repeat(RTC_MAX_SDP_BYTES + 1),
      }),
    ).toBeNull();

    expect(
      tryParseRtcUpgradeClientMessage({
        type: "rtc_upgrade_offer",
        attemptId: "a".repeat(65),
        sdp: "v=0\r\n",
      }),
    ).toBeNull();

    expect(
      tryParseRtcUpgradeHostMessage({
        type: "rtc_upgrade_activated",
        attemptId: "att-1",
        mode: "relay",
        hostPreviousLegEndSeq: 0,
      }),
    ).toBeNull();
  });

  it("ranks transport modes correctly and recognizes upgrade types", () => {
    expect(TRANSPORT_MODE_RANK.lan).toBeGreaterThan(TRANSPORT_MODE_RANK.p2p);
    expect(TRANSPORT_MODE_RANK.p2p).toBeGreaterThan(TRANSPORT_MODE_RANK.turn);
    expect(TRANSPORT_MODE_RANK.turn).toBeGreaterThan(TRANSPORT_MODE_RANK.relay);
    expect(isRtcUpgradeMessageType("rtc_upgrade_offer")).toBe(true);
    expect(isRtcUpgradeMessageType("rtc_upgrade_activated")).toBe(true);
    expect(isRtcUpgradeMessageType("hello")).toBe(false);
  });
});
