async function openVoice() {
  if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) {
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA'], justification: 'Proximity voice chat in Woozworld' })
      .catch(() => {});
  }
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.voice === 'open' && sender.tab) {
    openVoice().then(reply);
    return true;
  }
  if (message?.voice === 'close' && !sender.tab) chrome.offscreen.closeDocument().catch(() => {});
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: 'mic.html' });
});
