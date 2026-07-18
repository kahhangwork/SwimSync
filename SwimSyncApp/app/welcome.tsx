import { View, Text, ScrollView } from "react-native";
import { router } from "expo-router";
import PrimaryButton from "@/components/PrimaryButton";
import Logo from "@/components/Logo";

const STEPS: { title: string; body: string }[] = [
  {
    title: "Register",
    body: "Create your account with your email and a password.",
  },
  {
    title: "Add your child",
    body: "Enter their name, date of birth and gender. Add all your children under one account.",
  },
  {
    title: "Get assigned",
    body: 'Your coach places each child in the right class. Until then you\'ll see a "Not assigned yet" status.',
  },
  {
    title: "Track & pay",
    body: "View attendance and monthly invoices, and pay easily with your coach's PayNow QR code.",
  },
];

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <View className="flex-row gap-4">
      <View className="w-8 h-8 rounded-full bg-sky-500 items-center justify-center">
        <Text className="text-white font-bold">{n}</Text>
      </View>
      <View className="flex-1">
        <Text className="text-base font-semibold text-gray-900">{title}</Text>
        <Text className="text-sm text-gray-500 mt-0.5 leading-5">{body}</Text>
      </View>
    </View>
  );
}

export default function Welcome() {
  return (
    <ScrollView
      className="flex-1 bg-sky-50"
      contentContainerClassName="flex-grow px-6 py-12 max-w-xl w-full mx-auto"
    >
      {/* Header */}
      <View className="items-center mb-8">
        <Logo size="lg" className="mb-4" />
        <Text className="text-3xl font-bold text-gray-900">Welcome to SwimSync</Text>
        <Text className="text-gray-500 mt-2 text-base text-center leading-6">
          Swim class attendance & billing, all in one place. Set up your account
          in a couple of minutes.
        </Text>
      </View>

      {/* Steps card */}
      <View className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 gap-6 mb-8">
        {STEPS.map((s, i) => (
          <Step key={s.title} n={i + 1} title={s.title} body={s.body} />
        ))}
      </View>

      {/* Actions */}
      <View className="gap-3">
        <PrimaryButton
          label="Get Started"
          onPress={() => router.push("/(auth)/register")}
        />
        <PrimaryButton
          label="I already have an account"
          variant="outline"
          onPress={() => router.push("/(auth)/login")}
        />
      </View>

      <Text className="text-center text-xs text-gray-400 mt-8">
        SwimSync · Swim attendance & billing
      </Text>
    </ScrollView>
  );
}
