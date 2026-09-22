import {
  createUploadTask,
  FileSystemUploadType,
  FileSystemSessionType,
} from "expo-file-system/legacy";
import type { MediaAsset } from "./social/types";

/** Upload the file directly from disk; never hold a base64 video in JS memory. */
export async function uploadNativeVideo(
  url: string,
  uri: string,
  token: string,
  mimeType?: string,
): Promise<MediaAsset> {
  const type =
    mimeType === "video/quicktime" || /\.mov(?:$|\?)/i.test(uri)
      ? "video/quicktime"
      : "video/mp4";
  const task = createUploadTask(url, uri, {
    httpMethod: "POST",
    uploadType: FileSystemUploadType.BINARY_CONTENT,
    sessionType: FileSystemSessionType.FOREGROUND,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": type,
      Accept: "application/json",
    },
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void task.cancelAsync().catch(() => {});
  }, 300_000);
  try {
    const result = await task.uploadAsync();
    if (!result || timedOut)
      throw new Error(
        "Video upload timed out. Keep Crewroom open and try a shorter clip or a faster connection.",
      );
    let data;
    try {
      data = JSON.parse(result.body);
    } catch {
      throw new Error(
        "Crewroom could not finish the video upload. Please try again.",
      );
    }
    if (result.status < 200 || result.status >= 300)
      throw new Error(
        typeof data?.error === "string"
          ? data.error
          : "Crewroom could not upload this video. Please try again.",
      );
    return data as MediaAsset;
  } catch (error) {
    if (timedOut)
      throw new Error(
        "Video upload timed out. Keep Crewroom open and try a shorter clip or a faster connection.",
      );
    throw error instanceof Error
      ? error
      : new Error("Video upload failed. Check your connection and try again.");
  } finally {
    clearTimeout(timeout);
  }
}
