import { EVT } from '@syncboard/shared/events';
import { DELETED } from './ops.js';
import {
  confirmEntity, patchConfirmed, applyRebalanced, dropCardsOfList, cardIdsWhere, knowsList,
} from './engine.js';

/**
 * Applies one revisioned board event to the `board` slice draft (docs/04 — Event Catalog).
 * Called by the reducer in revision order (the pipeline guarantees it).
 *
 * Own echo: when `clientMutationId` names one of our pending ops, that op is removed first, so
 * the event's entity becomes the new base with only the REMAINING ops replayed on top (ADR-011).
 * If the op is already gone (its REST call failed or timed out but the change committed anyway),
 * the event is applied like any teammate's change, and the state still ends up correct.
 */
export function applyEvent(state, type, p, { myUserId } = {}) {
  if (p.clientMutationId) {
    const i = state.ops.findIndex((o) => o.mid === p.clientMutationId);
    if (i !== -1) state.ops.splice(i, 1);
  }
  const boardId = state.meta?._id;

  switch (type) {
    case EVT.CARD_CREATED:
      applyRebalanced(state, 'card', p.rebalanced);
      // A card in a list this client doesn't have (archived) isn't shown.
      if (knowsList(state, p.card.listId) || p.card._id in state.bases) confirmEntity(state, 'card', p.card._id, p.card);
      break;
    case EVT.CARD_UPDATED:
      applyRebalanced(state, 'card', p.rebalanced);
      confirmEntity(state, 'card', p.card._id, p.card);
      state.lastActor[p.card._id] = p.actorId;
      break;
    case EVT.CARD_MOVED:
      applyRebalanced(state, 'card', p.rebalanced);
      confirmEntity(state, 'card', p.card._id, p.card);
      break;
    case EVT.CARD_DELETED:
      confirmEntity(state, 'card', p.cardId, DELETED);
      break;

    case EVT.LIST_CREATED:
    case EVT.LIST_MOVED:
      applyRebalanced(state, 'list', p.rebalanced);
      confirmEntity(state, 'list', p.list._id, p.list);
      break;
    case EVT.LIST_UPDATED:
      applyRebalanced(state, 'list', p.rebalanced);
      // A restored list whose cards were never loaded: only a fresh snapshot has them (docs/11 F4).
      if (!p.list.archived && !knowsList(state, p.list._id)) state.needsResync = true;
      else confirmEntity(state, 'list', p.list._id, p.list);
      break;
    case EVT.LIST_DELETED:
      confirmEntity(state, 'list', p.listId, DELETED);
      dropCardsOfList(state, p.listId);
      break;

    case EVT.BOARD_UPDATED:
      patchConfirmed(state, 'board', boardId, (m) => ({ ...m, ...p.board }));
      break;
    case EVT.LABEL_DELETED:
      patchConfirmed(state, 'board', boardId, (m) => ({ ...m, labels: m.labels.filter((l) => l._id !== p.labelId) }));
      for (const id of cardIdsWhere(state, (c) => c.labelIds?.includes(p.labelId))) {
        patchConfirmed(state, 'card', id, (c) => ({ ...c, labelIds: c.labelIds.filter((x) => x !== p.labelId) }));
      }
      break;

    case EVT.MEMBER_ADDED:
      patchConfirmed(state, 'board', boardId, (m) => ({
        ...m, members: [...m.members.filter((x) => x.userId !== p.member.userId), p.member],
      }));
      break;
    case EVT.MEMBER_UPDATED:
      patchConfirmed(state, 'board', boardId, (m) => ({
        ...m, members: m.members.map((x) => (x.userId === p.member.userId ? { ...x, ...p.member } : x)),
      }));
      if (p.member.userId === myUserId) state.myRole = p.member.role;
      break;
    case EVT.MEMBER_REMOVED:
      patchConfirmed(state, 'board', boardId, (m) => ({ ...m, members: m.members.filter((x) => x.userId !== p.userId) }));
      for (const id of cardIdsWhere(state, (c) => c.assigneeIds?.includes(p.userId))) {
        patchConfirmed(state, 'card', id, (c) => ({ ...c, assigneeIds: c.assigneeIds.filter((x) => x !== p.userId) }));
      }
      if (p.userId === myUserId) {
        state.status = 'gone';
        state.gone = { reason: 'removed', by: null };
      }
      break;

    case EVT.COMMENT_CREATED:
    case EVT.COMMENT_DELETED: {
      const cardId = p.comment?.cardId ?? p.cardId;
      patchConfirmed(state, 'card', cardId, (c) => ({ ...c, commentCount: p.commentCount }));
      break;
    }
    default:
      break;
  }
  state.revision = p.revision;
}
