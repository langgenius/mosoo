import { describe, expect, test } from "bun:test";

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "../src/shared/i18n";
import { Markdown } from "../src/shared/ui/markdown";
import type { MarkdownLinkResolver } from "../src/shared/ui/markdown";

function renderMarkdown(element: ReactElement): string {
  return renderToStaticMarkup(<I18nProvider>{element}</I18nProvider>);
}

describe("Markdown artifact links", () => {
  test("resolves output links before hardening", () => {
    const downloadHref = "/api/files/01J000000000000000000000F1/content?disposition=inline";
    const unavailableHref = "/api/files/unavailable/content";
    const linkResolver: MarkdownLinkResolver = (href) => {
      if (href === "outputs/report.md" || href === downloadHref) {
        return {
          href: downloadHref,
          label: "Preview report.md",
          onOpen: () => {},
        };
      }

      if (href === "outputs/missing.md" || href === unavailableHref) {
        return {
          href: unavailableHref,
          label: "File unavailable",
          unavailable: true,
        };
      }

      return null;
    };

    const html = renderMarkdown(
      <Markdown linkResolver={linkResolver}>
        {["[Open report](outputs/report.md)", "[Missing](outputs/missing.md)"].join("\n\n")}
      </Markdown>,
    );

    expect(html).toContain('<button aria-label="Preview report.md"');
    expect(html).toContain("Open report");
    expect(html).toContain("Missing");
    expect(html).toContain("(File unavailable)");
    expect(html).not.toContain("[blocked]");
  });

  test("uses a fresh parser when the link resolver changes", () => {
    const unavailableHref = "/api/files/unavailable/content";
    const unavailableResolver: MarkdownLinkResolver = (href) =>
      href === "outputs/report.md" || href === unavailableHref
        ? {
            href: unavailableHref,
            label: "File unavailable",
            unavailable: true,
          }
        : null;
    const unavailableHtml = renderMarkdown(
      <Markdown linkResolver={unavailableResolver}>[Open report](outputs/report.md)</Markdown>,
    );
    const downloadHref = "/api/files/01J000000000000000000000F1/content?disposition=inline";
    const availableResolver: MarkdownLinkResolver = (href) =>
      href === "outputs/report.md" || href === downloadHref
        ? {
            href: downloadHref,
            label: "Preview report.md",
            onOpen: () => {},
          }
        : null;
    const availableHtml = renderMarkdown(
      <Markdown linkResolver={availableResolver}>[Open report](outputs/report.md)</Markdown>,
    );

    expect(unavailableHtml).toContain("(File unavailable)");
    expect(availableHtml).toContain('<button aria-label="Preview report.md"');
    expect(availableHtml).not.toContain("file unavailable");
  });
});
