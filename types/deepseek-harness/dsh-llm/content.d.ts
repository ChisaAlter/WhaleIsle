/** Content-block structure helpers. @module @deepseek-ai/dsh-llm/content */
import type { ContentBlock, ToolSchema, ToolUpdate, ToolHistory } from './types.ts';
import type { RequestMessage } from './types.ts';
import type { Message } from './message.ts';
import type { AttachmentStore, FileAttachmentRef, ImageAttachmentRef, RequestImageAttachment } from '@deepseek-ai/dsh-attachment';
import { ToolCallId } from './brand.ts';
/** Provider-compatible function-name grammar shared by calls and registrations. */
export declare const TOOL_NAME_PATTERN: RegExp;
/**
 * Check the identity at the model or durable-history boundary.
 * @param id - provider call id.
 * @param name - provider function name.
 * @returns whether both are valid.
 */
export declare function isValidToolCallIdentity(id: unknown, name: unknown): boolean;
/**
 * Reject an invalid completed provider call without inventing its identity.
 * @param id - provider call id.
 * @param name - provider function name.
 * @returns validated identity.
 */
export declare function requireValidToolCallIdentity(id: unknown, name: unknown): {
    id: ToolCallId;
    name: string;
};
export { requiredImageOffload } from './request-images.ts';
/** Execution-world path that model tools can use to read one normalized attachment. */
export interface ImageAttachmentAccess {
    /** Absolute path to immutable normalized bytes; callers must treat it as read-only. */
    readonlyPath: string;
}
/**
 * Resolve current execution-world access for one durable image reference.
 * @param ref - durable normalized attachment reference.
 * @returns a read-only execution-world path, or undefined when unavailable.
 */
export type ImageAttachmentAccessResolver = (ref: ImageAttachmentRef) => ImageAttachmentAccess | undefined;
/**
 * Bridge one attachment provider's host object location into the mounted
 * tool execution world. The consumer supplies the current filesystem
 * provider's mapping without making attachment or LLM definitions depend on it.
 * @param attachments - provider that owns the normalized attachment object.
 * @param mapHostPath - map one absolute host path into the current tool execution world.
 * @param ref - durable normalized attachment reference.
 * @returns a read-only execution-world path, or undefined when either provider exposes no mapping.
 * @throws an attachment error when the durable reference is invalid.
 */
export declare function resolveImageAttachmentAccess(attachments: AttachmentStore, mapHostPath: (hostPath: string) => string | undefined, ref: ImageAttachmentRef): ImageAttachmentAccess | undefined;
/**
 * Stable text shown to a model that cannot accept one durable image reference.
 * @param ref - durable normalized attachment omitted from the request.
 * @returns deterministic text-only placeholder.
 */
export declare function textOnlyImageText(ref: ImageAttachmentRef): string;
/**
 * Stable model-facing handle for one exact request image. Identity comes from
 * the occurrence's own durable reference: request versions are prepared per
 * attachment id, so one shared version may serve occurrences whose display
 * names differ.
 * @param ref - the occurrence's durable normalized attachment.
 * @param version - exact request-image dimensions shown beside the text.
 * @param access - optional path resolved for the current tool execution world.
 * @returns attachment handle and request-image dimensions.
 */
export declare function requestImageHandleText(ref: ImageAttachmentRef, version: Pick<RequestImageAttachment, 'width' | 'height'>, access?: ImageAttachmentAccess): string;
/**
 * Stable per-image placeholder for a request-limit omission.
 * @param ref - durable normalized attachment omitted from this request.
 * @param access - optional provider-resolved path for model tools.
 * @returns identity, normalized metadata, and the available recovery path.
 */
export declare function offloadedImageText(ref: ImageAttachmentRef, access?: ImageAttachmentAccess): string;
/**
 * True when typed model content contains an image block. This is the one image
 * walk shared by every image policy (capability gating, text-only
 * serialization, compaction survey), so a consumer cannot silently diverge.
 * @param content - typed model content blocks.
 * @returns whether any block is an image.
 */
export declare function contentHasImage(content: readonly ContentBlock[]): boolean;
/**
 * True when typed model content contains a file block.
 * Reads current content on every call without retaining scan results.
 * @param content - typed model content blocks.
 * @returns whether any block is a file.
 */
export declare function contentHasFile(content: readonly ContentBlock[]): boolean;
/**
 * Stable model-facing handle for one durable file reference: the address of
 * the verbatim stored copy and the instruction to read it on demand. This is
 * the only representation a provider ever receives for a file.
 * @param ref - durable verbatim file reference.
 * @param readonlyPath - execution-world path of the stored copy, when resolvable.
 * @returns deterministic handle text naming the file, its size, and its address.
 */
export declare function fileHandleText(ref: FileAttachmentRef, readonlyPath: string | undefined): string;
/**
 * Project request file content into deterministic handle text for every model
 * route. Unlike images, no provider receives file blocks natively, so this
 * projection is unconditional in request assembly.
 * @param messages - complete request history.
 * @param resolvePath - resolve one reference's current execution-world read path.
 * @returns the original list without files, otherwise shallow message copies with handle text.
 */
export declare function projectFilesToText(messages: readonly Message[], resolvePath: (ref: FileAttachmentRef) => string | undefined): readonly Message[];
/**
 * Project file content in mixed durable and request-only inputs.
 * @param messages - complete request inputs.
 * @param resolvePath - resolve a reference's execution-world read path.
 * @returns original inputs without files, otherwise copies with handle text.
 */
export declare function projectFilesToText(messages: readonly RequestMessage[], resolvePath: (ref: FileAttachmentRef) => string | undefined): readonly RequestMessage[];
/**
 * Project the surface's offloaded occurrences into deterministic text for one
 * request. The offloaded set is a durable surface fact, so every route sends
 * the same set; only the placeholder text is route-owned.
 * @param messages - derived request history.
 * @param placeholder - build the model-visible replacement for one offloaded attachment.
 * @returns the original list when nothing is offloaded, otherwise shallow message copies with placeholders.
 */
export declare function projectOffloadedImages(messages: readonly Message[], placeholder: (ref: ImageAttachmentRef) => string): readonly Message[];
/**
 * Project offloaded images in mixed durable and request-only inputs.
 * @param messages - complete request inputs.
 * @param placeholder - replacement text for an offloaded attachment.
 * @returns original messages or shallow copies with placeholders.
 */
export declare function projectOffloadedImages(messages: readonly RequestMessage[], placeholder: (ref: ImageAttachmentRef) => string): readonly RequestMessage[];
/**
 * Project request image content into deterministic text for an exact text-only model.
 * @param messages - complete request history.
 * @returns the original list without images, otherwise shallow message copies with stable placeholders.
 */
export declare function projectImagesForTextModel(messages: readonly Message[]): readonly Message[];
/**
 * Project image content in mixed durable and request-only inputs for a text-only model.
 * @param messages - complete request inputs.
 * @returns original inputs without images, otherwise copies with stable placeholders.
 */
export declare function projectImagesForTextModel(messages: readonly RequestMessage[]): readonly RequestMessage[];
/** Request messages and tools after one route's tool update projection. */
export interface ProjectedToolUpdates {
    /** History with only the developer updates supported by this route and declaration series. */
    readonly messages: readonly RequestMessage[];
    /** Provider declarations, including deferred and retained definitions when supported. */
    readonly tools: readonly ToolSchema[] | undefined;
}
/**
 * Construct provider declarations from session-folded history without changing logged active tools.
 * Unsupported routes and incomplete history use current declarations without developer updates.
 * Explicitly deferred declarations require an addition to activate them.
 * A rebuild makes previously activated declarations immediate; unactivated declarations stay deferred.
 * Addition-only routes rebuild when a tool is removed or tools are added to an empty set;
 * deferred declarations count as existing tools.
 * Later additions remain deferred and superseded tool blocks are omitted without dropping other content.
 * @param messages - complete request inputs, or the prefix selected for an auxiliary call.
 * @param tools - currently active tool schemas.
 * @param toolUpdate - the resolved route's update mode.
 * @param history - immutable state folded from committed headers and developer messages.
 * @returns provider declarations and the corresponding filtered history.
 */
export declare function projectToolUpdates(messages: readonly RequestMessage[], tools: readonly ToolSchema[] | undefined, toolUpdate: ToolUpdate | undefined, history?: ToolHistory): ProjectedToolUpdates;
//# sourceMappingURL=content.d.ts.map