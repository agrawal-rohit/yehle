/** When true, use local templates (and instructions under ./templates/instructions/ and ./templates/<lang>/...); otherwise fetch from GitHub. */
export const IS_LOCAL_MODE = process.env.YEHLE_LOCAL_TEMPLATES === "true";
