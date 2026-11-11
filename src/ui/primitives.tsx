import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { icon, resourceIllustration, dieFace } from "../icons.js";
import type { Resource } from "./types";
// Closed, static SVG vocabulary; player text is always rendered by React.
export function Icon({ name }: { name: string }) {
  return (
    <span
      className="icon-fragment"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: icon(name) }}
    />
  );
}
export function ResourceArt({ resource }: { resource: Resource }) {
  return (
    <span
      className="art-fragment"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: resourceIllustration(resource) }}
    />
  );
}
export function Die({ value }: { value: number }) {
  return (
    <span
      title={String(value)}
      dangerouslySetInnerHTML={{ __html: dieFace(value) }}
    />
  );
}
export function Button({
  action,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  action?: string;
  children?: ReactNode;
}) {
  return (
    <button type="button" {...props} data-action={action}>
      {children}
    </button>
  );
}
export const playerStyle = (color: string) =>
  ({ "--player": color }) as CSSProperties;
export function initial(name: string, domestic: boolean) {
  return domestic
    ? name.slice(0, 1)
    : new Intl.Segmenter("zh", { granularity: "grapheme" })
        .segment(name)
        [Symbol.iterator]()
        .next().value?.segment || "";
}
