'use strict';

/**
 * Marketplace catalog install-spec allow list shared by mapping and `dsh plugin add`.
 * Host `installPlugin` stays github-only; `#path:` and registry npm live only here.
 */

const { isValidGithubSpec, isValidPackageName } = require('../host/install-dsh-plugin-client');

/** Catalog `github:owner/repo#path:/<posix>` spec. Posix safety is checked separately. */
const GITHUB_PATH_SPEC = /^github:([^/#]+)\/([^/#]+)#path:\/(.+)$/;
const GITHUB_URL_OWNER_REPO = /github\.com\/([^/#]+)\/([^/#]+)/i;

/**
 * Parse a Host-valid `github:owner/repo[#ref]` spec.
 * @param {string} spec
 * @returns {{ owner: string, repo: string, ref: string } | null}
 */
function parseGithubSpec(spec) {
  const value = String(spec || '').trim();
  if (!isValidGithubSpec(value)) {
    return null;
  }
  const match = /^github:([^/#]+)\/([^/#]+)(?:#(.+))?$/.exec(value);
  if (!match) {
    return null;
  }
  return { owner: match[1], repo: match[2], ref: match[3] || '' };
}

/**
 * Normalize a marketplace or installed dependency spec to a GitHub identity.
 * `#path:` remains part of the identity so two packages in one monorepo do
 * not match each other accidentally.
 * @param {string} spec
 * @returns {string}
 */
function githubIdentity(spec) {
  const value = String(spec || '').trim();
  const pathMatch = GITHUB_PATH_SPEC.exec(value);
  if (pathMatch) {
    return `${pathMatch[1]}/${pathMatch[2]}#path:/${pathMatch[3]}`.toLowerCase();
  }
  const parsed = parseGithubSpec(value);
  if (parsed) {
    return `${parsed.owner}/${parsed.repo}`.toLowerCase();
  }
  const url = value.match(/github\.com[:/]([^/#]+)\/([^/#]+?)(?:\.git)?(?:#path:\/([^#]+))?(?:#.*)?$/i);
  if (!url) {
    return '';
  }
  const owner = url[1];
  const repo = String(url[2]).replace(/\.git$/i, '');
  return url[3]
    ? `${owner}/${repo}#path:/${url[3]}`.toLowerCase()
    : `${owner}/${repo}`.toLowerCase();
}

/**
 * @param {unknown} url
 * @returns {{ owner: string, repo: string } | null}
 */
function githubOwnerRepoFromHomepage(url) {
  const match = String(url || '').match(GITHUB_URL_OWNER_REPO);
  if (!match) {
    return null;
  }
  return { owner: match[1], repo: String(match[2]).replace(/\.git$/i, '') };
}

/**
 * Whether owner/repo equals the GitHub repository in a homepage URL.
 * @param {string} owner
 * @param {string} repo
 * @param {string | undefined} homepage
 * @returns {boolean}
 */
function ownerRepoMatches(owner, repo, homepage) {
  const fromUrl = githubOwnerRepoFromHomepage(homepage);
  return Boolean(fromUrl && fromUrl.owner === owner && fromUrl.repo === repo);
}

/**
 * Whether a catalog `#path:` spec is a safe posix path on the row's GitHub repo.
 * @param {string} spec
 * @param {{ homepage?: string }} plugin
 * @returns {boolean}
 */
function isValidMarketplacePathSpec(spec, plugin) {
  const match = GITHUB_PATH_SPEC.exec(spec);
  if (!match) {
    return false;
  }
  const posix = match[3];
  if (!posix || posix.includes('..') || posix.includes(':') || posix.includes('\\')) {
    return false;
  }
  return ownerRepoMatches(match[1], match[2], plugin.homepage);
}

/**
 * Whether a mapped install spec may reach `dsh plugin add`.
 * @param {string} spec
 * @param {{ homepage?: string, npm?: string | null }} plugin
 * @returns {boolean}
 */
function isAllowedMarketplaceSpec(spec, plugin) {
  if (!spec || spec.startsWith('file:') || spec.startsWith('link:')) {
    return false;
  }
  if (/^(?:https?:|git\+|git:)/i.test(spec)) {
    return false;
  }
  if (spec.includes('#path:')) {
    return isValidMarketplacePathSpec(spec, plugin);
  }
  if (spec.startsWith('github:')) {
    const parsed = parseGithubSpec(spec);
    return Boolean(parsed && ownerRepoMatches(parsed.owner, parsed.repo, plugin.homepage));
  }
  if (!isValidPackageName(spec)) {
    return false;
  }
  return Boolean(plugin.npm) && spec === plugin.npm;
}

module.exports = {
  GITHUB_PATH_SPEC,
  parseGithubSpec,
  githubIdentity,
  ownerRepoMatches,
  isValidMarketplacePathSpec,
  isAllowedMarketplaceSpec,
};
