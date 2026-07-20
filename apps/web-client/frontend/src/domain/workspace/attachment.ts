/**
 * Composer image attachment model (E40 image-to-agent). The player attaches an
 * image — an upload from disk or a self-screenshot of the running game — that
 * rides along with the chat message to the building agent. Pure, framework-free
 * helpers so the Composer stays a thin view over this logic (and it unit-tests
 * without a DOM beyond FileReader).
 */

/** Where an attachment came from — drives the little preview badge. */
export type AttachmentSource = "upload" | "screenshot";

export interface ComposerAttachment {
  /** `data:image/png;base64,…` — the API tolerates the data-URL prefix. */
  dataUrl: string;
  source: AttachmentSource;
}

/** MIME types the picker (and the backend image processor) accept. */
export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export const ACCEPTED_IMAGE_ACCEPT = ACCEPTED_IMAGE_TYPES.join(",");

/** Client-side ceiling. The backend downscales to ≤1568px, but a hard cap here
 *  keeps a stray 50MB drop from ever hitting the wire / base64-inflating x1.33. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Why a picked file was rejected — the caller localizes these. */
export type AttachmentError = "too-large" | "wrong-type" | "read-failed";

/** Validate a picked file up front (type + size) before reading it. */
export function validateImageFile(file: File): AttachmentError | null {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) return "wrong-type";
  if (file.size > MAX_ATTACHMENT_BYTES) return "too-large";
  return null;
}

/**
 * Read a picked File into a data URL. Rejects with an {@link AttachmentError}
 * ("read-failed") on an unreadable/aborted read so the caller can toast — the
 * FileReader errors are otherwise silent.
 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject("read-failed" as AttachmentError);
    reader.onabort = () => reject("read-failed" as AttachmentError);
    reader.readAsDataURL(file);
  });
}

/** A game self-screenshot is already a PNG data URL — wrap it as an attachment. */
export function screenshotAttachment(dataUrl: string): ComposerAttachment {
  return { dataUrl, source: "screenshot" };
}
