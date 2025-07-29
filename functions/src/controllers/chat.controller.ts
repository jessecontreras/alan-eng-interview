import { HttpsError, onCall } from "firebase-functions/v2/https";
import { genkit, SessionStore, SessionData } from "genkit/beta";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { googleAI } from "@genkit-ai/googleai";
import { z } from "zod";
import * as chrono from "chrono-node";

/**
 * A simple session store that reads and writes session data
 * as JSON files to the local filesystem.
 *
 * @template S - The type of session state stored.
 */
class JsonSessionStore<S = any> implements SessionStore<S> {
  /**
   * Retrieves session data for a given session ID.
   * @param sessionId - The unique session identifier.
   * @returns The session data, or undefined if not found.
   */
  async get(sessionId: string): Promise<SessionData<S> | undefined> {
    try {
      const fullPath = path.resolve("./session_" + sessionId + ".json");
      const raw = await readFile(fullPath, "utf8");
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  /**
   * Saves session data to a JSON file.
   * @param sessionId - The unique session identifier.
   * @param sessionData - The data to persist.
   */
  async save(sessionId: string, sessionData: SessionData<S>): Promise<void> {
    const fullPath = path.resolve("./session_" + sessionId + ".json");
    await writeFile(fullPath, JSON.stringify(sessionData, null, 2), "utf8");
  }
}

/** Initialize the Genkit AI engine with Gemini 2.0 Flash model. */
const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model("gemini-2.0-flash"),
});

/** Hardcoded mapping of user names to their assigned doctors. */
const doctorMap: Record<string, string> = {
  Alice: "Dr. Smith",
  Bob: "Dr. Johnson",
  Charlie: "Dr. Patel",
};

/** Hardcoded mapping of doctor names to their ratings. */
const doctorRatings: Record<string, number> = {
  "Dr. Smith": 4.9,
  "Dr. Johnson": 4.7,
  "Dr. Patel": 4.8,
};

/** Hardcoded mapping of doctor availability by date. */
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
 * Tool that maps a user's name to their assigned doctor.
 */
const getDoctor = ai.defineTool(
  {
    name: "getDoctor",
    description:
      "Given a user's name, return the full name of the doctor assigned to that user.",
    inputSchema: z.object({
      name: z.string(),
    }),
    outputSchema: z.object({
      doctor: z.string(),
    }),
  },
  async ({ name }) => {
    const doctor = doctorMap[name] || "No doctor found for this user";
    return { doctor };
  }
);

/**
 * Tool that returns a doctor's appointment times on a given date.
 * Supports natural language date inputs.
 */
const getDoctorAppointmentsByDate = ai.defineTool(
  {
    name: "getDoctorAppointmentsByDate",
    description:
      "Use this tool when a user asks when a doctor is available on a specific day. The date can be written in natural language like 'next Friday' or 'August 10th'. Return a list of appointment times (such as '10:00 AM', '1:30 PM', etc.) for the given doctor on that day.",
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
 * Tool that returns the rating for a given doctor.
 */
const getDoctorRating = ai.defineTool(
  {
    name: "getDoctorRating",
    description:
      "Given a doctor's full name, return their numeric rating based on patient feedback. The Doctor rating is a floating point number associated with their name.",
    inputSchema: z.object({ doctor: z.string() }),
    outputSchema: z.object({ rating: z.number() }),
  },
  async ({ doctor }) => {
    const rating = doctorRatings[doctor];
    return { rating: rating ?? 0 };
  }
);

/**
 * Cloud function that handles incoming chat messages and returns AI-generated responses.
 * Initializes or resumes a user session, then invokes the AI chat engine with contextual tools.
 */
export const chat = onCall({}, async (request) => {
  const { message, userId = "anonymous" } = request.data;

  if (!message || typeof message !== "string") {
    throw new HttpsError(
      "invalid-argument",
      "Message must be a non-empty string"
    );
  }

  const session = await ai.loadSession(userId, {
    store: new JsonSessionStore(),
  });

  if (!session.state?.userName) {
    await session.updateState({ userName: "Pavel" });
  }

  const chat = session.chat("main", {
    system: `
You are a health assistant. You help people achieve maximum happiness and wellness.
- Use the getDoctor tool if someone asks who their doctor is.
- Use the getDoctorAppointmentsByDate tool if someone asks when a doctor is available on a specific day.
- Dates might be written naturally like "next Friday" or "August 10th 2025" — convert them into standard date format first.
    `.trim(),
    tools: [getDoctor, getDoctorRating, getDoctorAppointmentsByDate],
  });

  let response = await chat.send(message);

  return {
    id: Date.now().toString(),
    text: response.text,
    variant: "received",
    timestamp: Date.now(),
  };
});

/**
 * Cloud function that loads a user's previous session and returns past messages.
 */
export const loadSession = onCall({}, async (request) => {
  const { userId = "anonymous" } = request.data;

  const session = await ai.loadSession(userId, {
    store: new JsonSessionStore(),
  });
  
  //Hard code the thread id
  const chat = session.chat("main");

  const messages = chat.messages.map((m) => ({
    id: Date.now().toString(),
    text: Array.isArray(m.content)
      ? m.content
          .map((c) => (typeof c.text === "string" ? c.text : ""))
          .join("\n")
      : "",
    variant: m.role === "user" ? "sent" : "received",
    timestamp: Date.now(),
  }));

  return { messages };
});
