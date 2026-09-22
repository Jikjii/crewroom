import React from "react";
import {
  Image,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { mediaSource } from "../api";
import type { MediaAsset } from "./types";

export interface VideoPlayerProps {
  media: MediaAsset;
  active?: boolean;
  controls?: boolean;
  muted?: boolean;
  suspended?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Web deep links retain the project and poster; playback is native-only. */
export default function VideoPlayer({ media, style }: VideoPlayerProps) {
  return (
    <View style={[{ backgroundColor: "#09090E", overflow: "hidden" }, style]}>
      {media.posterUrl && (
        <Image
          source={mediaSource(media, { poster: true })}
          accessibilityLabel={media.alt || "Video preview"}
          style={{ flex: 1 }}
          resizeMode="contain"
        />
      )}
      <Text style={{ color: "#FFFFFF", padding: 16, textAlign: "center" }}>
        Watch this video in the Crewroom phone app.
      </Text>
    </View>
  );
}
