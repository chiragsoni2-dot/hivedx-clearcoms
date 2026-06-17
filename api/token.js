// Vercel serverless function — generates a LiveKit access token.
// Receives:  GET /api/token?room=...&identity=...&name=...
// Returns:   { token, wsUrl }
//
// Required environment variables (set in Vercel dashboard):
//   LIVEKIT_API_KEY     — from your LiveKit Cloud project
//   LIVEKIT_API_SECRET  — from your LiveKit Cloud project
//   LIVEKIT_WS_URL      — looks like  wss://your-project.livekit.cloud

import { AccessToken } from 'livekit-server-sdk';

export default async function handler(req, res) {
  try {
    const room = (req.query.room || '').toString().trim();
    const identity = (req.query.identity || '').toString().trim();
    const name = (req.query.name || identity).toString().trim();

    if (!room || !identity) {
      return res.status(400).json({ error: 'room and identity are required' });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const wsUrl = process.env.LIVEKIT_WS_URL;

    if (!apiKey || !apiSecret || !wsUrl) {
      return res.status(500).json({
        error:
          'Server is missing LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_WS_URL. ' +
          'Add them in Vercel → Project → Settings → Environment Variables, then redeploy.',
      });
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name,
      ttl: 60 * 60 * 4, // token valid for 4 hours
    });
    at.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const jwt = await at.toJwt();
    return res.status(200).json({ token: jwt, wsUrl });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Token generation failed' });
  }
}
