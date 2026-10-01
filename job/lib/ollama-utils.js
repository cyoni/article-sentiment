export function retryableOllamaError(message, responseText = null) {
    const error = new Error(message);
    error.retryable = true;
    error.responseText = responseText;
    return error;
}

export function isRetryableOllamaError(error) {
    return (
        error?.retryable === true ||
        error?.name === 'AbortError' ||
        /fetch failed|network|socket|ECONNRESET|ETIMEDOUT/i.test(error?.message ?? '')
    );
}

export function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
