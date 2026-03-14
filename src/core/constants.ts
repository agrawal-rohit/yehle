/**
 * When true, use local templates and instructions from ./templates and ./instructions; otherwise fetch from GitHub.
 * Set via environment variable YEHLE_LOCAL_TEMPLATES="true".
 */
export const IS_LOCAL_MODE = process.env.YEHLE_LOCAL_TEMPLATES === "true";
