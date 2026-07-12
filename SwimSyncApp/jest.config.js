module.exports = {
  preset: "jest-expo",
  // Keep the first suite to pure/unit tests. RN component-render tests (with
  // nativewind) can be added later behind the same preset.
  testMatch: ["**/lib/**/*.test.ts", "**/lib/**/*.test.tsx"],
};
