chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'GIT_FETCH') {
        const { url, method, headers, body } = request.payload;

        // 后台 fetch 不受页面 CORS 限制
        fetch(url, {
            method,
            headers,
            body: body ? new Uint8Array(Object.values(body)) : undefined // 处理二进制数据
        })
            .then(async (res) => {
                const buffer = await res.arrayBuffer();
                // 将结果传回
                sendResponse({
                    ok: res.ok,
                    status: res.status,
                    statusText: res.statusText,
                    headers: Object.fromEntries(res.headers.entries()),
                    data: Array.from(new Uint8Array(buffer)) // 转换为数组传输
                });
            })
            .catch(err => sendResponse({ error: err.message }));

        return true; // 异步响应
    }
});