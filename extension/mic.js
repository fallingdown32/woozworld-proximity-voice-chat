const result = document.getElementById('result');
document.getElementById('allow').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    result.textContent = 'All set. Open Woozworld, then hold ` to talk (change it in the extension popup). You can close this tab.';
    document.getElementById('allow').hidden = true;
  } catch {
    result.textContent = 'The microphone was blocked. Click the icon at the right of the address bar to allow it, then try again.';
  }
});
