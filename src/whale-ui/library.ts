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
    "Use real data from the conversation or tools. SearchImage and street routing are host resources; component action APIs do not grant arbitrary tool access.",
    "Prefer accessible layouts, short text and a useful working interaction. Use drawings for geometry and mechanisms and charts for numerical comparisons.",
  ],
};
export function generateWhaleGuide(extraDefinitions: DefinedComponent<any>[] = []) { return createWhaleLibrary(extraDefinitions).prompt(promptOptions); }
export { componentDefinitions, componentGroups, functionDefinitions };
export default library;
