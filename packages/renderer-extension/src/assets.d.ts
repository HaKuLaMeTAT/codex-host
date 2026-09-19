declare module "*.svg" {
  const url: string;
  export default url;
}

declare module "*.css" {
  const url: string;
  export default url;
}

declare module "lucide/dist/esm/createElement.mjs" {
  const createElement: (
    icon: LucideIconNode,
    attributes: Record<string, unknown>,
  ) => SVGElement;
  export default createElement;
}

declare module "lucide/dist/esm/icons/*.mjs" {
  const icon: LucideIconNode;
  export default icon;
}
// The declaration file must stay a script so SVG/CSS ambient modules are global.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type LucideIconNode = import("lucide").IconNode;
