import { Tabs } from "expo-router";
import { useTabScreenOptions, tabIcon } from "@/components/TabBar";

export default function ParentLayout() {
  const tabScreenOptions = useTabScreenOptions();
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: tabIcon("home-outline"),
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: "Attendance",
          tabBarIcon: tabIcon("calendar-outline"),
        }}
      />
      <Tabs.Screen
        name="billing"
        options={{
          title: "Billing",
          tabBarIcon: tabIcon("receipt-outline"),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: tabIcon("person-outline"),
        }}
      />
    </Tabs>
  );
}
