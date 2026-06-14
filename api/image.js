import { imageHandler } from "../lib/handlers.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  return imageHandler(req, res);
}
