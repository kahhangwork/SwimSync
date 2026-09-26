module.exports = {
  preset: "jest-expo",
  // Pure/unit tests, plus component-render tests via @testing-library/react-native
  // (features/*/ui/*.test.tsx). Under jest NativeWind does NOT compile className
  // into a style — the class string reaches the host element as a raw
  // `className` prop, so assert on that, never on `style`.
  // features/ holds the tier folders of refactored screens (playbook §1) —
  // without it their domain/ tests would silently never run.
  testMatch: [
    "**/lib/**/*.test.ts",
    "**/lib/**/*.test.tsx",
    "**/features/**/*.test.ts",
    "**/features/**/*.test.tsx",
  ],
};
