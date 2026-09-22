import type { MediaAsset } from "./social/types";

/** Web intentionally has no video upload surface in this beta. */
export async function uploadNativeVideo(
  _url: string,
  _uri: string,
  _token: string,
  _mimeType?: string,
): Promise<MediaAsset> {
  throw new Error("Use the Crewroom phone app to upload a video.");
}
