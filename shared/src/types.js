/**
 * JSDoc shapes for payloads shared by server and client (ADR-009). No runtime code.
 *
 * @typedef {'owner' | 'editor' | 'viewer'} Role
 *
 * @typedef {object} Member
 * @property {string} userId
 * @property {Role} role
 *
 * @typedef {object} Label
 * @property {string} _id
 * @property {string} name
 * @property {string} color
 *
 * @typedef {object} Board
 * @property {string} _id
 * @property {string} title
 * @property {Member[]} members
 * @property {Label[]} labels
 * @property {number} revision
 *
 * @typedef {object} List
 * @property {string} _id
 * @property {string} boardId
 * @property {string} title
 * @property {string} position
 * @property {boolean} archived
 *
 * @typedef {object} Card
 * @property {string} _id
 * @property {string} boardId
 * @property {string} listId
 * @property {string} title
 * @property {string} description
 * @property {string} position
 * @property {number} version
 * @property {string[]} assigneeIds
 * @property {string[]} labelIds
 * @property {string | null} dueDate   ISO string (UTC)
 * @property {boolean} completed
 * @property {boolean} archived
 * @property {number} commentCount
 *
 * @typedef {object} Rebalanced
 * @property {string} [listId]
 * @property {Record<string, string>} positions   id → position
 *
 * @typedef {object} RevisionedMeta   Fields on every revisioned board event
 * @property {number} revision
 * @property {string} actorId
 * @property {string} [clientMutationId]
 */
export {};
