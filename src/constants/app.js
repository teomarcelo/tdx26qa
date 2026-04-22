/** Questions loaded per Firestore page (student + instructor). */
export const QUESTIONS_PAGE_SIZE = 10;

/** Optional: who should receive feedback in your process (e.g. forward from exports). Not stored on `dashboardFeedback` documents. */
export const STUDENT_FEEDBACK_TO_EMAIL = 'tmarcelo@salesforce.com';

/** Student board poll interval when not using a live listener for the full list. */
export const STUDENT_POLL_MS = 10000;

/** Fuse.js fuzzy search sensitivity (0 = exact, 1 = very loose). */
export const FUSE_SEARCH_THRESHOLD = 0.42;

/** Max longest edge for pasted question / answer images before JPEG resize. */
export const IMAGE_MAX_EDGE = 1600;

/** JPEG quality for resized paste uploads. */
export const IMAGE_JPEG_QUALITY = 0.82;
