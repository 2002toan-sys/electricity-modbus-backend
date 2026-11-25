import logger from './logger.js';

export function logAuthAudit(event, { req, userId, actorId } = {}) {
  const ip = String(req?.ip || 'unknown').replace(/[^\w.:%-]/g, '');
  const userAgent = String(req?.get?.('user-agent') || 'unknown')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 256);

  logger.info(
    `[audit] event=${event} user_id=${userId ?? 'unknown'} ` +
    `actor_id=${actorId ?? 'unknown'} ip=${ip} user_agent=${JSON.stringify(userAgent)}`
  );
}
