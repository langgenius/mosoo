export const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;
const MAX_TABLE_PREVIEW_COLUMNS = 50;
const MAX_TABLE_PREVIEW_ROWS = 200;

export type FilePreviewKind = "image" | "markdown" | "pdf" | "table" | "text" | "unsupported";

export interface ParsedTablePreview {
  rows: string[][];
  truncated: boolean;
}

function fileExtension(name: string): string {
  const extension = name.split(".").at(-1);
  return extension === undefined || extension === name ? "" : extension.toLowerCase();
}

function normalizedMimeType(mimeType: string | null): string {
  return mimeType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function getFilePreviewKind(name: string, mimeType: string | null): FilePreviewKind {
  const extension = fileExtension(name);
  const mime = normalizedMimeType(mimeType);

  if (
    mime.startsWith("image/") ||
    ["avif", "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"].includes(extension)
  ) {
    return "image";
  }

  if (mime === "application/pdf" || extension === "pdf") {
    return "pdf";
  }

  if (
    ["text/markdown", "text/x-markdown"].includes(mime) ||
    ["markdown", "md"].includes(extension)
  ) {
    return "markdown";
  }

  if (
    ["text/csv", "text/tab-separated-values"].includes(mime) ||
    ["csv", "tsv"].includes(extension)
  ) {
    return "table";
  }

  if (
    mime.startsWith("text/") ||
    ["application/json", "application/xml", "application/yaml"].includes(mime) ||
    ["json", "log", "txt", "xml", "yaml", "yml"].includes(extension)
  ) {
    return "text";
  }

  return "unsupported";
}

export function getTableDelimiter(name: string, mimeType: string | null): "," | "\t" {
  return normalizedMimeType(mimeType) === "text/tab-separated-values" ||
    fileExtension(name) === "tsv"
    ? "\t"
    : ",";
}

export function parseDelimitedText(content: string, delimiter: "," | "\t"): ParsedTablePreview {
  const rows: string[][] = [];
  let currentField = "";
  let currentRow: string[] = [];
  let inQuotes = false;
  let truncated = false;

  const appendField = () => {
    if (currentRow.length < MAX_TABLE_PREVIEW_COLUMNS) {
      currentRow.push(currentField);
    } else {
      truncated = true;
    }

    currentField = "";
  };
  const appendRow = () => {
    appendField();

    if (rows.length < MAX_TABLE_PREVIEW_ROWS) {
      rows.push(currentRow);
    } else {
      truncated = true;
    }

    currentRow = [];
  };

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (inQuotes) {
      if (character === '"') {
        if (content[index + 1] === '"') {
          currentField += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += character;
      }

      continue;
    }

    if (character === '"' && currentField === "") {
      inQuotes = true;
    } else if (character === delimiter) {
      appendField();
    } else if (character === "\n" || character === "\r") {
      appendRow();

      if (character === "\r" && content[index + 1] === "\n") {
        index += 1;
      }
    } else {
      currentField += character;
    }
  }

  if (currentField !== "" || currentRow.length > 0) {
    appendRow();
  }

  return { rows, truncated };
}
