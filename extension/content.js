
// Bridge between page and background
window.addEventListener('message', (event) => {
    if (event.data?.source === 'cors-unblock-inject') {
        const { id, type, data } = event.data;

        // Pass to background script
        chrome.runtime.sendMessage({ type, payload: data }, (response) => {
            // Pass back to page
            window.postMessage({
                source: 'cors-unblock-content',
                id,
                result: response
            }, '*');
        });
    }
});
