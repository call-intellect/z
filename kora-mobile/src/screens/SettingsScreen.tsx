import { useRouter } from "expo-router";
import React, { useCallback } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { accountApi } from "@/api/account.api";
import { clearSession } from "@/api/session";
import { useAuth } from "@/context/AuthContext";
import { colors, radius, spacing } from "@/theme/theme";

export function SettingsScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();

  const confirmDelete = useCallback(() => {
    Alert.alert(
      "Удалить аккаунт",
      "Аккаунт и доступ к переписке будут удалены безвозвратно. Продолжить?",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: () => {
            void accountApi
              .deleteAccount()
              .then(async () => {
                await clearSession();
                await signOut();
              })
              .catch(() =>
                Alert.alert("Ошибка", "Не удалось удалить аккаунт"),
              );
          },
        },
      ],
    );
  }, [signOut]);

  return (
    <View style={styles.container}>
      <View style={styles.profile}>
        <Text style={styles.name}>{user?.name ?? "—"}</Text>
        <Text style={styles.email}>{user?.email ?? ""}</Text>
      </View>

      <SettingsRow
        label="Заблокированные пользователи"
        onPress={() => router.push("/blocked")}
      />
      <SettingsRow label="Выйти" onPress={() => void signOut()} />
      <SettingsRow
        label="Удалить аккаунт"
        danger
        onPress={confirmDelete}
      />
    </View>
  );
}

function SettingsRow({
  label,
  onPress,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Text style={[styles.rowLabel, danger ? styles.danger : null]}>
        {label}
      </Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  profile: {
    padding: spacing.lg,
    gap: 4,
  },
  name: { color: colors.text, fontSize: 20, fontWeight: "700" },
  email: { color: colors.textMuted, fontSize: 14 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  rowLabel: { color: colors.text, fontSize: 15 },
  danger: { color: colors.danger },
  chevron: { color: colors.textMuted, fontSize: 22 },
});
