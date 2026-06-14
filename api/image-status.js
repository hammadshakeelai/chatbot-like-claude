import { imageStatusHandler } from "../lib/handlers.js";

export default async function handler(req, res) {
  return imageStatusHandler(req, res);
}
