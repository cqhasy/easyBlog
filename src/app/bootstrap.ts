import { mountSources } from "../features/sources";
import "../styles.css";

export function bootstrap(root: HTMLElement | null): void {
  if (root) mountSources(root);
}
