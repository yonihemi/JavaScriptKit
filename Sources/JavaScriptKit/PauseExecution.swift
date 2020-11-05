import _CJavaScriptKit

/// Unwind Wasm module execution stack and rewind it after specified milliseconds,
/// allowing JavaScript events to continue to be processed.
/// **Important**: Wasm module must be [asyncified](https://emscripten.org/docs/porting/asyncify.html),
/// otherwise JavaScriptKit's runtime will throw an exception.
public func pauseExecution(milliseconds: Int32) {
    _sleep(milliseconds)
}


extension JSPromise where Success == JSValue, Failure == JSError {
    /// Unwind Wasm module execution stack and rewind it after promise resolves,
    /// allowing JavaScript events to continue to be processed in the meantime.
    /// - Parameters:
    ///     - timeout: If provided, method will return a failure if promise cannot resolve
    ///      before timeout is reached.
    ///
    /// **Important**: Wasm module must be [asyncified](https://emscripten.org/docs/porting/asyncify.html),
    /// otherwise JavaScriptKit's runtime will throw an exception.
    public func syncAwait(timeout: Int32? = nil) -> Result<Success, Failure> {
        var kindAndFlags = JavaScriptValueKindAndFlags()
        var payload1 = JavaScriptPayload1()
        var payload2 = JavaScriptPayload2()
        
        if let timout = timeout {
            _syncAwaitWithTimout(jsObject.id, timout, &kindAndFlags, &payload1, &payload2)
        } else {
            _syncAwait(jsObject.id, &kindAndFlags, &payload1, &payload2)
        }
        let result = RawJSValue(kind: kindAndFlags.kind, payload1: payload1, payload2: payload2).jsValue()
        if kindAndFlags.isException {
            if let error = JSError(from: result) {
                return .failure(error)
            } else {
                return .failure(JSError(message: "Could not build proper JSError from result \(result)"))
            }
        } else {
            return .success(result)
        }
    }
}