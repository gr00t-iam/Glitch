import "@testing-library/jest-dom";

// jsdom intentionally omits media playback; these stubs keep voice tests focused on UI behavior.
Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: jest.fn().mockResolvedValue(undefined),
});
Object.defineProperty(HTMLMediaElement.prototype, "pause", {
  configurable: true,
  value: jest.fn(),
});
