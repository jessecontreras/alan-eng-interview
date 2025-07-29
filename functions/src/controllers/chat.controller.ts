import { HttpsError, onCall } from "firebase-functions/v2/https";
import { genkit } from "genkit/beta";
import { googleAI } from "@genkit-ai/googleai";

const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model("gemini-2.0-flash"),
});


export const chat = onCall({}, async (request) => {
  const { message } = request.data;

  if (!message || typeof message !== "string") {
    throw new HttpsError(
      "invalid-argument",
      "Message must be a non-empty string"
    );
  }

  const chat = ai.chat({
    system: `
You are a Alan's shealth assistant. You help people achieve maximum happiness and wellness.
    `.trim(),
  });

  const response = await chat.send(message);

  return {
    id: Date.now().toString(),
    text: response.text,
    variant: "received",
    timestamp: Date.now(),
  };
});
