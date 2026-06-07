// sherpa-onnx-node (native N-API addon) ships no TypeScript types. The STT backend loads it
// via a lazy require('sherpa-onnx-node') and treats the result as `any` (see
// core/services/sherpaStt.ts), so this ambient declaration only needs to satisfy module
// resolution under noImplicitAny.
declare module 'sherpa-onnx-node'
