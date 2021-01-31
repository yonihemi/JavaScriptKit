"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwiftRuntime = void 0;
let globalVariable;
if (typeof globalThis !== "undefined") {
    globalVariable = globalThis;
}
else if (typeof window !== "undefined") {
    globalVariable = window;
}
else if (typeof global !== "undefined") {
    globalVariable = global;
}
else if (typeof self !== "undefined") {
    globalVariable = self;
}
/**
 * Runtime check if Wasm module exposes asyncify methods
*/
function isAsyncified(exports) {
    const asyncifiedExports = exports;
    return asyncifiedExports.asyncify_start_rewind !== undefined &&
        asyncifiedExports.asyncify_stop_rewind !== undefined &&
        asyncifiedExports.asyncify_start_unwind !== undefined &&
        asyncifiedExports.asyncify_stop_unwind !== undefined;
}
var JavaScriptValueKind;
(function (JavaScriptValueKind) {
    JavaScriptValueKind[JavaScriptValueKind["Invalid"] = -1] = "Invalid";
    JavaScriptValueKind[JavaScriptValueKind["Boolean"] = 0] = "Boolean";
    JavaScriptValueKind[JavaScriptValueKind["String"] = 1] = "String";
    JavaScriptValueKind[JavaScriptValueKind["Number"] = 2] = "Number";
    JavaScriptValueKind[JavaScriptValueKind["Object"] = 3] = "Object";
    JavaScriptValueKind[JavaScriptValueKind["Null"] = 4] = "Null";
    JavaScriptValueKind[JavaScriptValueKind["Undefined"] = 5] = "Undefined";
    JavaScriptValueKind[JavaScriptValueKind["Function"] = 6] = "Function";
})(JavaScriptValueKind || (JavaScriptValueKind = {}));
class SwiftRuntimeHeap {
    constructor() {
        this._heapValueById = new Map();
        this._heapValueById.set(0, globalVariable);
        this._heapEntryByValue = new Map();
        this._heapEntryByValue.set(globalVariable, { id: 0, rc: 1 });
        // Note: 0 is preserved for global
        this._heapNextKey = 1;
    }
    retain(value) {
        const isObject = typeof value == "object";
        const entry = this._heapEntryByValue.get(value);
        if (isObject && entry) {
            entry.rc++;
            return entry.id;
        }
        const id = this._heapNextKey++;
        this._heapValueById.set(id, value);
        if (isObject) {
            this._heapEntryByValue.set(value, { id: id, rc: 1 });
        }
        return id;
    }
    release(ref) {
        const value = this._heapValueById.get(ref);
        const isObject = typeof value == "object";
        if (isObject) {
            const entry = this._heapEntryByValue.get(value);
            entry.rc--;
            if (entry.rc != 0)
                return;
            this._heapEntryByValue.delete(value);
            this._heapValueById.delete(ref);
        }
        else {
            this._heapValueById.delete(ref);
        }
    }
    referenceHeap(ref) {
        const value = this._heapValueById.get(ref);
        if (value === undefined) {
            throw new ReferenceError("Attempted to read invalid reference " + ref);
        }
        return value;
    }
}
// Helper methods for asyncify
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
class SwiftRuntime {
    constructor() {
        this.version = 701;
        this.instance = null;
        this.heap = new SwiftRuntimeHeap();
        this.isSleeping = false;
        this.instanceIsAsyncified = false;
        this.resumeCallback = () => { };
        this.asyncifyBufferPointer = null;
        this.pendingHostFunctionCalls = [];
    }
    /**
     * Set the Wasm instance
     * @param instance The instantiate Wasm instance
     * @param resumeCallback Optional callback for resuming instance after
     * unwinding and rewinding stack (for asyncified modules).
     */
    setInstance(instance, resumeCallback) {
        this.instance = instance;
        if (resumeCallback) {
            this.resumeCallback = resumeCallback;
        }
        const exports = this.instance
            .exports;
        if (exports.swjs_library_version() != this.version) {
            throw new Error("The versions of JavaScriptKit are incompatible.");
        }
        this.instanceIsAsyncified = isAsyncified(exports);
    }
    /**
    * Report that the module has been started.
    * Required for asyncified Wasm modules, so runtime has a chance to call required methods.
    **/
    didStart() {
        if (this.instance && this.instanceIsAsyncified) {
            const asyncifyExports = this.instance
                .exports;
            asyncifyExports.asyncify_stop_unwind();
        }
    }
    importObjects() {
        const memory = () => {
            if (this.instance)
                return this.instance.exports.memory;
            throw new Error("WebAssembly instance is not set yet");
        };
        const callHostFunction = (host_func_id, args) => {
            if (!this.instance)
                throw new Error("WebAssembly instance is not set yet");
            if (this.isSleeping) {
                this.pendingHostFunctionCalls.push([host_func_id, args]);
                return;
            }
            const exports = this.instance
                .exports;
            const argc = args.length;
            const argv = exports.swjs_prepare_host_function_call(argc);
            for (let index = 0; index < args.length; index++) {
                const argument = args[index];
                const base = argv + 16 * index;
                writeValue(argument, base, base + 4, base + 8, false);
            }
            let output;
            const callback_func_ref = this.heap.retain(function (result) {
                output = result;
            });
            exports.swjs_call_host_function(host_func_id, argv, argc, callback_func_ref);
            exports.swjs_cleanup_host_function_call(argv);
            return output;
        };
        const textDecoder = new TextDecoder("utf-8");
        const textEncoder = new TextEncoder(); // Only support utf-8
        const readString = (ref) => {
            return this.heap.referenceHeap(ref);
        };
        const writeString = (ptr, bytes) => {
            const uint8Memory = new Uint8Array(memory().buffer);
            for (const [index, byte] of bytes.entries()) {
                uint8Memory[ptr + index] = byte;
            }
            uint8Memory[ptr];
        };
        const readUInt32 = (ptr) => {
            const uint8Memory = new Uint8Array(memory().buffer);
            return (uint8Memory[ptr + 0] +
                (uint8Memory[ptr + 1] << 8) +
                (uint8Memory[ptr + 2] << 16) +
                (uint8Memory[ptr + 3] << 24));
        };
        const readFloat64 = (ptr) => {
            const dataView = new DataView(memory().buffer);
            return dataView.getFloat64(ptr, true);
        };
        const writeUint32 = (ptr, value) => {
            const uint8Memory = new Uint8Array(memory().buffer);
            uint8Memory[ptr + 0] = (value & 0x000000ff) >> 0;
            uint8Memory[ptr + 1] = (value & 0x0000ff00) >> 8;
            uint8Memory[ptr + 2] = (value & 0x00ff0000) >> 16;
            uint8Memory[ptr + 3] = (value & 0xff000000) >> 24;
        };
        const writeFloat64 = (ptr, value) => {
            const dataView = new DataView(memory().buffer);
            dataView.setFloat64(ptr, value, true);
        };
        const decodeValue = (kind, payload1, payload2) => {
            switch (kind) {
                case JavaScriptValueKind.Boolean: {
                    switch (payload1) {
                        case 0:
                            return false;
                        case 1:
                            return true;
                    }
                }
                case JavaScriptValueKind.Number: {
                    return payload2;
                }
                case JavaScriptValueKind.String: {
                    return readString(payload1);
                }
                case JavaScriptValueKind.Object: {
                    return this.heap.referenceHeap(payload1);
                }
                case JavaScriptValueKind.Null: {
                    return null;
                }
                case JavaScriptValueKind.Undefined: {
                    return undefined;
                }
                case JavaScriptValueKind.Function: {
                    return this.heap.referenceHeap(payload1);
                }
                default:
                    throw new Error(`Type kind "${kind}" is not supported`);
            }
        };
        const writeValue = (value, kind_ptr, payload1_ptr, payload2_ptr, is_exception) => {
            const exceptionBit = (is_exception ? 1 : 0) << 31;
            if (value === null) {
                writeUint32(kind_ptr, exceptionBit | JavaScriptValueKind.Null);
                return;
            }
            switch (typeof value) {
                case "boolean": {
                    writeUint32(kind_ptr, exceptionBit | JavaScriptValueKind.Boolean);
                    writeUint32(payload1_ptr, value ? 1 : 0);
                    break;
                }
                case "number": {
                    writeUint32(kind_ptr, exceptionBit | JavaScriptValueKind.Number);
                    writeFloat64(payload2_ptr, value);
                    break;
                }
                case "string": {
                    writeUint32(kind_ptr, exceptionBit | JavaScriptValueKind.String);
                    writeUint32(payload1_ptr, this.heap.retain(value));
                    break;
                }
                case "undefined": {
                    writeUint32(kind_ptr, exceptionBit | JavaScriptValueKind.Undefined);
                    break;
                }
                case "object": {
                    writeUint32(kind_ptr, exceptionBit | JavaScriptValueKind.Object);
                    writeUint32(payload1_ptr, this.heap.retain(value));
                    break;
                }
                case "function": {
                    writeUint32(kind_ptr, exceptionBit | JavaScriptValueKind.Function);
                    writeUint32(payload1_ptr, this.heap.retain(value));
                    break;
                }
                default:
                    throw new Error(`Type "${typeof value}" is not supported yet`);
            }
        };
        // Note:
        // `decodeValues` assumes that the size of RawJSValue is 16.
        const decodeValues = (ptr, length) => {
            let result = [];
            for (let index = 0; index < length; index++) {
                const base = ptr + 16 * index;
                const kind = readUInt32(base);
                const payload1 = readUInt32(base + 4);
                const payload2 = readFloat64(base + 8);
                result.push(decodeValue(kind, payload1, payload2));
            }
            return result;
        };
        const syncAwait = (promise, kind_ptr, payload1_ptr, payload2_ptr) => {
            if (!this.instance || !this.instanceIsAsyncified) {
                throw new Error("Calling async methods requires preprocessing Wasm module with `--asyncify`");
            }
            const exports = this.instance.exports;
            if (this.isSleeping) {
                // We are called as part of a resume/rewind. Stop sleeping.
                exports.asyncify_stop_rewind();
                this.isSleeping = false;
                const pendingCalls = this.pendingHostFunctionCalls;
                this.pendingHostFunctionCalls = [];
                pendingCalls.forEach(call => {
                    callHostFunction(call[0], call[1]);
                });
                return;
            }
            if (this.asyncifyBufferPointer == null) {
                const runtimeExports = this.instance
                    .exports;
                this.asyncifyBufferPointer = runtimeExports.swjs_allocate_asyncify_buffer(4096);
            }
            exports.asyncify_start_unwind(this.asyncifyBufferPointer);
            this.isSleeping = true;
            const resume = () => {
                exports.asyncify_start_rewind(this.asyncifyBufferPointer);
                this.resumeCallback();
            };
            promise
                .then(result => {
                if (kind_ptr && payload1_ptr && payload2_ptr) {
                    writeValue(result, kind_ptr, payload1_ptr, payload2_ptr, false);
                }
                resume();
            })
                .catch(error => {
                if (kind_ptr && payload1_ptr && payload2_ptr) {
                    writeValue(error, kind_ptr, payload1_ptr, payload2_ptr, true);
                }
                queueMicrotask(resume);
            });
        };
        return {
            swjs_set_prop: (ref, name, kind, payload1, payload2) => {
                const obj = this.heap.referenceHeap(ref);
                Reflect.set(obj, readString(name), decodeValue(kind, payload1, payload2));
            },
            swjs_get_prop: (ref, name, kind_ptr, payload1_ptr, payload2_ptr) => {
                const obj = this.heap.referenceHeap(ref);
                const result = Reflect.get(obj, readString(name));
                writeValue(result, kind_ptr, payload1_ptr, payload2_ptr, false);
            },
            swjs_set_subscript: (ref, index, kind, payload1, payload2) => {
                const obj = this.heap.referenceHeap(ref);
                Reflect.set(obj, index, decodeValue(kind, payload1, payload2));
            },
            swjs_get_subscript: (ref, index, kind_ptr, payload1_ptr, payload2_ptr) => {
                const obj = this.heap.referenceHeap(ref);
                const result = Reflect.get(obj, index);
                writeValue(result, kind_ptr, payload1_ptr, payload2_ptr, false);
            },
            swjs_encode_string: (ref, bytes_ptr_result) => {
                const bytes = textEncoder.encode(this.heap.referenceHeap(ref));
                const bytes_ptr = this.heap.retain(bytes);
                writeUint32(bytes_ptr_result, bytes_ptr);
                return bytes.length;
            },
            swjs_decode_string: (bytes_ptr, length) => {
                const uint8Memory = new Uint8Array(memory().buffer);
                const bytes = uint8Memory.subarray(bytes_ptr, bytes_ptr + length);
                const string = textDecoder.decode(bytes);
                return this.heap.retain(string);
            },
            swjs_load_string: (ref, buffer) => {
                const bytes = this.heap.referenceHeap(ref);
                writeString(buffer, bytes);
            },
            swjs_call_function: (ref, argv, argc, kind_ptr, payload1_ptr, payload2_ptr) => {
                const func = this.heap.referenceHeap(ref);
                let result;
                try {
                    result = Reflect.apply(func, undefined, decodeValues(argv, argc));
                }
                catch (error) {
                    writeValue(error, kind_ptr, payload1_ptr, payload2_ptr, true);
                    return;
                }
                writeValue(result, kind_ptr, payload1_ptr, payload2_ptr, false);
            },
            swjs_call_function_with_this: (obj_ref, func_ref, argv, argc, kind_ptr, payload1_ptr, payload2_ptr) => {
                const obj = this.heap.referenceHeap(obj_ref);
                const func = this.heap.referenceHeap(func_ref);
                let result;
                try {
                    result = Reflect.apply(func, obj, decodeValues(argv, argc));
                }
                catch (error) {
                    writeValue(error, kind_ptr, payload1_ptr, payload2_ptr, true);
                    return;
                }
                writeValue(result, kind_ptr, payload1_ptr, payload2_ptr, false);
            },
            swjs_create_function: (host_func_id, func_ref_ptr) => {
                const func_ref = this.heap.retain(function () {
                    return callHostFunction(host_func_id, Array.prototype.slice.call(arguments));
                });
                writeUint32(func_ref_ptr, func_ref);
            },
            swjs_call_throwing_new: (ref, argv, argc, result_obj, exception_kind_ptr, exception_payload1_ptr, exception_payload2_ptr) => {
                const obj = this.heap.referenceHeap(ref);
                let result;
                try {
                    result = Reflect.construct(obj, decodeValues(argv, argc));
                }
                catch (error) {
                    writeValue(error, exception_kind_ptr, exception_payload1_ptr, exception_payload2_ptr, true);
                    return;
                }
                writeUint32(result_obj, this.heap.retain(result));
            },
            swjs_call_new: (ref, argv, argc, result_obj) => {
                const obj = this.heap.referenceHeap(ref);
                const result = Reflect.construct(obj, decodeValues(argv, argc));
                writeUint32(result_obj, this.heap.retain(result));
            },
            swjs_instanceof: (obj_ref, constructor_ref) => {
                const obj = this.heap.referenceHeap(obj_ref);
                const constructor = this.heap.referenceHeap(constructor_ref);
                return obj instanceof constructor;
            },
            swjs_create_typed_array: (constructor_ref, elementsPtr, length, result_obj) => {
                const ArrayType = this.heap.referenceHeap(constructor_ref);
                const array = new ArrayType(memory().buffer, elementsPtr, length);
                // Call `.slice()` to copy the memory
                writeUint32(result_obj, this.heap.retain(array.slice()));
            },
            swjs_release: (ref) => {
                this.heap.release(ref);
            },
            swjs_sleep: (ms) => {
                syncAwait(delay(ms));
            },
            swjs_sync_await: (promiseRef, kind_ptr, payload1_ptr, payload2_ptr) => {
                const promise = this.heap.referenceHeap(promiseRef);
                syncAwait(promise, kind_ptr, payload1_ptr, payload2_ptr);
            },
        };
    }
}
exports.SwiftRuntime = SwiftRuntime;
