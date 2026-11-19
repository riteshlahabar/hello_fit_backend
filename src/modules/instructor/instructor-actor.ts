/**
 * The two call-context shapes the instructor services take. Their own file so
 * that splitting the services did not leave every one of them importing a type
 * from a sibling service — `payout` imports `AdminActor` too.
 */

/**
 * Minimal shape of a multer file. `@types/multer` is deliberately not installed
 * — multer itself already ships inside `@nestjs/platform-express`, and this is
 * the only place its type is needed.
 */
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Context carried into the audit trail.
 *
 * `adminUserId` is the token subject on an admin route, which **is** the
 * `AdminUser.id` (`auth.adminLogin` signs `sub: admin.id`) — `AdminUser` has no
 * `userId` column at all, so there is nothing to look up. An earlier version of
 * this code tried to resolve one and would have thrown "Unknown argument
 * userId" on every admin action.
 */
export interface AdminActor {
  adminUserId: string;
  ipAddress?: string;
  requestId?: string;
}

/**
 * Builds the actor from the request. On an admin route the token subject is the
 * `AdminUser.id`, so `@CurrentUser('id')` already gives the audit row its
 * actor; the request id comes from `RequestIdMiddleware`.
 *
 * Shared by both admin instructor controllers so the two cannot write audit
 * rows with different provenance.
 */
export function adminActorFrom(
  userId: string,
  req: { ip?: string; headers: Record<string, unknown> },
): AdminActor {
  return {
    adminUserId: userId,
    ipAddress: req.ip,
    requestId: req.headers['x-request-id'] as string | undefined,
  };
}
