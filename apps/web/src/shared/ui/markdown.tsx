import type { ReactElement } from "react";
import { Streamdown, defaultRehypePlugins } from "streamdown";
import type { Components } from "streamdown";

import { cn } from "@/shared/lib/class-names";

interface MarkdownProps {
  children: string;
  className?: string;
  streaming?: boolean;
}

const baseMarkdownComponents: Components = {
  a: ({ children, className, href, rel, target, ...props }) => {
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
  },
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

export function Markdown({ children, className, streaming = false }: MarkdownProps): ReactElement {
  return (
    <Streamdown
      className={cn(markdownClassName, className)}
      components={chatMarkdownComponents}
      controls={false}
      disallowedElements={chatDisallowedElements}
      dir="auto"
      isAnimating={streaming}
      lineNumbers={false}
      mode={streaming ? "streaming" : "static"}
      rehypePlugins={chatRehypePlugins}
    >
      {children}
    </Streamdown>
  );
}
