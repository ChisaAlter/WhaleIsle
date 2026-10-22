import { randomBytes } from "node:crypto";
import { mkdir, readdir, realpath, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
//#region lib/index.js
/**
* Node half of `dsh-plugin-codex-ui`.
*
* The browser half can neither touch the harness filesystem nor mint
* directories, but the skin's headline gesture is "start a chat without
* choosing a project" — which needs a real working directory to exist before a
* session can be rooted in it. This half therefore exposes three routes over
* HTTP:
*
*   - allocate one disposable working directory under the harness home, which
*     is what a project-less chat lives in;
*   - report that directory's root, which is how the browser tells a workspace
*     this skin minted from one the reader registered on purpose;
*   - delete directories this plugin allocated, which is what rolls a fresh
*     directory back when the Host refuses the workspace or the session it was
*     minted for, and what the browser half's cleanup uses to reclaim a chat
*     that was started and then abandoned without ever being used.
*
* Every route is a plain `exact` route rather than a generated Remote
* namespace, because an out-of-tree plugin has no codegen step and each payload
* is a short JSON object.
*
* The allocation root is deliberately NOT the `scratch` directory another
* sidebar skin uses: two plugins sharing one root would let either one's
* cleanup delete the other's live session directories. Names are entirely
* server-generated and the root is fixed, so no caller-supplied path ever
* reaches the filesystem:
*
*   - allocation never accepts a path from the caller;
*   - deletion accepts NAMES only, each validated as a single path segment and
*     re-checked for containment after resolution, and the root itself is never
*     a deletion target.
*/
/** The web server must exist before `apply` runs. */
const inject = ["webServer"];
/** Allocation route (`POST` allocates, `GET` reports the root and its entries). */
const SCRATCH_PATH = "/dsh-codex-ui/scratch";
/** Deletion route (one `POST` with a name list). */
const SCRATCH_DELETE_PATH = "/dsh-codex-ui/scratch/delete";
/** Upper bound on one request body, so a malformed caller cannot buffer without limit. */
const MAX_BODY_BYTES = 64 * 1024;
/** Upper bound on one deletion request, so one call cannot sweep an unbounded list. */
const MAX_DELETE_NAMES = 200;
/**
* Directory under the harness home that holds every project-less working
* directory. Distinct from any other skin's root by design (see module doc).
*/
const SCRATCH_DIR_NAME = "codex-workspaces";
/**
* Resolve the harness home the same way the harness itself does at its default
* precedence: an explicit `$DSH_HOME`, then `~/.dsh`.
* @returns the absolute harness home path.
*/
function dshHome() {
	const configured = process.env.DSH_HOME;
	if (typeof configured === "string" && configured.trim() !== "") return path.resolve(configured.trim());
	return path.join(homedir(), ".dsh");
}
/**
* The one directory project-less working directories are minted under.
* @returns the absolute allocation root path.
*/
function scratchRoot() {
	return path.join(dshHome(), SCRATCH_DIR_NAME);
}
/**
* Canonical spelling of an existing path, or the input when it cannot be
* resolved.
* @param {string} target - a path to resolve.
* @returns the resolved path.
*/
async function canonical(target) {
	try {
		return await realpath(target);
	} catch (error) {
		return target;
	}
}
/**
* Canonical spelling of the allocation root, resolved even before the directory
* exists by resolving its parent and re-joining the leaf.
*
* The returned path becomes a session's working directory, and the browser
* matches that value against the root to tell a project-less session from a
* project one. The harness stores working directories canonicalized, so
* reporting an uncanonicalized root would break that test wherever the harness
* home sits behind a symlink — `/tmp` on macOS is the everyday case.
* @returns the canonical allocation root path.
*/
async function canonicalScratchRoot() {
	const root = scratchRoot();
	return path.join(await canonical(path.dirname(root)), path.basename(root));
}
/**
* `YYYYMMDD-HHmmss` in local time, so a directory name reads as the moment it
* was created for the person who created it.
* @param {Date} at - the instant to stamp.
* @returns the compact local timestamp.
*/
function stamp(at) {
	const pad = (value) => String(value).padStart(2, "0");
	return `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
}
/** @param {unknown} error @returns {string} */
function messageOf(error) {
	if (error !== null && typeof error === "object" && typeof error.message === "string") return error.message;
	return String(error);
}
/**
* Write one JSON response.
* @param {import('node:http').ServerResponse} res - the response to own.
* @param {number} status - HTTP status.
* @param {unknown} payload - JSON-serializable body.
*/
function send(res, status, payload) {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": String(Buffer.byteLength(body)),
		"cache-control": "no-store"
	});
	res.end(body);
}
/**
* Read and parse a JSON request body, refusing oversized or malformed input
* instead of buffering it.
* @param {import('node:http').IncomingMessage} req - the incoming request.
* @returns {Promise<object>} the parsed object ({} for an empty body).
*/
async function readJson(req) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		total += chunk.length;
		if (total > MAX_BODY_BYTES) throw new Error("request body is too large");
		chunks.push(chunk);
	}
	if (total === 0) return {};
	const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("request body must be a JSON object");
	return parsed;
}
/**
* Answer the allocation `GET`: the root plus every directory currently minted
* under it, newest first. The browser uses this to tell which sessions are
* project-less and to offer cleanup of directories nothing references.
* @param {import('node:http').ServerResponse} res - the response to own.
*/
async function handleScratchList(res) {
	const root = scratchRoot();
	const reported = await canonicalScratchRoot();
	let names = [];
	try {
		names = await readdir(root);
	} catch (error) {
		send(res, 200, {
			root: reported,
			items: []
		});
		return;
	}
	const items = [];
	for (const entry of names) {
		if (entry.startsWith(".")) continue;
		const target = path.join(root, entry);
		let info;
		try {
			info = await stat(target);
		} catch (error) {
			continue;
		}
		if (!info.isDirectory()) continue;
		items.push({
			name: entry,
			path: path.join(reported, entry),
			createdAt: info.birthtimeMs || info.mtimeMs
		});
	}
	items.sort((left, right) => right.createdAt - left.createdAt);
	send(res, 200, {
		root: reported,
		items
	});
}
/**
* Answer the allocation `POST`: mint one fresh working directory and return its
* absolute path. The name is entirely server-generated, so no caller input can
* steer where the directory lands.
* @param {import('node:http').ServerResponse} res - the response to own.
*/
async function handleScratchAllocate(res) {
	const root = scratchRoot();
	await mkdir(root, { recursive: true });
	const at = /* @__PURE__ */ new Date();
	for (let attempt = 0; attempt < 2; attempt++) {
		const suffix = randomBytes(2).toString("hex");
		const leaf = `${stamp(at)}${attempt === 0 ? "" : `-${attempt}`}-${suffix}`;
		const target = path.join(root, leaf);
		try {
			await mkdir(target);
		} catch (error) {
			if (error !== null && typeof error === "object" && error.code === "EEXIST") continue;
			throw error;
		}
		send(res, 201, {
			name: leaf,
			path: await canonical(target),
			root: await canonicalScratchRoot(),
			createdAt: at.getTime()
		});
		return;
	}
	send(res, 500, { error: "could not allocate a working directory" });
}
/**
* Answer the deletion `POST`: remove the named working directories.
*
* Names are validated as single path segments and re-checked after resolution,
* so a crafted name can neither traverse nor reach the root itself. Nothing
* outside the allocation root is ever reachable, and every name not provably
* inside it is reported as skipped rather than attempted.
* @param {import('node:http').IncomingMessage} req - the incoming request.
* @param {import('node:http').ServerResponse} res - the response to own.
*/
async function handleScratchDelete(req, res) {
	const body = await readJson(req);
	const names = Array.isArray(body.names) ? body.names : [];
	if (names.length === 0) {
		send(res, 400, { error: "names must be a non-empty array" });
		return;
	}
	if (names.length > MAX_DELETE_NAMES) {
		send(res, 400, { error: "too many names in one request" });
		return;
	}
	const root = path.resolve(await canonicalScratchRoot());
	const deleted = [];
	const skipped = [];
	for (const candidate of names) {
		if (typeof candidate !== "string" || candidate === "" || candidate === "." || candidate === ".." || candidate.includes("/") || candidate.includes("\\") || candidate.includes("\0")) {
			skipped.push(String(candidate));
			continue;
		}
		const target = path.resolve(root, candidate);
		if (target === root || !target.startsWith(root + path.sep)) {
			skipped.push(candidate);
			continue;
		}
		try {
			await rm(target, {
				recursive: true,
				force: true
			});
			deleted.push(candidate);
		} catch (error) {
			skipped.push(candidate);
		}
	}
	send(res, 200, {
		deleted,
		skipped
	});
}
/**
* Dispatch one allocation-root request by method and sub-path.
* @param {import('node:http').IncomingMessage} req - the incoming request.
* @param {import('node:http').ServerResponse} res - the response to own.
* @param {string} pathname - the request pathname.
*/
async function handleScratch(req, res, pathname) {
	if (pathname === "/dsh-codex-ui/scratch/delete") {
		if (req.method !== "POST") {
			send(res, 405, { error: "method not allowed" });
			return;
		}
		await handleScratchDelete(req, res);
		return;
	}
	if (req.method === "GET") {
		await handleScratchList(res);
		return;
	}
	if (req.method === "POST") {
		await handleScratchAllocate(res);
		return;
	}
	send(res, 405, { error: "method not allowed" });
}
/**
* Register the routes and hand their disposers to the plugin fiber, so
* unloading the plugin frees the paths instead of leaving dangling handlers.
* @param {import('@deepseek-ai/cordis').Context} ctx - host context.
*/
function apply(ctx) {
	const scratchHandler = async (req, res) => {
		try {
			await handleScratch(req, res, new URL(req.url === void 0 ? SCRATCH_PATH : req.url, "http://localhost").pathname);
		} catch (error) {
			send(res, 500, { error: messageOf(error) });
		}
	};
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: SCRATCH_PATH,
		handler: scratchHandler
	}), "dsh-plugin-codex-ui: working-directory allocation route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: SCRATCH_DELETE_PATH,
		handler: scratchHandler
	}), "dsh-plugin-codex-ui: working-directory deletion route");
}
//#endregion
export { apply, inject };
