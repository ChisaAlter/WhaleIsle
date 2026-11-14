---
description: "The web search and fetch settings page on the dsh web client's Plugins page: the Search and Fetch provider menus, the DeepSeek Search API result count, DeepSeek Search and Fetch API billing, and legacy Messages search settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-web-search

English | [中文](README.zh.md)

## Summary

Open **Plugins** in the sidebar and select **Web search and fetch** in the Official group to choose the providers web search and web fetch use, set the Search API result count, or configure legacy Messages search. The DeepSeek Search and Fetch APIs each take a **Billing** choice instead of a key: automatic, the signed-in DeepSeek account, or the DeepSeek API key. The page writes only on save; a legacy key goes through the credentials domain. The page exists while the Host serves the `web` namespace; each official provider's controls appear only while the Host serves that provider's namespace.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The **Web search and fetch** card in the Official group opens the page. It has a **Web search provider** section and a **Web fetch provider** section, each with a provider menu directly under its title. A menu lists every provider the Host registers, including providers that plugins register, so a newly installed provider needs no change to this page; [Add another provider](../../web/web/README.md#adding-a-provider) shows how to mount one in a profile. The official ones come first while registered: the Search menu lists **DeepSeek Search API** (`deepseek-search-api`) followed by **DeepSeek (legacy)** (`deepseek-official`), and the Fetch menu lists **Direct fetch** (`http`) and then **DeepSeek Fetch API** (`deepseek-fetch-api`); every other provider follows in registration order and shows its registered title or id. The shipped composition selects DeepSeek Search API for Search and Direct fetch for Fetch, and a selection stored in settings or composed by the deployment still applies; opening the page writes nothing. Each menu has no label of its own; its accessible name is its section title followed by the selected provider, such as **Web search provider DeepSeek Search API**. A selected id the Host does not register appears as an extra **(not loaded)** entry and stays selected. While the deployment composes no provider for a capability, its menu starts with **Automatic**, which clears the stored selection so the Host chooses again. Selecting the deployment's composed provider clears the stored selection instead of writing a copy. When the provider list cannot be read, each section says its menu may be incomplete and offers **Retry**; the menus keep the last list read, or only the selected ids before any list arrives. Under each menu, the section shows the `description` the selected provider registered, in the active language, as plain text; a provider that registers none, or a selected id the Host does not register, shows no description. The official providers' descriptions state each one's credentials, charges, model calls, reachable addresses, and content limits, and Direct fetch's ends by suggesting DeepSeek Fetch API as plain text. A plugin provider's section adds, after its description, that it is configured in that plugin's own settings.

**Use the new Web Search API** defaults off, so search keeps using Messages and fetch keeps using local HTTP. Its hint links to the DeepSeek search and fetch guide for the new API's features and billing. Saving it on selects the DeepSeek Search and Fetch APIs together; saving it off clears both selections back to the deployment's defaults, or stores Messages search with local HTTP fetch when the deployment composes the APIs. The switch appears only while the Host also serves the `web` and `web-deepseek-api` namespaces. With the switch on, the page shows **Results per search** (an integer from 1 through 50, default 10) in place of the Messages-only **Max searches per request**, and invalid result counts block saving. The switch is disabled while an invalid edit or a failed save is staged, so a field it would hide stays visible. Each mode keeps its own API base when switching. The **Messages API base URL** and **Search / Fetch API base URL** labels identify the active protocol; their hints name the required prefix and appended operation path. One save writes the provider settings before the selection and the credential last, so a refused section leaves the switch and key drafts unsaved. The Messages key remains editable and saveable when the Host serves only `web-search-deepseek`. See [web-search-deepseek](../../web/web-search-deepseek/README.md#use-this-package) and [web-deepseek-api](../../web/web-deepseek-api/README.md#use-this-package) for API behavior.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for. The browser half binds the `web`, `web-search-deepseek`, and `web-deepseek-api` namespaces through `ctxconfigFormsget` and keeps their settings forms in `WebSearchCardController`. A separate credential-only `SettingsFormModel` shares the Messages scope's availability and write permission. The switch stages `searchProvider` and `fetchProvider` in `web`; a target equal to the composed value stages a reset instead. The key's write goes to `remotecredentialsset` under the reference the selected API section's `apiKeyEnv` names (`DEEPSEEK_API_KEY` when it names none), and success is read back from `remotecredentialsdescribe`. The controller combines synchronous scope publications and reference switches into one credential read in the next microtask; scope refreshes also resynchronize credentials after a connection reset. Reference changes clear the previous credential state immediately. Host `credentials/reference-updated` events for the watched reference and writes trigger independent reads, including while an earlier read is pending. Only the latest read for the selected reference updates the card; a save uses its own readback result. Disposal stops queued reads and suppresses late answers. The page registers `WebSearchCard` into the Plugins page's `pluginsitem` slot through `ctxconfigFormswhileServed`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-plugin-manager](../ui-plugin-manager/README.md) — the Plugins page and the `plugins.item` slot the page registers into.
- [ui-settings](../ui-settings/README.md) — the settings scope and the served-namespace watch the page rides.
- [ui-primitives](../ui-primitives/README.md) — the settings form model and fields the page renders.
- [credentials](../../credentials/README.md) — the credential-reference seam the legacy key writes through.
- [web-deepseek-api](../../web/web-deepseek-api/README.md) — the Search and Fetch API providers whose result count and billing the page edits.
- [web](../../web/web/README.md) — the provider selection and provider list the menus use.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Automatic selection reads only the deployment composition** — a menu offers it when the composition layer sets no provider for that capability. While automatic selection applies, the Host's `DSH_WEB_SEARCH_PROVIDER` or `DSH_WEB_FETCH_PROVIDER` environment variable picks the provider instead, and the page does not show that choice. Without either, automatic selection with more than one usable registered provider makes each operation fail with `WEB_PROVIDER_AMBIGUOUS`.

- **Billing availability is not shown** — the page does not report that the selected billing has no signed-in account or no configured key; reading sign-in state needs the account remote, and the key reference of the DeepSeek API-key model provider is not visible to this page. An unavailable billing withholds the web tool from the model.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
