import type { ComponentProps, ReactElement, ReactNode } from "react";

/**
 * Original icon family for the four Project resources in the sidebar: Skills,
 * MCP servers, Providers, and Environments.
 *
 * These are the modules an Agent is assembled from, so they share one
 * construction contract instead of borrowing unrelated stock glyphs:
 *
 * - 24-unit grid, 1.5 stroke, round caps and joins. Silhouettes span 16 to 19
 *   units and centre on (12, 12), which matches the optical weight of the
 *   Hugeicons neighbours in the primary navigation.
 * - Exactly one duotone plane per glyph, filled with currentColor at 12%. The
 *   plane marks the part that attaches to the Agent (puzzle body, plug body, key
 *   bow, cube top) and keeps the family recognisable in the icon-only rail.
 * - Everything renders from currentColor. Rest, hover, selected, and disabled
 *   colours, as well as the dark theme, are decided by the row, never here.
 *
 * The same paths are published as standalone SVG files under
 * docs/design/assets/resource-icons for Mosoo Computer and other surfaces.
 */

export type ResourceIconName = "environments" | "mcp-servers" | "providers" | "skills";

export type ResourceIconProps = Omit<ComponentProps<"svg">, "children" | "viewBox">;

const TINT_OPACITY = 0.12;

const SKILLS_BODY =
  "M5.25 20.5H15.75A1.75 1.75 0 0 0 17.5 18.75V16.5A3 3 0 1 0 17.5 10.5V8.25A1.75 1.75 0 0 0 15.75 6.5H13.5A3 3 0 1 0 7.5 6.5H5.25A1.75 1.75 0 0 0 3.5 8.25V10.5A3 3 0 1 1 3.5 16.5V18.75A1.75 1.75 0 0 0 5.25 20.5Z";
const MCP_BODY = "M5 7H19V12A7 7 0 0 1 5 12Z";
const ENVIRONMENTS_TOP = "M12 2.75L20 7.25L12 11.75L4 7.25Z";

function ResourceIconFrame({
  children,
  resource,
  ...props
}: ResourceIconProps & { children: ReactNode; resource: ResourceIconName }): ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-resource-icon={resource}
      {...props}
    >
      {children}
    </svg>
  );
}

function ResourceIconTint({ d }: { d: string }): ReactElement {
  return <path d={d} fill="currentColor" fillOpacity={TINT_OPACITY} stroke="none" />;
}

/** Skills: a puzzle piece, the reusable capability that slots into an Agent. */
export function SkillsResourceIcon(props: ResourceIconProps): ReactElement {
  return (
    <ResourceIconFrame resource="skills" {...props}>
      <ResourceIconTint d={SKILLS_BODY} />
      <path d={SKILLS_BODY} />
    </ResourceIconFrame>
  );
}

/** MCP servers: a plug, the external capability an Agent connects to. */
export function McpServersResourceIcon(props: ResourceIconProps): ReactElement {
  return (
    <ResourceIconFrame resource="mcp-servers" {...props}>
      <ResourceIconTint d={MCP_BODY} />
      <path d="M8.5 2.5V7M15.5 2.5V7" />
      <path d={MCP_BODY} />
      <path d="M12 19V21.5" />
    </ResourceIconFrame>
  );
}

/** Providers: a key, the credential that unlocks a model provider. */
export function ProvidersResourceIcon(props: ResourceIconProps): ReactElement {
  return (
    <ResourceIconFrame resource="providers" {...props}>
      <circle
        cx={7.25}
        cy={12}
        r={4.25}
        fill="currentColor"
        fillOpacity={TINT_OPACITY}
        stroke="none"
      />
      <circle cx={7.25} cy={12} r={4.25} />
      <path d="M11.5 12H21M17.25 12V15.5M21 12V14.5" />
    </ResourceIconFrame>
  );
}

/** Environments: a cube, the sandbox image an Agent runs inside. */
export function EnvironmentsResourceIcon(props: ResourceIconProps): ReactElement {
  return (
    <ResourceIconFrame resource="environments" {...props}>
      <ResourceIconTint d={ENVIRONMENTS_TOP} />
      <path d="M12 2.75L20 7.25V16.75L12 21.25L4 16.75V7.25Z" />
      <path d="M4 7.25L12 11.75L20 7.25M12 11.75V21.25" />
    </ResourceIconFrame>
  );
}
