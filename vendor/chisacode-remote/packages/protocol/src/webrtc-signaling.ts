import { z } from "zod/v3";

import { IceServerConfigSchema } from "./connection-offer.js";

export const RTC_DATA_CHANNEL_LABEL = "dsh";
export const RTC_MAX_SDP_BYTES = 128 * 1024;
export const RTC_NEGOTIATE_TIMEOUT_MS = 8_000;
export const RTC_NEGOTIATE_HOST_ONLY_TIMEOUT_MS = 4_000;
export const RTC_ACTIVATE_TIMEOUT_MS = 6_000;
export const RTC_ATTEMPT_TTL_MS = 20_000;
export const RTC_DRAIN_TIMEOUT_MS = 3_000;
export const RTC_LAN_PROBE_TIMEOUT_MS = 2_500;
export const RTC_UPGRADED_CLOSE_CODE = 1000;
export const RTC_UPGRADED_CLOSE_REASON = "upgraded_to_webrtc";
export const RTC_SERIAL_SEND_MAX_BYTES = 8 * 1024 * 1024;
export const RTC_SERIAL_SEND_MAX_FRAMES = 256;

export const TransportModeSchema = z.enum(["lan", "p2p", "turn", "relay"]);
export type TransportMode = z.infer<typeof TransportModeSchema>;

export const WebRtcTransportModeSchema = z.enum(["lan", "p2p", "turn"]);
export type WebRtcTransportMode = z.infer<typeof WebRtcTransportModeSchema>;

export const TRANSPORT_MODE_RANK: Readonly<Record<TransportMode, number>> = {
  lan: 3,
  p2p: 2,
  turn: 1,
  relay: 0,
};

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

const AttemptIdSchema = z.string().min(1).max(64);
const SdpSchema = z
  .string()
  .min(1)
  .refine((sdp) => utf8ByteLength(sdp) <= RTC_MAX_SDP_BYTES, {
    message: `SDP exceeds maximum size of ${RTC_MAX_SDP_BYTES} bytes`,
  });
const NonNegativeSeqSchema = z
  .number()
  .int()
  .nonnegative()
  .refine((n) => Number.isSafeInteger(n), {
    message: "Sequence number must be a safe non-negative integer",
  });

export const RtcIceCandidateInitSchema = z.object({
  candidate: z.string(),
  sdpMid: z.string().nullable().optional().transform((v) => v ?? null),
  sdpMLineIndex: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

export type RtcIceCandidateInit = {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
};

export const RtcUpgradeOfferMessageSchema = z.object({
  type: z.literal("rtc_upgrade_offer"),
  attemptId: AttemptIdSchema,
  sdp: SdpSchema,
});
export type RtcUpgradeOfferMessage = z.infer<typeof RtcUpgradeOfferMessageSchema>;

export const RtcUpgradeAnswerMessageSchema = z.object({
  type: z.literal("rtc_upgrade_answer"),
  attemptId: AttemptIdSchema,
  sdp: SdpSchema,
  iceServers: z.array(IceServerConfigSchema).optional(),
});
export type RtcUpgradeAnswerMessage = z.infer<typeof RtcUpgradeAnswerMessageSchema>;

export const RtcUpgradeIceMessageSchema = z.object({
  type: z.literal("rtc_upgrade_ice"),
  attemptId: AttemptIdSchema,
  candidate: RtcIceCandidateInitSchema.nullable(),
});
export type RtcUpgradeIceMessage = z.infer<typeof RtcUpgradeIceMessageSchema>;

export const RtcUpgradeActivateMessageSchema = z.object({
  type: z.literal("rtc_upgrade_activate"),
  attemptId: AttemptIdSchema,
  clientPreviousLegEndSeq: NonNegativeSeqSchema,
});
export type RtcUpgradeActivateMessage = z.infer<typeof RtcUpgradeActivateMessageSchema>;

export const RtcUpgradeActivatedMessageSchema = z.object({
  type: z.literal("rtc_upgrade_activated"),
  attemptId: AttemptIdSchema,
  mode: WebRtcTransportModeSchema,
  hostPreviousLegEndSeq: NonNegativeSeqSchema,
});
export type RtcUpgradeActivatedMessage = z.infer<typeof RtcUpgradeActivatedMessageSchema>;

export const RtcUpgradeAbortMessageSchema = z.object({
  type: z.literal("rtc_upgrade_abort"),
  attemptId: AttemptIdSchema,
  reason: z.string().max(256).optional(),
});
export type RtcUpgradeAbortMessage = z.infer<typeof RtcUpgradeAbortMessageSchema>;

export const RtcUpgradeClientMessageSchema = z.discriminatedUnion("type", [
  RtcUpgradeOfferMessageSchema,
  RtcUpgradeIceMessageSchema,
  RtcUpgradeActivateMessageSchema,
  RtcUpgradeAbortMessageSchema,
]);
export type RtcUpgradeClientMessage = z.infer<typeof RtcUpgradeClientMessageSchema>;

export const RtcUpgradeHostMessageSchema = z.discriminatedUnion("type", [
  RtcUpgradeAnswerMessageSchema,
  RtcUpgradeIceMessageSchema,
  RtcUpgradeActivatedMessageSchema,
  RtcUpgradeAbortMessageSchema,
]);
export type RtcUpgradeHostMessage = z.infer<typeof RtcUpgradeHostMessageSchema>;

export const RtcUpgradeMessageSchema = z.discriminatedUnion("type", [
  RtcUpgradeOfferMessageSchema,
  RtcUpgradeAnswerMessageSchema,
  RtcUpgradeIceMessageSchema,
  RtcUpgradeActivateMessageSchema,
  RtcUpgradeActivatedMessageSchema,
  RtcUpgradeAbortMessageSchema,
]);
export type RtcUpgradeMessage = z.infer<typeof RtcUpgradeMessageSchema>;

const RTC_UPGRADE_TYPES = new Set<string>([
  "rtc_upgrade_offer",
  "rtc_upgrade_answer",
  "rtc_upgrade_ice",
  "rtc_upgrade_activate",
  "rtc_upgrade_activated",
  "rtc_upgrade_abort",
]);

export function isRtcUpgradeMessageType(type: unknown): boolean {
  return typeof type === "string" && RTC_UPGRADE_TYPES.has(type);
}

export function tryParseRtcUpgradeClientMessage(value: unknown): RtcUpgradeClientMessage | null {
  const parsed = RtcUpgradeClientMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function tryParseRtcUpgradeHostMessage(value: unknown): RtcUpgradeHostMessage | null {
  const parsed = RtcUpgradeHostMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
