module.exports = {
  preset: "jest-expo",
  // Keep the first suite to pure/unit tests. RN component-render tests (with
  // nativewind) can be added later behind the same preset.
  // features/ holds the tier folders of refactored screens (playbook §1) —
  // without it their domain/ tests would silently never run.
  testMatch: [
    "**/lib/**/*.test.ts",
    "**/lib/**/*.test.tsx",
    "**/features/**/*.test.ts",
    "**/features/**/*.test.tsx",
  ],
};
