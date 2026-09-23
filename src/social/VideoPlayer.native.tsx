import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Image,
  Pressable,
  Text,
  View,
} from "react-native";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { mediaSource } from "../api";
import { Icon } from "../ui";
import type { VideoPlayerProps } from "./VideoPlayer";

export default function VideoPlayer({
  media,
  active = false,
  controls = true,
  muted = false,
  onMutedChange,
  suspended = false,
  style,
}: VideoPlayerProps) {
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  const [localMuted, setLocalMuted] = useState(muted);
  const soundOff = onMutedChange ? muted : localMuted;
  const player = useVideoPlayer(
    { ...mediaSource(media), useCaching: false },
    (p) => {
      p.loop = !controls;
      p.muted = soundOff;
      p.staysActiveInBackground = false;
      p.audioMixingMode = "mixWithOthers";
    },
  );
  const { status } = useEvent(player, "statusChange", {
    status: player.status,
  });
  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  });
  useEffect(() => {
    const sub = AppState.addEventListener("change", (value) =>
      setForeground(value === "active"),
    );
    return () => sub.remove();
  }, []);
  useEffect(() => {
    player.muted = soundOff;
  }, [soundOff, player]);
  useEffect(() => {
    if (active && foreground && !suspended) player.play();
    else player.pause();
  }, [active, foreground, suspended, player]);
  return (
    <View style={[{ backgroundColor: "#09090E", overflow: "hidden" }, style]}>
      <VideoView
        player={player}
        style={{ width: "100%", height: "100%" }}
        contentFit="contain"
        nativeControls={controls && !suspended}
        fullscreenOptions={{ enable: controls }}
        allowsPictureInPicture={false}
        surfaceType="textureView"
        accessibilityLabel={media.alt || "Cosplay video"}
      />
      {(status === "loading" || status === "idle") && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            inset: 0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {media.posterUrl && (
            <Image
              source={mediaSource(media, { poster: true })}
              style={{ position: "absolute", inset: 0 }}
              resizeMode="contain"
            />
          )}
          <ActivityIndicator size="large" color="#FFFFFF" />
        </View>
      )}
      {status === "error" && (
        <View
          accessibilityRole="alert"
          style={{
            position: "absolute",
            top: "35%",
            alignSelf: "center",
            backgroundColor: "#14131F",
            borderRadius: 16,
            padding: 18,
            gap: 12,
            maxWidth: "85%",
          }}
        >
          <Text style={{ color: "#FFFFFF" }}>
            This video couldn’t load. Check your connection or reopen the post.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              void player
                .replaceAsync({ ...mediaSource(media), useCaching: false })
                .then(() => {
                  if (active && foreground && !suspended) player.play();
                })
                .catch(() => {})
            }
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ color: "#D8B4FE", fontWeight: "700" }}>
              Retry video
            </Text>
          </Pressable>
        </View>
      )}
      {!controls && !suspended && status !== "error" && (
        <View
          style={{
            position: "absolute",
            top: 86,
            right: 18,
            flexDirection: "row",
            gap: 8,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? "Pause video" : "Play video"}
            onPress={() =>
              isPlaying ? player.pause() : foreground && player.play()
            }
            style={button}
          >
            <Icon
              name={isPlaying ? "pause" : "play"}
              color="#FFFFFF"
              size={23}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={soundOff ? "Unmute video" : "Mute video"}
            onPress={() => {
              const nextMuted = !soundOff;
              if (onMutedChange) onMutedChange(nextMuted);
              else setLocalMuted(nextMuted);
            }}
            style={button}
          >
            <Icon
              name={soundOff ? "volume-mute" : "volume-high"}
              color="#FFFFFF"
              size={23}
            />
          </Pressable>
        </View>
      )}
    </View>
  );
}
const button = {
  width: 48,
  height: 48,
  borderRadius: 24,
  backgroundColor: "rgba(9,9,14,0.8)",
  alignItems: "center",
  justifyContent: "center",
} as const;
