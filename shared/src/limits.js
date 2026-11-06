/** Hard limits (docs/02), enforced by server services and mirrored in client forms. */
export const LIMITS = Object.freeze({
  MEMBERS_PER_BOARD: 100,
  LABELS_PER_BOARD: 20,
  LISTS_PER_BOARD: 100,
  CARDS_PER_BOARD: 5000,
  BOARD_TITLE: 120,
  LIST_TITLE: 120,
  CARD_TITLE: 200,
  DESCRIPTION: 10000,
  COMMENT: 5000,
  LABEL_NAME: 30,
  USER_NAME: 80,
  PASSWORD_MIN: 8,
  PASSWORD_MAX: 128,
  COMMENTS_PAGE: 20,
});

export const LABEL_COLORS = Object.freeze([
  'green', 'yellow', 'orange', 'red', 'purple', 'blue', 'sky', 'lime', 'pink', 'gray',
]);
