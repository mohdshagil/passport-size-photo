export { createOnnxSession, runOnnxSession };
import ndarray, { NdArray } from 'ndarray';
import * as ort from 'onnxruntime-web';
import { Config } from './schema';
declare function createOnnxSession(model: any, config: Config): Promise<ort.InferenceSession>;
declare function runOnnxSession(session: any, inputs: [string, NdArray<Float32Array>][], outputs: [string]): Promise<ndarray.NdArray<Float32Array>[]>;
//# sourceMappingURL=onnx.d.ts.map