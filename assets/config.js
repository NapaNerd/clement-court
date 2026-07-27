/* Where the dashboard gets its numbers.
 *
 * This is the Apps Script web app URL — the one that ends in /exec.
 * In the Apps Script editor: Deploy -> Manage deployments -> copy the Web app URL.
 *
 * The URL is safe to keep in a public repo. On its own it returns nothing:
 * the script refuses any request that does not carry the passcode.
 *
 * It must NOT contain an "/a/macros/<domain>/" segment. That form is scoped to
 * the Workspace domain and answers anonymous requests with a Google sign-in
 * page instead of JSON. If it reappears after a redeploy, set "Who has access"
 * back to "Anyone".
 */
window.CC_CONFIG = {
  endpoint: 'https://script.google.com/macros/s/AKfycbwe0bSmebTEa9faM89cVIBWpvVfdWF9Jz9MziYMh4qfJx_2hzYDvC2Q5DZgGcuYBTsx/exec'
};
