import { Tabs } from "expo-router";
import React from "react";
import { Text, type ColorValue } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useUnreadCount } from "@/hooks/useThreads";
import { colors } from "@/theme/theme";

function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ color, fontSize: 20 }}>{glyph}</Text>;
}

export default function TabsLayout() {
  const { canSeeSupport } = useAuth();
  const { total } = useUnreadCount();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Сообщения",
          tabBarBadge: total > 0 ? (total > 99 ? "99+" : total) : undefined,
          tabBarIcon: ({ color }) => <TabIcon glyph="💬" color={color} />,
        }}
      />
      <Tabs.Screen
        name="support"
        options={{
          title: "Поддержка",
          href: canSeeSupport ? undefined : null,
          tabBarIcon: ({ color }) => <TabIcon glyph="🎧" color={color} />,
        }}
      />
      <Tabs.Screen
        name="kora"
        options={{
          title: "Кора",
          tabBarIcon: ({ color }) => <TabIcon glyph="✦" color={color} />,
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: "Я",
          tabBarIcon: ({ color }) => <TabIcon glyph="👤" color={color} />,
        }}
      />
    </Tabs>
  );
}
