import { HttpsError, onCall } from "firebase-functions/v2/https";
import { genkit } from "genkit/beta";
import { googleAI } from "@genkit-ai/googleai";
import { z } from "zod";
import * as chrono from "chrono-node";

/** Initialize the Genkit AI engine with Gemini 2.0 Flash model. */
const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model("gemini-2.0-flash"),
});

/** Hardcoded user-to-doctor mapping. */
const doctorMap: Record<string, string> = {
  Alice: "Dr. Smith",
  Bob: "Dr. Johnson",
  Charlie: "Dr. Patel",
};

/** Hardcoded doctor ratings. */
const doctorRatings: Record<string, number> = {
  "Dr. Smith": 4.9,
  "Dr. Johnson": 4.7,
  "Dr. Patel": 4.8,
};

/** Hardcoded appointment times. */
const doctorAppointments: Record<string, Record<string, string[]>> = {
  "Dr. Smith": {
    "2025-08-10": ["10:00 AM", "1:00 PM"],
    "2025-08-11": ["11:00 AM"],
  },
  "Dr. Johnson": {
    "2025-08-12": ["2:30 PM"],
    "2025-08-13": ["9:00 AM", "3:00 PM"],
  },
  "Dr. Patel": {
    "2025-08-15": ["9:00 AM", "12:30 PM"],
  },
};

/**
 * Tool: Given a user's name, return their assigned doctor.
 */
const getDoctor = ai.defineTool(
  {
    name: "getDoctor",
    description: "Returns the assigned doctor for a given user name.",
    inputSchema: z.object({ name: z.string() }),
    outputSchema: z.object({ doctor: z.string() }),
  },
  async ({ name }) => {
    const doctor = doctorMap[name] || "No doctor found for this user";
    return { doctor };
  }
);

/**
 * Tool: Given a doctor and a natural-language date, return available appointment times.
 */
const getDoctorAppointmentsByDate = ai.defineTool(
  {
    name: "getDoctorAppointmentsByDate",
    description:
      "Returns available appointment times for a given doctor on a specific day. Dates can be in natural language.",
    inputSchema: z.object({
      doctor: z.string(),
      date: z.string(),
    }),
    outputSchema: z.object({
      appointments: z.array(z.string()),
    }),
  },
  async ({ doctor, date }) => {
    const parsedDate = chrono.parseDate(date);
    if (!parsedDate) return { appointments: [] };

    const normalized = parsedDate.toISOString().split("T")[0];
    const doctorData = doctorAppointments[doctor];
    const appointments = doctorData?.[normalized] ?? [];

    return { appointments };
  }
);

/**
 * Tool: Return the numeric rating of a given doctor.
 */
const getDoctorRating = ai.defineTool(
  {
    name: "getDoctorRating",
    description: "Returns the rating of a given doctor by name.",
    inputSchema: z.object({ doctor: z.string() }),
    outputSchema: z.object({ rating: z.number() }),
  },
  async ({ doctor }) => {
    const rating = doctorRatings[doctor];
    return { rating: rating ?? 0 };
  }
);

/**
 * Main LLM chat function with tool support.
 */
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
You are a helpful health assistant. You support users by answering health-related questions and providing contextual help using tools.

- Use the getDoctor tool if someone asks who their doctor is.
- Use the getDoctorAppointmentsByDate tool if someone asks when a doctor is available on a specific day.
- Use the getDoctorRating tool if someone asks about a doctor's rating.
- Dates may be written in natural language like "next Friday" or "August 10th 2025". Be sure to normalize dates before searching appointments.
    `.trim(),
    tools: [getDoctor, getDoctorAppointmentsByDate, getDoctorRating],
  });

  const response = await chat.send(message);

  return {
    id: Date.now().toString(),
    text: response.text,
    variant: "received",
    timestamp: Date.now(),
  };
});
