/* Where the dashboard gets its numbers.
 *
 * Paste the Apps Script web app URL here — the one that ends in /exec.
 * In the Apps Script editor: Deploy -> Manage deployments -> copy the Web app URL.
 *
 * This URL is safe to keep in a public repo. On its own it returns nothing:
 * the script refuses any request that does not carry the passcode.
 */
 *
 * Note the URL must NOT contain an "/a/macros/<domain>/" segment — that form is
 * scoped to the Workspace domain and answers anonymous requests with a Google
 * sign-in page instead of JSON. If it reappears after a redeploy, set
 * "Who has access" back to "Anyone".
 */
window.CC_CONFIG = {
  endpoint: 'https://script.google.com/macros/s/AKfycbwe0bSmebTEa9faM89cVIBWpvVfdWF9Jz9MziYMh4qfJx_2hzYDvC2Q5DZgGcuYBTsx/exec'
};
