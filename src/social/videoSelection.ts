/** The native picker reports duration in milliseconds; the API uses seconds. */
export function validateVideoSelection(
  asset: { duration?: number | null; fileSize?: number; type?: string | null },
  limits: { maxDuration: number; maxBytes: number },
): void {
  const maxDuration = Math.min(60, limits.maxDuration);
  const maxBytes = Math.min(50 * 1024 * 1024, limits.maxBytes);
  if (
    !Number.isFinite(maxDuration) ||
    maxDuration <= 0 ||
    !Number.isFinite(maxBytes) ||
    maxBytes <= 0
  ) {
    throw new Error(
      "Video is temporarily unavailable. Please try again later.",
    );
  }
  if (asset.type && asset.type !== "video") {
    throw new Error("Choose a video file to continue.");
  }
  if (
    !Number.isFinite(asset.duration) ||
    !asset.duration ||
    asset.duration <= 0
  ) {
    throw new Error(
      "We couldn’t read this video’s length. Choose a different clip or record a new one.",
    );
  }
  if (asset.duration > maxDuration * 1000) {
    throw new Error(
      `Choose a clip of ${maxDuration} seconds or less. You can trim it in your phone’s Photos app first.`,
    );
  }
  if (
    !Number.isFinite(asset.fileSize) ||
    !asset.fileSize ||
    asset.fileSize <= 0
  ) {
    throw new Error(
      "We couldn’t read this video file. Choose a different clip or record a new one.",
    );
  }
  if (asset.fileSize > maxBytes) {
    throw new Error(
      `Choose a video under ${Math.floor(maxBytes / (1024 * 1024))} MB. A shorter or lower-resolution clip will work.`,
    );
  }
}
