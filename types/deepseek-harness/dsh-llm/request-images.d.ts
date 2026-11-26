/** Retained request-image references and per-occurrence transport budgets. */
import type { ImageAttachmentRef, RequestImageAttachment } from '@deepseek-ai/dsh-attachment';
import type { ImageBlock, LlmFailure, LlmImageRequestBudget, RequestMessage } from './types.ts';
/**
 * Collect one reference per retained attachment for request encoding.
 * @param messages - request history with its logged offload decisions.
 * @returns the first retained reference for each attachment id, in message order.
 */
export declare function uniqueRequestImageRefs(messages: readonly RequestMessage[]): ImageAttachmentRef[];
/**
 * Number of oldest retained occurrences a route must still offload before a
 * derived request fits its budget at the exact byte length the route sends;
 * zero when the request fits. A route fails with `IMAGE_OFFLOAD_REQUIRED`
 * carrying this count instead of offloading on its own.
 * @param messages - derived request history carrying the surface's `offloaded` marks.
 * @param budget - route representation, budgets, and removal quanta.
 * @param versionBytes - exact request-version byte length of one retained occurrence.
 * @returns how many more leading retained occurrences to offload.
 */
export declare function requiredImageOffload(messages: readonly RequestMessage[], budget: Pick<LlmImageRequestBudget, 'representation' | 'maxBytes' | 'maxImages' | 'byteQuantum' | 'countQuantum'>, versionBytes: (block: ImageBlock) => number): number;
/**
 * Check every retained occurrence against the budget of the selected wire representation.
 * @param messages - request history, including any repeated or offloaded images.
 * @param versions - encoded request version for each retained attachment id.
 * @param budget - route limits for this transport attempt.
 * @param overflowMessage - adapter diagnostic identifying the exceeded budget.
 * @returns the structured offload failure, or undefined when the retained images fit.
 */
export declare function requestImageBudgetFailure(messages: readonly RequestMessage[], versions: ReadonlyMap<ImageAttachmentRef['attachmentId'], RequestImageAttachment>, budget: LlmImageRequestBudget, overflowMessage: string): LlmFailure | undefined;
//# sourceMappingURL=request-images.d.ts.map