// Server-owned, versioned consent. No local entitlement or acceptance state.
'use strict';
let currentConsent = null;
function setConsent(consent) {
  currentConsent = consent && typeof consent.version === 'string' ? consent : null;
  return currentConsent;
}
function getConsent() { return currentConsent; }
async function acceptConsent(token) {
  if (!currentConsent?.version) throw new Error('Versi persetujuan tidak tersedia.');
  const data = await callAPI('/skills/consent', { method: 'POST', token, body: { version: currentConsent.version, accepted: true } });
  return setConsent(data.consent);
}
if (typeof module !== 'undefined') module.exports = { setConsent, getConsent, acceptConsent };
