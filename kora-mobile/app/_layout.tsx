import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { startOutboxAutoFlush } from "@/api/outbox";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Loader } from "@/components/StatusViews";
import { LoginScreen } from "@/screens/LoginScreen";
import { colors } from "@/theme/theme";

function Gate() {
  const { user, initializing } = useAuth();

  useEffect(() => {
    const stop = startOutboxAutoFlush();
    return stop;
  }, []);

  if (initializing) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Loader label="Загрузка" />
      </View>
    );
  }

  if (!user) return <LoginScreen />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="chat/[id]" options={{ title: "Чат" }} />
      <Stack.Screen name="issue/[id]" options={{ title: "Задача" }} />
      <Stack.Screen name="blocked" options={{ title: "Заблокированные" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
