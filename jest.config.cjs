/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/tests/setupTests.ts"],
  testMatch: ["<rootDir>/tests/**/*.test.ts", "<rootDir>/tests/**/*.test.tsx"],
  moduleNameMapper: {
    "^react-window$": "<rootDir>/src/vendor/react-window.tsx",
    "\\.(css|less|scss)$": "<rootDir>/tests/styleMock.ts",
  },
};
