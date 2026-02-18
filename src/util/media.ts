export type AttachmentKind = "image" | "video" | "audio" | "link";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac"]);

function extensionFromPath(pathname: string): string | null {
  const match = pathname.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!match) {
    return null;
  }
  return match[1] ?? null;
}

export function classifyAttachmentUrl(url: string): AttachmentKind {
  try {
    const parsed = new URL(url);
    const extension = extensionFromPath(parsed.pathname);
    if (!extension) {
      return "link";
    }
    if (IMAGE_EXTENSIONS.has(extension)) {
      return "image";
    }
    if (VIDEO_EXTENSIONS.has(extension)) {
      return "video";
    }
    if (AUDIO_EXTENSIONS.has(extension)) {
      return "audio";
    }
    return "link";
  } catch {
    return "link";
  }
}
