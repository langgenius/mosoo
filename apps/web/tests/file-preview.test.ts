import { describe, expect, test } from "bun:test";

import {
  getFilePreviewKind,
  getTableDelimiter,
  parseDelimitedText,
  UNSUPPORTED_FILE_PREVIEW_MESSAGE,
} from "../src/routes/files/file-preview";

describe("file preview", () => {
  test("recognizes the supported preview formats by MIME type or extension", () => {
    expect(getFilePreviewKind("notes.md", null)).toBe("markdown");
    expect(getFilePreviewKind("notes", "text/plain; charset=utf-8")).toBe("text");
    expect(getFilePreviewKind("report.csv", "application/octet-stream")).toBe("table");
    expect(getFilePreviewKind("report.pdf", null)).toBe("pdf");
    expect(getFilePreviewKind("chart", "image/png")).toBe("image");
    expect(getFilePreviewKind("archive.zip", "application/zip")).toBe("unsupported");
  });

  test("offers a clear download action for unsupported file formats", () => {
    expect(UNSUPPORTED_FILE_PREVIEW_MESSAGE).toBe(
      "Preview isn't available for this file type. Download the file to view it.",
    );
  });

  test("parses quoted CSV cells and line breaks", () => {
    expect(parseDelimitedText('name,note\n"Mosoo, Inc.","line 1\nline 2"', ",")).toEqual({
      rows: [
        ["name", "note"],
        ["Mosoo, Inc.", "line 1\nline 2"],
      ],
      truncated: false,
    });
  });

  test("selects a tab delimiter for TSV files", () => {
    expect(getTableDelimiter("report.tsv", null)).toBe("\t");
    expect(parseDelimitedText("name\tvalue\nalpha\t1", "\t").rows).toEqual([
      ["name", "value"],
      ["alpha", "1"],
    ]);
  });
});
