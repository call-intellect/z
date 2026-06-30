import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import React, { useCallback, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { colors, radius, spacing } from "@/theme/theme";

export type ComposerAccess = "normal" | "internal" | "external";

interface Props {
  onSend: (text: string) => void;
  onVoiceRecorded?: (uri: string, durationSec: number) => void;
  supportMode?: boolean;
  access?: ComposerAccess;
  onAccessChange?: (access: ComposerAccess) => void;
  disabled?: boolean;
}

export function Composer({
  onSend,
  onVoiceRecorded,
  supportMode = false,
  access = "normal",
  onAccessChange,
  disabled = false,
}: Props) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const startedAtRef = useRef<number>(0);

  const send = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  }, [text, onSend]);

  const startRecording = useCallback(async () => {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAtRef.current = Date.now();
      setRecording(true);
    } catch {
      setRecording(false);
    }
  }, [recorder]);

  const stopRecording = useCallback(
    async (cancel: boolean) => {
      if (!recording) return;
      setRecording(false);
      try {
        await recorder.stop();
        await setAudioModeAsync({ allowsRecording: false });
        if (cancel) return;
        const uri = recorder.uri;
        const durationSec = Math.round(
          (Date.now() - startedAtRef.current) / 1000,
        );
        if (uri && durationSec > 0) onVoiceRecorded?.(uri, durationSec);
      } catch {
        // ignore stop errors
      }
    },
    [recorder, recording, onVoiceRecorded],
  );

  return (
    <View style={styles.wrap}>
      {supportMode ? (
        <View style={styles.accessRow}>
          <AccessChip
            label="Клиенту"
            active={access === "external"}
            onPress={() => onAccessChange?.("external")}
          />
          <AccessChip
            label="Заметка"
            active={access === "internal"}
            onPress={() => onAccessChange?.("internal")}
          />
        </View>
      ) : null}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={
            recording ? "Запись… отпустите для отправки" : "Сообщение"
          }
          placeholderTextColor={colors.textMuted}
          multiline
          editable={!disabled && !recording}
        />
        {text.trim().length > 0 ? (
          <Pressable
            style={[styles.btn, styles.sendBtn]}
            onPress={send}
            disabled={disabled}
          >
            <Text style={styles.sendText}>↑</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[
              styles.btn,
              recording ? styles.recBtnActive : styles.btnGhost,
            ]}
            onPressIn={() => void startRecording()}
            onPressOut={() => void stopRecording(false)}
            disabled={disabled}
          >
            <Text style={styles.micText}>{recording ? "●" : "🎙"}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function AccessChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active ? styles.chipActive : null]}
    >
      <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  accessRow: { flexDirection: "row", gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  chipActive: { backgroundColor: colors.accent },
  chipText: { color: colors.textMuted, fontSize: 12 },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    color: colors.text,
    fontSize: 15,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  btn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtn: { backgroundColor: colors.accent },
  btnGhost: { backgroundColor: colors.surfaceAlt },
  recBtnActive: { backgroundColor: colors.danger },
  sendText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  micText: { fontSize: 16 },
});
