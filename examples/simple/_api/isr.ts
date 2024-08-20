import type { VercelRequest, VercelResponse } from "@vercel/node";

export const isr = { expiration: 10 };

export default async function handler(request: VercelRequest, response: VercelResponse) {
  return response.send("OK");
}
