export const ROLES = Object.freeze(['owner', 'editor', 'viewer']);

/** Higher rank = more permissions. */
export const RANK = Object.freeze({ viewer: 0, editor: 1, owner: 2 });

/**
 * @param {string | null | undefined} role
 * @param {'viewer' | 'editor' | 'owner'} min
 */
export const hasRole = (role, min) => role != null && role in RANK && RANK[role] >= RANK[min];

export const canEdit = (role) => hasRole(role, 'editor');
export const canManageBoard = (role) => hasRole(role, 'owner');
