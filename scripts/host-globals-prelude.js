// Prepended (as an esbuild banner) to the extension bundle so it runs before any
// bundled dependency. Ableton's Extension Host evaluates the bundle in a stripped
// Node vm-context that exposes only a handful of globals (fetch, AbortController,
// Buffer, process, console, timers, require) — it is missing URL, TextEncoder,
// crypto, ReadableStream, Blob, performance, and more that our code and the MCP
// SDK assume. Node's builtin modules ARE requirable here, so we source the
// missing web globals from them and install them on globalThis up-front.
"use strict";
(function installHostGlobals() {
  var g = globalThis;
  function def(name, value) {
    if (value !== undefined && g[name] === undefined) {
      try {
        Object.defineProperty(g, name, {
          value: value,
          writable: true,
          configurable: true,
        });
      } catch {
        /* ignore a locked global */
      }
    }
  }
  function req(mod) {
    try {
      return require(mod);
    } catch {
      return undefined;
    }
  }
  var url = req("node:url");
  if (url) {
    def("URL", url.URL);
    def("URLSearchParams", url.URLSearchParams);
  }
  var util = req("node:util");
  if (util) {
    def("TextEncoder", util.TextEncoder);
    def("TextDecoder", util.TextDecoder);
  }
  var nodeCrypto = req("node:crypto");
  if (nodeCrypto) def("crypto", nodeCrypto.webcrypto);
  var streamWeb = req("node:stream/web");
  if (streamWeb) {
    def("ReadableStream", streamWeb.ReadableStream);
    def("WritableStream", streamWeb.WritableStream);
    def("TransformStream", streamWeb.TransformStream);
    def("ByteLengthQueuingStrategy", streamWeb.ByteLengthQueuingStrategy);
    def("CountQueuingStrategy", streamWeb.CountQueuingStrategy);
  }
  var nodeBuffer = req("node:buffer");
  if (nodeBuffer) {
    def("Blob", nodeBuffer.Blob);
    def("File", nodeBuffer.File);
  }
  var perf = req("node:perf_hooks");
  if (perf) def("performance", perf.performance);
  def("queueMicrotask", function (cb) {
    Promise.resolve().then(cb);
  });
})();
