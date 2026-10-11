export default {
  name: "echo",
  description: "Echo text back to the caller. Useful for verifying tool routing.",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Text to echo.",
      },
    },
    required: ["text"],
    additionalProperties: false,
  },
  async handler(args) {
    return {
      echoed: String(args.text ?? ""),
      at: new Date().toISOString(),
    };
  },
};
