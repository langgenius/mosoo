import { cva } from "class-variance-authority";
import type { ComponentType, MouseEventHandler, ReactElement, ReactNode } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/shared/lib/class-names";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

/**
 * Console sidebar recipe.
 *
 * One row grammar serves every entry point in the Project and Org sidebars:
 * navigation links, quick actions, menu triggers, and inert "coming soon"
 * rows. Measurements: 32px row, 6px radius, 16px icon with a 10px gap, 13px
 * medium label that turns semibold when selected. Hover and selected fills are
 * the neutral `--sidebar-row-*` tokens; the brand green appears only on the
 * keyboard focus ring, so selection never competes with the one accent.
 *
 * State matrix (see docs/design/console-sidebar.md):
 * rest -> hover (fine pointer only) -> pressed -> keyboard focus, crossed with
 * selected (`aria-current="page"`), open (`data-popup-open`), and disabled
 * (`aria-disabled`, legible muted text instead of whole-row opacity).
 */

export type SidebarIcon = ComponentType<{ className?: string | undefined }>;

export type SidebarRowState = "active" | "disabled" | "rest";

const sidebarRowVariants = cva(
  "group/row relative flex h-8 shrink-0 items-center rounded-md text-[13px] leading-none font-medium outline-none transition-[background-color,color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar data-[popup-open]:bg-sidebar-row-active data-[popup-open]:text-fg-1 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    defaultVariants: {
      layout: "expanded",
      state: "rest",
    },
    variants: {
      layout: {
        collapsed: "mx-auto w-8 justify-center",
        expanded: "w-full gap-2.5 px-2.5 text-left",
      },
      state: {
        active: "bg-sidebar-row-active text-fg-1 font-semibold",
        disabled: "text-fg-muted cursor-not-allowed",
        rest: "text-fg-2 hover:bg-sidebar-row-hover hover:text-fg-1 active:bg-sidebar-row-active",
      },
    },
  },
);

export function sidebarRowClassName(options: {
  className?: string | undefined;
  collapsed?: boolean | undefined;
  state?: SidebarRowState | undefined;
}): string {
  return cn(
    sidebarRowVariants({
      layout: options.collapsed === true ? "collapsed" : "expanded",
      state: options.state ?? "rest",
    }),
    options.className,
  );
}

/** Icon plus label (plus an optional trailing slot); the label unmounts in the rail. */
export function SidebarRowBody({
  collapsed = false,
  end,
  icon: Icon,
  label,
}: {
  collapsed?: boolean;
  end?: ReactNode;
  icon?: SidebarIcon | undefined;
  label: ReactNode;
}): ReactElement {
  return (
    <>
      {Icon ? <Icon className="size-4" /> : null}
      {collapsed ? null : (
        <>
          <span className="sidebar-label-enter min-w-0 flex-1 truncate">{label}</span>
          {end}
        </>
      )}
    </>
  );
}

/** Icon-only rows get a right-hand tooltip; expanded rows already show their label. */
export function SidebarTooltip({
  children,
  collapsed,
  label,
}: {
  children: ReactElement;
  collapsed: boolean;
  label: ReactNode;
}): ReactElement {
  if (!collapsed) {
    return children;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

interface SidebarRowBaseProps {
  active?: boolean;
  className?: string;
  collapsed?: boolean;
  disabled?: boolean;
  end?: ReactNode;
  icon?: SidebarIcon;
  label: string;
  /** Tooltip copy for the collapsed rail; defaults to the label. */
  tooltip?: ReactNode;
}

interface SidebarLinkRowProps extends SidebarRowBaseProps {
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  to: string;
}

interface SidebarButtonRowProps extends SidebarRowBaseProps {
  onClick?: MouseEventHandler<HTMLButtonElement>;
  to?: undefined;
}

export type SidebarRowProps = SidebarButtonRowProps | SidebarLinkRowProps;

export function SidebarRow(props: SidebarRowProps): ReactElement {
  const {
    active = false,
    className,
    collapsed = false,
    disabled = false,
    end,
    icon,
    label,
    tooltip,
  } = props;
  const state: SidebarRowState = disabled ? "disabled" : active ? "active" : "rest";
  const rowClassName = sidebarRowClassName({ className, collapsed, state });
  const body = <SidebarRowBody collapsed={collapsed} end={end} icon={icon} label={label} />;
  // The visible label names the row when expanded; the rail needs it spelled out.
  const accessibleName = collapsed ? { "aria-label": label } : {};

  let row: ReactElement;

  if (disabled) {
    row = (
      <div
        aria-disabled="true"
        role={props.to === undefined ? "button" : "link"}
        className={rowClassName}
        {...accessibleName}
      >
        {body}
      </div>
    );
  } else if (props.to === undefined) {
    row = (
      <button type="button" className={rowClassName} onClick={props.onClick} {...accessibleName}>
        {body}
      </button>
    );
  } else {
    row = (
      <Link
        to={props.to}
        aria-current={active ? "page" : undefined}
        className={rowClassName}
        onClick={props.onClick}
        {...accessibleName}
      >
        {body}
      </Link>
    );
  }

  return (
    <SidebarTooltip collapsed={collapsed} label={tooltip ?? label}>
      {row}
    </SidebarTooltip>
  );
}

/** Quiet sentence-case label for a group of rows; the rail shows a short rule instead. */
export function SidebarSectionLabel({
  children,
  collapsed = false,
}: {
  children: ReactNode;
  collapsed?: boolean;
}): ReactElement {
  if (collapsed) {
    return <SidebarRule collapsed />;
  }

  return (
    <div className="sidebar-label-enter text-fg-3 px-2.5 pt-4 pb-1 text-[12px] leading-4 font-medium select-none">
      {children}
    </div>
  );
}

/** Hairline between sidebar groups: full width when expanded, a short tick in the rail. */
function SidebarRule({
  className,
  collapsed = false,
}: {
  className?: string;
  collapsed?: boolean;
}): ReactElement {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "h-px shrink-0",
        collapsed ? "bg-border mx-auto my-2 w-5" : "bg-border-soft mx-1 my-2",
        className,
      )}
    />
  );
}
