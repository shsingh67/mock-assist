const statusEl = document.getElementById('status');

(async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());

    statusEl.className = 'status granted';
    statusEl.textContent = 'Microphone enabled! This window will close...';

    chrome.runtime.sendMessage({ type: 'MIC_PERMISSION_RESULT', granted: true });

    setTimeout(() => window.close(), 800);
  } catch (err) {
    statusEl.className = 'status denied';

    if (err.name === 'NotAllowedError') {
      statusEl.textContent = 'Permission denied. Please try again and click "Allow" when prompted.';
    } else {
      statusEl.textContent = 'Error: ' + err.message;
    }

    chrome.runtime.sendMessage({
      type: 'MIC_PERMISSION_RESULT',
      granted: false,
      error: err.name === 'NotAllowedError' ? 'Permission denied' : err.message,
    });

    // Close after a delay so user can read the message
    setTimeout(() => window.close(), 3000);
  }
})();
