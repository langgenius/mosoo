function writeClipboardTextWithSelection(text: string): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const didCopy = document.execCommand("copy");
  input.remove();
  return didCopy;
}

export async function writeClipboardText(text: string): Promise<boolean> {
  if (writeClipboardTextWithSelection(text)) {
    return true;
  }

  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
