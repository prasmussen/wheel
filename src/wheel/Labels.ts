/** Committed labels use NFC uppercase and the existing 12 UTF-16-unit limit. */
export function normalizeLabel(label: string): string {
  return label.trim().toUpperCase().normalize("NFC");
}

export function validLabel(label: unknown, allowBlank = false): label is string {
  return typeof label === "string" && label.length <= 12
    && (allowBlank || label.length > 0)
    && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(label);
}
