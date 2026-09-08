import type { ComponentProps, ReactElement, ReactNode } from "react";

/**
 * Original glyph family for the eight entry points in the Project sidebar:
 * Overview, Runs, Agents, Files, and the four Project resources (Skills, MCP
 * servers, Providers, Environments).
 *
 * One construction contract, so the work list reads as one product rather
 * than a mix of stock icons:
 *
 * - 24-unit grid, 1.5 stroke, round caps and joins. Silhouettes span 16 to 19
 *   units and centre on (12, 12), the optical weight of the Hugeicons utility
 *   icons that remain in the persistent footer.
 * - Exactly one duotone plane per glyph, filled with currentColor at 12 %. The
 *   plane marks the glyph's primary surface (the sidebar column, the play
 *   mark, the robot face, the folder, the puzzle body, the plug body, the key
 *   bow, the cube top) and keeps the family recognisable in the icon-only rail.
 * - Everything renders from currentColor. Rest, hover, selected, and disabled
 *   colours, as well as the dark theme, are decided by the row, never here.
 *
 * The same paths are published as standalone SVG files under
 * docs/design/assets/sidebar-icons for Mosoo Computer and other surfaces.
 */

export type SidebarIconName =
  | "agents"
  | "environments"
  | "files"
  | "mcp-servers"
  | "overview"
  | "providers"
  | "runs"
  | "skills";

export type SidebarIconProps = Omit<ComponentProps<"svg">, "children" | "viewBox">;

const TINT_OPACITY = 0.12;

const OVERVIEW_FRAME =
  "M7 4H17A3 3 0 0 1 20 7V17A3 3 0 0 1 17 20H7A3 3 0 0 1 4 17V7A3 3 0 0 1 7 4Z";
const OVERVIEW_COLUMN = "M7 4H9.5V20H7A3 3 0 0 1 4 17V7A3 3 0 0 1 7 4Z";
const RUNS_PLAY = "M10 8.75V15.25L15.75 12Z";
const AGENTS_FACE =
  "M6 9H18A2.5 2.5 0 0 1 20.5 11.5V17A2.5 2.5 0 0 1 18 19.5H6A2.5 2.5 0 0 1 3.5 17V11.5A2.5 2.5 0 0 1 6 9Z";
const FILES_FOLDER =
  "M3.5 8A2.5 2.5 0 0 1 6 5.5H9.75L12 7.75H18A2.5 2.5 0 0 1 20.5 10.25V16A2.5 2.5 0 0 1 18 18.5H6A2.5 2.5 0 0 1 3.5 16Z";
const SKILLS_BODY =
  "M5.25 20.5H15.75A1.75 1.75 0 0 0 17.5 18.75V16.5A3 3 0 1 0 17.5 10.5V8.25A1.75 1.75 0 0 0 15.75 6.5H13.5A3 3 0 1 0 7.5 6.5H5.25A1.75 1.75 0 0 0 3.5 8.25V10.5A3 3 0 1 1 3.5 16.5V18.75A1.75 1.75 0 0 0 5.25 20.5Z";
const MCP_BODY = "M5 7H19V12A7 7 0 0 1 5 12Z";
const ENVIRONMENTS_TOP = "M12 2.75L20 7.25L12 11.75L4 7.25Z";

function SidebarIconFrame({
  children,
  glyph,
  ...props
}: SidebarIconProps & { children: ReactNode; glyph: SidebarIconName }): ReactElement {
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
      data-sidebar-icon={glyph}
      {...props}
    >
      {children}
    </svg>
  );
}

function Plane({ d }: { d: string }): ReactElement {
  return <path d={d} fill="currentColor" fillOpacity={TINT_OPACITY} stroke="none" />;
}

/** Overview: the console layout itself, sidebar column plus canvas. */
export function OverviewIcon(props: SidebarIconProps): ReactElement {
  return (
    <SidebarIconFrame glyph="overview" {...props}>
      <Plane d={OVERVIEW_COLUMN} />
      <path d={OVERVIEW_FRAME} />
      <path d="M9.5 4V20M9.5 12H20" />
    </SidebarIconFrame>
  );
}

/** Runs: a play mark, one observable execution. */
export function RunsIcon(props: SidebarIconProps): ReactElement {
  return (
    <SidebarIconFrame glyph="runs" {...props}>
      <Plane d={RUNS_PLAY} />
      <circle cx={12} cy={12} r={8} />
      <path d={RUNS_PLAY} />
    </SidebarIconFrame>
  );
}

/** Agents: a robot face with an antenna. */
export function AgentsIcon(props: SidebarIconProps): ReactElement {
  return (
    <SidebarIconFrame glyph="agents" {...props}>
      <Plane d={AGENTS_FACE} />
      <path d={AGENTS_FACE} />
      <path d="M12 9V6" />
      <circle cx={12} cy={4.5} r={1.5} />
      <path d="M8.75 13.25V15.25M15.25 13.25V15.25" />
    </SidebarIconFrame>
  );
}

/** Files: a folder, the Project's files and Thread artifacts. */
export function FilesIcon(props: SidebarIconProps): ReactElement {
  return (
    <SidebarIconFrame glyph="files" {...props}>
      <Plane d={FILES_FOLDER} />
      <path d={FILES_FOLDER} />
    </SidebarIconFrame>
  );
}

/** Skills: a puzzle piece, the reusable capability that slots into an Agent. */
export function SkillsIcon(props: SidebarIconProps): ReactElement {
  return (
    <SidebarIconFrame glyph="skills" {...props}>
      <Plane d={SKILLS_BODY} />
      <path d={SKILLS_BODY} />
    </SidebarIconFrame>
  );
}

/** MCP servers: a plug, the external capability an Agent connects to. */
export function McpServersIcon(props: SidebarIconProps): ReactElement {
  return (
    <SidebarIconFrame glyph="mcp-servers" {...props}>
      <Plane d={MCP_BODY} />
      <path d="M8.5 2.5V7M15.5 2.5V7" />
      <path d={MCP_BODY} />
      <path d="M12 19V21.5" />
    </SidebarIconFrame>
  );
}

/** Providers: a key, the credential that unlocks a model provider. */
export function ProvidersIcon(props: SidebarIconProps): ReactElement {
  return (
    <SidebarIconFrame glyph="providers" {...props}>
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
    </SidebarIconFrame>
  );
}

/** Environments: a cube, the sandbox image an Agent runs inside. */
export function EnvironmentsIcon(props: SidebarIconProps): ReactElement {
  return (
    <SidebarIconFrame glyph="environments" {...props}>
      <Plane d={ENVIRONMENTS_TOP} />
      <path d="M12 2.75L20 7.25V16.75L12 21.25L4 16.75V7.25Z" />
      <path d="M4 7.25L12 11.75L20 7.25M12 11.75V21.25" />
    </SidebarIconFrame>
  );
}
