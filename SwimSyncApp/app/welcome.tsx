import { View, Text, ScrollView } from "react-native";
import { router } from "expo-router";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import Logo from "@/components/Logo";

// UI restyle step 4.1 (DESIGN.md): Ground, one flat card, square neutral step
// numbers (the 3.3 PayNow shape), one Lane Blue primary — "I already have an
// account" is the secondary beside it. Words and both routes are unchanged.

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
    <View className="flex-row gap-3">
      <View className="w-6 h-6 rounded-tag border border-border bg-ground items-center justify-center">
        <Text className="text-label font-semibold text-ink-secondary">{n}</Text>
      </View>
      <View className="flex-1">
        <Text className="text-headline font-semibold text-ink">{title}</Text>
        <Text className="text-body-secondary text-ink-secondary mt-0.5">{body}</Text>
      </View>
    </View>
  );
}

export default function Welcome() {
  return (
    <ScrollView
      className="flex-1 bg-ground"
      contentContainerClassName="flex-grow px-5 py-12 max-w-xl w-full mx-auto"
    >
      {/* Header */}
      <View className="items-center mb-8">
        <Logo size="lg" className="mb-4" />
        <Text className="text-display font-semibold text-ink text-center">Welcome to SwimSync</Text>
        <Text className="text-body text-ink-secondary mt-2 text-center">
          Swim class attendance & billing, all in one place. Set up your account
          in a couple of minutes.
        </Text>
      </View>

      {/* Steps card */}
      <Surface className="gap-5 mb-8">
        {STEPS.map((s, i) => (
          <Step key={s.title} n={i + 1} title={s.title} body={s.body} />
        ))}
      </Surface>

      {/* Actions */}
      <View className="gap-3">
        <Button
          label="Get Started"
          onPress={() => router.push("/(auth)/register")}
        />
        <Button
          label="I already have an account"
          variant="secondary"
          onPress={() => router.push("/(auth)/login")}
        />
      </View>

      <Text className="text-center text-label text-ink-muted mt-8">
        SwimSync · Swim attendance & billing
      </Text>
    </ScrollView>
  );
}
