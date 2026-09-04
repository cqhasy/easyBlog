import { createIcons, icons } from "lucide";

export function hydrateIcons(): void {
  createIcons({
    icons,
    attrs: { "aria-hidden": "true", focusable: "false" },
  });
}
