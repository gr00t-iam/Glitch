export default {
  id: "echo-tool-demo",
  name: "Echo Tool Demo",
  description: "Routes prompts beginning with echo to the echo tool.",
  triggers: ["echo"],
  instructions: "Use the echo tool for simple tool-calling smoke tests.",
  apply({ userInput }) {
    if (!userInput.toLowerCase().startsWith("echo ")) return {};
    return { suggestedTool: { name: "echo", args: { text: userInput.slice(5) } } };
  },
};
