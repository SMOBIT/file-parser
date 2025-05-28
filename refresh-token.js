// refresh-token.js
const fetch = require("node-fetch");

/**
 * Hol dir einen neuen Access Token von Dropbox via Refresh Token Flow
 *
 * @param {object} params
 * @param {string} params.refresh_token
 * @param {string} params.client_id
 * @param {string} params.client_secret
 * @returns {Promise<string>} access token
 */
async function getNewAccessToken({ refresh_token, client_id, client_secret }) {
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token,
      client_id,
      client_secret
    })
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

module.exports = { getNewAccessToken };
