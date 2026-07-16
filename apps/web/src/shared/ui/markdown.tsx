import { FileText } from "lucide-react";
import { useMemo } from "react";
import type { ComponentProps, ReactElement } from "react";
import { Streamdown, defaultRehypePlugins } from "streamdown";
import type { Components } from "streamdown";

import { cn } from "@/shared/lib/class-names";

interface MarkdownProps {
  children: string;
  className?: string;
  linkResolver?: MarkdownLinkResolver;
  streaming?: boolean;
}

export interface MarkdownLinkResolution {
  href: string;
  label: string;
  onOpen?: () => void;
  unavailable?: boolean;
}

export type MarkdownLinkResolver = (href: string) => MarkdownLinkResolution | null;

type MarkdownAnchorProps = ComponentProps<"a"> & { node?: unknown };

function MarkdownAnchor({
  children,
  className,
  href,
  node: _node,
  rel,
  target,
  ...props
}: MarkdownAnchorProps): ReactElement {
  const shouldOpenInNewTab = typeof href === "string" && href.length > 0 && !href.startsWith("#");

  return (
    <a
      {...props}
      className={cn(
        "underline decoration-current/40 underline-offset-3 transition-colors",
        className,
      )}
      href={href}
      rel={shouldOpenInNewTab ? (rel ?? "noopener noreferrer") : rel}
      target={shouldOpenInNewTab ? (target ?? "_blank") : target}
    >
      {children}
    </a>
  );
}

const baseMarkdownComponents: Components = {
  a: MarkdownAnchor,
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn("border-l-2 border-border pl-3 text-muted-foreground", className)}
      {...props}
    />
  ),
  em: ({ className, ...props }) => <em className={cn("italic", className)} {...props} />,
  hr: ({ className, ...props }) => <hr className={cn("border-border", className)} {...props} />,
  inlineCode: ({ className, ...props }) => (
    <code
      className={cn(
        "rounded bg-muted/70 px-1 py-0.5 font-mono text-[0.92em] text-foreground",
        className,
      )}
      {...props}
    />
  ),
  li: ({ className, ...props }) => <li className={cn("leading-relaxed", className)} {...props} />,
  ol: ({ className, ...props }) => (
    <ol
      className={cn("ml-5 list-decimal space-y-1.5 marker:text-muted-foreground/70", className)}
      {...props}
    />
  ),
  p: ({ className, ...props }) => <p className={cn("leading-relaxed", className)} {...props} />,
  strong: ({ className, ...props }) => (
    <strong className={cn("font-semibold", className)} {...props} />
  ),
  table: ({ className, ...props }) => (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-[12.5px]", className)} {...props} />
    </div>
  ),
  td: ({ className, ...props }) => (
    <td className={cn("border border-border px-2 py-1", className)} {...props} />
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        "border border-border bg-muted/50 px-2 py-1 text-left font-semibold",
        className,
      )}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn("ml-5 list-disc space-y-1.5 marker:text-muted-foreground/70", className)}
      {...props}
    />
  ),
};

const chatMarkdownComponents: Components = {
  ...baseMarkdownComponents,
  h1: ({ children, className, ...props }) => (
    <h1 className={cn("text-[1.05em] font-semibold", className)} {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, className, ...props }) => (
    <h2 className={cn("text-[1em] font-semibold", className)} {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, className, ...props }) => (
    <h3 className={cn("text-[0.95em] font-semibold", className)} {...props}>
      {children}
    </h3>
  ),
};

const markdownClassName = cn(
  "min-w-0 max-w-full space-y-3 break-words text-[14.5px] leading-[1.55] text-inherit",
  "[&_a]:text-current [&_a:hover]:text-current/80",
  "[&_blockquote]:text-inherit/80 [&_strong]:text-inherit",
  "[&_pre]:max-w-full [&_pre]:overflow-x-auto",
);

type RequiredRehypePlugin = NonNullable<(typeof defaultRehypePlugins)["sanitize" | "harden"]>;

function getRequiredRehypePlugin(name: "sanitize" | "harden"): RequiredRehypePlugin {
  const plugin = defaultRehypePlugins[name];

  if (!plugin) {
    throw new Error(`Missing required Streamdown rehype plugin: ${name}`);
  }

  return plugin;
}

const chatRehypePlugins = [getRequiredRehypePlugin("sanitize"), getRequiredRehypePlugin("harden")];
const chatDisallowedElements = ["img"];
const resolvedLinkPluginCache = new WeakMap<MarkdownLinkResolver, ResolvedLinkPlugin>();
let resolvedLinkPluginSequence = 0;

interface MarkdownTreeNode {
  children?: MarkdownTreeNode[];
  properties?: Record<string, unknown>;
  tagName?: string;
  type: string;
}

interface ResolvedLinkPlugin {
  cacheKey: string;
  plugin: RequiredRehypePlugin;
}

function rewriteResolvedLinks(node: MarkdownTreeNode, linkResolver: MarkdownLinkResolver): void {
  if (node.type === "element" && node.tagName === "a" && node.properties !== undefined) {
    const href = node.properties["href"];

    if (typeof href === "string") {
      const resolution = linkResolver(href);

      if (resolution !== null) {
        node.properties["href"] = resolution.href;
      }
    }
  }

  for (const child of node.children ?? []) {
    rewriteResolvedLinks(child, linkResolver);
  }
}

function createResolvedLinkPlugin(linkResolver: MarkdownLinkResolver): ResolvedLinkPlugin {
  const cached = resolvedLinkPluginCache.get(linkResolver);

  if (cached !== undefined) {
    return cached;
  }

  const plugin = () => (tree: MarkdownTreeNode) => {
    rewriteResolvedLinks(tree, linkResolver);
  };
  const pluginName = `resolveMarkdownLinks$${resolvedLinkPluginSequence}`;

  resolvedLinkPluginSequence += 1;
  Object.defineProperty(plugin, "name", { value: pluginName });

  const resolvedLinkPlugin = {
    cacheKey: pluginName,
    plugin: plugin as RequiredRehypePlugin,
  };

  resolvedLinkPluginCache.set(linkResolver, resolvedLinkPlugin);
  return resolvedLinkPlugin;
}

function createMarkdownComponents(linkResolver: MarkdownLinkResolver | undefined): Components {
  if (linkResolver === undefined) {
    return chatMarkdownComponents;
  }

  return {
    ...chatMarkdownComponents,
    a: ({ children, className, href, node: _node, ...props }) => {
      const resolution = typeof href === "string" ? linkResolver(href) : null;

      if (resolution?.unavailable === true) {
        return (
          <span className={cn("text-fg-3", className)} title={resolution.label}>
            {children}
            <span className="text-[0.9em]"> (file unavailable)</span>
          </span>
        );
      }

      if (resolution?.onOpen !== undefined) {
        return (
          <button
            aria-label={resolution.label}
            className={cn(
              "inline-flex cursor-pointer items-baseline gap-1 underline decoration-current/40 underline-offset-3 transition-colors hover:text-current/80",
              className,
            )}
            onClick={resolution.onOpen}
            type="button"
          >
            <FileText aria-hidden className="size-3.5 shrink-0 translate-y-[2px]" />
            <span>{children}</span>
          </button>
        );
      }

      return (
        <MarkdownAnchor className={className} href={href} {...props}>
          {children}
        </MarkdownAnchor>
      );
    },
  };
}

export function Markdown({
  children,
  className,
  linkResolver,
  streaming = false,
}: MarkdownProps): ReactElement {
  const components = useMemo(() => createMarkdownComponents(linkResolver), [linkResolver]);
  const resolvedLinkPlugin = useMemo(
    () => (linkResolver === undefined ? null : createResolvedLinkPlugin(linkResolver)),
    [linkResolver],
  );
  const rehypePlugins = useMemo(
    () =>
      resolvedLinkPlugin === null
        ? chatRehypePlugins
        : [
            getRequiredRehypePlugin("sanitize"),
            resolvedLinkPlugin.plugin,
            getRequiredRehypePlugin("harden"),
          ],
    [resolvedLinkPlugin],
  );

  return (
    <Streamdown
      key={resolvedLinkPlugin?.cacheKey ?? "default"}
      className={cn(markdownClassName, className)}
      components={components}
      controls={false}
      disallowedElements={chatDisallowedElements}
      dir="auto"
      isAnimating={streaming}
      lineNumbers={false}
      mode={streaming ? "streaming" : "static"}
      rehypePlugins={rehypePlugins}
    >
      {children}
    </Streamdown>
  );
}
