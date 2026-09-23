import { useEffect, useState } from "react";
import { socialApi } from "../api";
import type { ModerationConfig } from "./types";

/** Advertising automatic publication requires a fresh, affirmative server response. */
export function useModerationPolicy() {
  const [config, setConfig] = useState<ModerationConfig | null>(null);
  useEffect(() => {
    let active = true;
    void socialApi.getModerationConfig().then((value) => {
      if (active) setConfig(value);
    }).catch(() => {
      // Older servers and failed requests keep the conservative publication copy.
    });
    return () => { active = false; };
  }, []);
  const automatic = config?.mode === "hybrid" && config.automaticScreening === true;
  const automaticVideo = automatic && config?.automaticVideoScreening === true;
  return {
    config,
    automatic,
    automaticVideo,
    videoSharingSummary: automaticVideo
      ? "Public videos and their sound are checked before sharing. Videos publish when checks pass; flagged or uncertain content may need operator review. Private drafts stay private."
      : "Public videos and their sound need operator review before sharing. You can save and play a private draft immediately.",
    sharingSummary: automatic
      ? "Public submissions are checked before sharing and publish automatically when checks pass. Flagged content may need operator review. Private drafts stay private."
      : "Public submissions are checked before sharing. Your work stays visible only to you until it and your profile are approved. Private drafts stay private.",
  };
}
