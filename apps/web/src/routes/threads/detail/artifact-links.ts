import { createFileDownload } from "@/domains/file/api/file-download-client";
import type { ListedFileEntry } from "@/domains/file/api/files";
import type { MarkdownLinkResolver } from "@/shared/ui/markdown";

const UNAVAILABLE_ARTIFACT_HREF = "/api/files/unavailable/content";

export function normalizeArtifactSourcePath(href: string): string | null {
  const trimmed = href.trim();
  const withoutCurrentDirectory = trimmed.startsWith("./") ? trimmed.slice(2) : trimmed;

  if (
    withoutCurrentDirectory.length === 0 ||
    withoutCurrentDirectory.includes("\0") ||
    withoutCurrentDirectory.includes("\\") ||
    withoutCurrentDirectory.includes("?") ||
    withoutCurrentDirectory.includes("#")
  ) {
    return null;
  }

  let decoded: string;

  try {
    decoded = decodeURIComponent(withoutCurrentDirectory);
  } catch {
    return null;
  }

  const segments = decoded.split("/");

  if (
    segments.length < 2 ||
    segments[0] !== "outputs" ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    return null;
  }

  return segments.join("/");
}

export function createThreadArtifactLinkResolver(
  artifacts: readonly ListedFileEntry[],
  onOpenArtifact: (file: ListedFileEntry) => void,
): MarkdownLinkResolver {
  const artifactBySourcePath = new Map<string, ListedFileEntry>();
  const artifactByDownloadHref = new Map<string, ListedFileEntry>();

  for (const artifact of artifacts) {
    if (artifact.sessionKind !== "artifact" || artifact.sourcePath === null) {
      continue;
    }

    if (!artifactBySourcePath.has(artifact.sourcePath)) {
      artifactBySourcePath.set(artifact.sourcePath, artifact);
    }

    artifactByDownloadHref.set(createFileDownload(artifact.id, "inline").url, artifact);
  }

  return (href) => {
    const linkedArtifact = artifactByDownloadHref.get(href);

    if (linkedArtifact !== undefined) {
      return {
        href,
        label: `Preview ${linkedArtifact.name}`,
        onOpen: () => {
          onOpenArtifact(linkedArtifact);
        },
      };
    }

    if (href === UNAVAILABLE_ARTIFACT_HREF) {
      return {
        href,
        label: "File unavailable",
        unavailable: true,
      };
    }

    const sourcePath = normalizeArtifactSourcePath(href);

    if (sourcePath === null) {
      return null;
    }

    const artifact = artifactBySourcePath.get(sourcePath);

    if (artifact === undefined) {
      return {
        href: UNAVAILABLE_ARTIFACT_HREF,
        label: "File unavailable",
        unavailable: true,
      };
    }

    const download = createFileDownload(artifact.id, "inline");

    return {
      href: download.url,
      label: `Preview ${artifact.name}`,
      onOpen: () => {
        onOpenArtifact(artifact);
      },
    };
  };
}
