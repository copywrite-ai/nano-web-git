chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'GIT_FETCH') {
        const { url, method, headers, body } = request.payload;

        // Robust body conversion
        let fetchBody = undefined;
        if (body) {
            if (body instanceof Uint8Array) {
                fetchBody = body;
            } else if (Array.isArray(body)) {
                fetchBody = new Uint8Array(body);
            } else if (typeof body === 'object' && typeof body.length === 'number') {
                fetchBody = new Uint8Array(body.length);
                for (let i = 0; i < body.length; i++) fetchBody[i] = body[i];
            } else {
                fetchBody = new Uint8Array(Object.values(body));
            }
        }

        console.log(`[Extension] Fetching ${method} ${url} (${fetchBody?.length || 0} bytes body)`);

        fetch(url, {
            method,
            headers,
            body: fetchBody
        })
            .then(async (res) => {
                const buffer = await res.arrayBuffer();
                const data = new Uint8Array(buffer);
                console.log(`[Extension] Response ${res.status} from ${url} (${data.length} bytes)`);

                sendResponse({
                    ok: res.ok,
                    url: res.url,
                    status: res.status,
                    statusText: res.statusText,
                    headers: Object.fromEntries(res.headers.entries()),
                    data: data // Send TypedArray directly
                });
            })
            .catch(err => {
                console.error(`[Extension] Error fetching ${url}:`, err);
                sendResponse({ error: err.message });
            });

        return true;
    }
});