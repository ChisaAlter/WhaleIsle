import { layoutDefinitions } from "./layout";
import { textDefinitions } from "./text";
import { controlDefinitions } from "./controls";
import { mediaDefinitions } from "./media";
import { Chart } from "./chart";
import { mapDefinitions } from "./map";
import { drawingDefinitions } from "./drawing";

export const componentDefinitions = [...layoutDefinitions, ...textDefinitions, ...controlDefinitions, ...mediaDefinitions, Chart, ...mapDefinitions, ...drawingDefinitions];
export const componentGroups = [
  { name: "Layout", components: layoutDefinitions.map(component => component.name), notes: ["Gap and padding use 4px steps. Length is px or a CSS length. Radius is sm/md/lg/xl/full or px. Named colors follow the host theme; status backgrounds use soft tints."] },
  { name: "Text", components: textDefinitions.map(component => component.name) },
  { name: "Inputs", components: controlDefinitions.map(component => component.name), notes: ["Declare mutable values as $variables with literal defaults. Bind the first input argument to a $variable. A Form submits all its bound and plain member fields."] },
  { name: "Media and data", components: ["SearchImage", "Image", "Icon", "Table", "Chart", "Map", "MapMarker", "YouTube"] },
  { name: "Play", components: ["Flashcard", "Celebration"] },
  { name: "Drawing", components: drawingDefinitions.map(component => component.name) },
];
export * from "./layout";
export * from "./text";
export * from "./controls";
export * from "./media";
export * from "./map";
export * from "./drawing";
