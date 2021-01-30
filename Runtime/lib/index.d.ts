declare type ref = number;
declare type pointer = number;
declare enum JavaScriptValueKind {
    Invalid = -1,
    Boolean = 0,
    String = 1,
    Number = 2,
    Object = 3,
    Null = 4,
    Undefined = 5,
    Function = 6
}
export declare class SwiftRuntime {
    private instance;
    private heap;
    private version;
    private isSleeping;
    private instanceIsAsyncified;
    private resumeCallback;
    private asyncifyBufferPointer;
    private pendingHostFunctionCalls;
    constructor();
    /**
     * Set the Wasm instance
     * @param instance The instantiate Wasm instance
     * @param resumeCallback Optional callback for resuming instance after
     * unwinding and rewinding stack (for asyncified modules).
     */
    setInstance(instance: WebAssembly.Instance, resumeCallback?: () => void): void;
    /**
    * Report that the module has been started.
    * Required for asyncified Wasm modules, so runtime has a chance to call required methods.
    **/
    didStart(): void;
    importObjects(): {
        swjs_set_prop: (ref: number, name: number, kind: JavaScriptValueKind, payload1: number, payload2: number) => void;
        swjs_get_prop: (ref: number, name: number, kind_ptr: pointer, payload1_ptr: pointer, payload2_ptr: pointer) => void;
        swjs_set_subscript: (ref: number, index: number, kind: JavaScriptValueKind, payload1: number, payload2: number) => void;
        swjs_get_subscript: (ref: number, index: number, kind_ptr: pointer, payload1_ptr: pointer, payload2_ptr: pointer) => void;
        swjs_encode_string: (ref: number, bytes_ptr_result: pointer) => number;
        swjs_decode_string: (bytes_ptr: pointer, length: number) => number;
        swjs_load_string: (ref: number, buffer: pointer) => void;
        swjs_call_function: (ref: number, argv: pointer, argc: number, kind_ptr: pointer, payload1_ptr: pointer, payload2_ptr: pointer) => void;
        swjs_call_function_with_this: (obj_ref: ref, func_ref: ref, argv: pointer, argc: number, kind_ptr: pointer, payload1_ptr: pointer, payload2_ptr: pointer) => void;
        swjs_create_function: (host_func_id: number, func_ref_ptr: pointer) => void;
        swjs_call_throwing_new: (ref: number, argv: pointer, argc: number, result_obj: pointer, exception_kind_ptr: pointer, exception_payload1_ptr: pointer, exception_payload2_ptr: pointer) => void;
        swjs_call_new: (ref: number, argv: pointer, argc: number, result_obj: pointer) => void;
        swjs_instanceof: (obj_ref: ref, constructor_ref: ref) => boolean;
        swjs_create_typed_array: (constructor_ref: ref, elementsPtr: pointer, length: number, result_obj: pointer) => void;
        swjs_release: (ref: number) => void;
        swjs_sleep: (ms: number) => void;
        swjs_sync_await: (promiseRef: ref, kind_ptr: pointer, payload1_ptr: pointer, payload2_ptr: pointer) => void;
    };
}
export {};
