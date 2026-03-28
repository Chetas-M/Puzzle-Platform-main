import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

export async function issueTeamSession({ prisma, team, event, config }) {
  const tokenId = randomUUID();
  const graceMs = 2 * 60 * 60 * 1000;
  const minLifetimeMs = 8 * 60 * 60 * 1000;
  const eventBasedExpiry = event.endsAt.getTime() + graceMs;
  const expiresAt = new Date(Math.max(eventBasedExpiry, Date.now() + minLifetimeMs));

  const session = await prisma.teamSession.create({
    data: {
      tokenId,
      teamId: team.id,
      expiresAt
    }
  });

  const token = jwt.sign(
    {
      sid: session.id,
      tid: team.id,
      adm: team.isAdmin,
      jti: tokenId
    },
    config.SESSION_SECRET,
    { expiresIn: Math.max(3600, Math.floor((expiresAt.getTime() - Date.now()) / 1000)) }
  );

  return { token, session };
}

export async function getSessionFromRequest(req, prisma, config) {
  const token = req.cookies?.[config.COOKIE_NAME];
  if (!token) {
    return null;
  }

  try {
    const payload = jwt.verify(token, config.SESSION_SECRET);
    const session = await prisma.teamSession.findUnique({
      where: { id: payload.sid },
      include: { team: true }
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      return null;
    }

    if (session.tokenId !== payload.jti) {
      return null;
    }

    return {
      session,
      team: session.team,
      tokenPayload: payload
    };
  } catch {
    return null;
  }
}

export function requireTeamSession({ prisma, config }) {
  return async (req, res, next) => {
    const loaded = await getSessionFromRequest(req, prisma, config);
    if (!loaded) {
      return res.status(401).json({ ok: false, message: "Team session required." });
    }

    req.auth = loaded;
    return next();
  };
}

export function requireAdmin(req, res, next) {
  if (!req.auth?.team?.isAdmin) {
    return res.status(403).json({ ok: false, message: "Admin access required." });
  }

  return next();
}
