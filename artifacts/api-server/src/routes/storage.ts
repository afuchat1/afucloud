/**
 * Storage serving route.
 * GET /v1/storage/:key — generates a pre-signed R2 GET URL and redirects.
 * The key is URL-encoded (encodeURIComponent) so slashes are %2F and fit a
 * single `:key` parameter.
 */
import { Router, type IRouter } from "express";
import { generateSignedGetUrl, hasCredentials } from "../lib/storage";

const router: IRouter = Router();

router.get("/v1/storage/:key", async (req, res): Promise<void> => {
  const rawKey = req.params.key as string;
  if (!rawKey) {
    res.status(400).json({ error: "Missing storage key" });
    return;
  }

  // The key was encoded with encodeURIComponent; Express auto-decodes params.
  const key = rawKey;

  if (!hasCredentials()) {
    res.status(503).json({ error: "Storage not configured" });
    return;
  }

  try {
    const signedUrl = await generateSignedGetUrl(key, 3600);
    // 302 redirect — browser follows it to load the image directly from R2.
    // Cache-Control lets browsers reuse the redirect for up to 5 minutes.
    res.setHeader("Cache-Control", "private, max-age=300");
    res.redirect(302, signedUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate signed URL";
    res.status(500).json({ error: message });
  }
});

export default router;
