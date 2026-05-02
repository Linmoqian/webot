import { convertFileSrc } from "@tauri-apps/api/core";

export const IMAGE_EXTS = new Set([
  "jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "tiff", "ico",
]);

export function getImageExt(value: string): string {
  const withoutQuery = value.split(/[?#]/)[0];
  return withoutQuery.split(".").pop()?.toLowerCase() || "";
}

export function isImagePath(value: string): boolean {
  return IMAGE_EXTS.has(getImageExt(value));
}

export function isPassThroughUrl(value: string): boolean {
  return /^(https?:|asset:|data:|blob:)/i.test(value);
}

export function isLocalPath(value: string): boolean {
  return /^(file:|[a-zA-Z]:[\\/]|\\\\|\/)/.test(value);
}

export function fileUrlToPath(value: string): string {
  try {
    const url = new URL(value);
    const pathname = decodeURIComponent(url.pathname);
    if (/^\/[a-zA-Z]:/.test(pathname)) {
      return pathname.slice(1);
    }
    return pathname;
  } catch {
    return value.replace(/^file:\/\//i, "");
  }
}

export function resolveImageSrc(src: string | undefined, mediaDir = ""): string | undefined {
  if (!src) return src;

  const trimmed = src.trim();
  if (isPassThroughUrl(trimmed)) return trimmed;

  if (/^file:/i.test(trimmed)) {
    return convertFileSrc(fileUrlToPath(trimmed));
  }

  if (isLocalPath(trimmed)) {
    return convertFileSrc(trimmed);
  }

  if (mediaDir && isImagePath(trimmed)) {
    return convertFileSrc(`${mediaDir}/${trimmed}`);
  }

  return trimmed;
}

export function transformMarkdownUrl(url: string, mediaDir = ""): string {
  if (isImagePath(url) || /^file:/i.test(url) || isLocalPath(url)) {
    return resolveImageSrc(url, mediaDir) || url;
  }
  return url;
}

export function preprocessMediaMarkers(text: string, mediaDir: string): string {
  return text.replace(/\[media:\s*([^\]]+)\]/g, (_match, filename: string) => {
    const trimmed = filename.trim();
    const filePath = `${mediaDir}/${trimmed}`;
    const url = convertFileSrc(filePath);
    const ext = trimmed.split(".").pop()?.toLowerCase() || "";
    if (IMAGE_EXTS.has(ext)) {
      return `![${trimmed}](${url})`;
    }
    return `[${trimmed}](${url})`;
  });
}

export function preprocessLocalImageLines(text: string, mediaDir = ""): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (
        trimmed &&
        !trimmed.startsWith("!") &&
        isImagePath(trimmed) &&
        (isLocalPath(trimmed) || (mediaDir && !/^[a-z]+:/i.test(trimmed)))
      ) {
        const url = resolveImageSrc(trimmed, mediaDir) || trimmed;
        return `${line.slice(0, line.indexOf(trimmed))}![${trimmed}](${url})`;
      }
      return line;
    })
    .join("\n");
}
