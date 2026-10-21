import { z } from "zod";
import { createLibrary, defineAction, type DefinedComponent } from "@whale-ui/react";
import { componentDefinitions, componentGroups } from "./components";
import { functionDefinitions } from "./functions";

export const CopyToClipboard = defineAction({ name: "CopyToClipboard", description: "Copy text through the host clipboard bridge; action completion reflects the host response.", params: z.object({ text: z.string() }) });
export const libraryDefinition = { id: "whale-ui", root: "Col", components: componentDefinitions, componentGroups, functions: functionDefinitions, actions: [CopyToClipboard] };
/** Extra definitions join the same registry, renderer state and action executor. */
export function createWhaleLibrary(extraDefinitions: DefinedComponent<any>[] = []) {
  return createLibrary({ ...libraryDefinition, components: [...componentDefinitions, ...extraDefinitions] });
}
export const library = createWhaleLibrary();
export const promptOptions = {
  bindings: true, builtinFunctions: true, toolCalls: false,
  preamble: "Whale UI renders interactive pages within the current conversation. Start with root = Col(...). Use local state actions for local work; @ToAssistant sends a new request and current Form values to this same conversation. Business data comes from the host's real tools, not invented Query providers.",
  additionalRules: [
    "Each statement occupies one line. Use positional component arguments. Define every referenced name and connect every defined value to root.",
    "Mutable $variable defaults must be literal values. Use @Set and @Reset for local interactions. Guard empty numeric inputs with @Default and @Clamp.",
    "Use real data from the conversation or tools. For a self-contained interactive page, deliver the Whale UI program directly through a fence or render_ui; do not inspect or modify the host application source to construct it. SearchImage and street routing are host resources; component action APIs do not grant arbitrary tool access.",
    "Deliver a compact complete first version with short copy and useful local interactions; omit repeated prose summaries of values already on the page. Use drawings for geometry and mechanisms and charts for numerical comparisons. After render_ui reports success, the interface is already visible; do not render the same page a second time.",
    "@Min and @Max each take ONE numeric array: @Min([a,b]), @Max([a,b]); never @Min(a,b). Build a few shared calculations and keep each section focused on the user's question.",
    "Use a single concise md page title, 14px body text, 12px secondary text and one clear primary action. Do not add product names, demo labels, empty status bars or decorative badges.",
    "All gap/padding arguments use 4px units, not pixels: 2 = 8px, 3 = 12px, 4 = 16px, 5 = 20px, 6 = 24px. Card(children, variant, 5, 3) has 20px padding and 12px gap. Never pass 16/20/24 for those pixel sizes. Prefer default Card padding. Use Grid minChildWidth 240–280 for inputs. Keep metrics together in one plain Row/Grid; do not create a card per number. Buttons keep natural width; Card groups related content and should not wrap the whole page or another card.",
  ],
};
export function generateWhaleGuide(extraDefinitions: DefinedComponent<any>[] = []) { return createWhaleLibrary(extraDefinitions).prompt(promptOptions); }
export { componentDefinitions, componentGroups, functionDefinitions };
export default library;
