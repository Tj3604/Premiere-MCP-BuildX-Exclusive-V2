/**
 * Cover-frame choice: scoring weights, spacing, and the tool paths.
 */

import { coverPaths, coverScore, selectCovers, type CoverSample } from '../../export/covers.js';

const s = (t: number, face: number, sharp = 0.9, contrast = 0.6, bright = 1): CoverSample => ({ t, face, faceBox: null, sharp, contrast, bright, meanLuma: 120 });

describe('coverScore', () => {
  it('weights a clear face above everything else', () => {
    expect(coverScore(s(1, 0.9))).toBeGreaterThan(coverScore(s(2, 0, 1, 1, 1)));
  });
});

describe('selectCovers', () => {
  it('takes the best frames at least minGap apart, in time order', () => {
    const samples = [s(1, 0.9), s(1.5, 0.91), s(2, 0.89), s(6, 0.7), s(9, 0.85), s(12, 0.2)];
    const picked = selectCovers(samples, 3, 2);
    expect(picked.map((p) => p.t)).toEqual([1.5, 6, 9]);
    for (let i = 1; i < picked.length; i++) expect(picked[i]!.t - picked[i - 1]!.t).toBeGreaterThanOrEqual(2);
  });

  it('still returns candidates for a clip with no faces', () => {
    const picked = selectCovers([s(1, 0, 0.9), s(4, 0, 0.5), s(8, 0, 0.95)], 2, 2);
    expect(picked).toHaveLength(2);
    expect(picked.map((p) => p.t)).toEqual([1, 8]);
  });
});

describe('coverPaths', () => {
  it('defaults to the PySceneDetect OpenCV and the private model, overridable by env', () => {
    const d = coverPaths('/repo', '/repo/private', {});
    expect(d.script).toBe('/repo/scripts/cover-frames.py');
    expect(d.model).toBe('/repo/private/models/yunet.onnx');
    expect(d.python).toMatch(/uv\/tools\/scenedetect\/bin\/python$/);
    expect(coverPaths('/repo', '/p', { BUILDX_FACE_MODEL: '/m.onnx', BUILDX_CV_PYTHON: '/py' })).toMatchObject({ model: '/m.onnx', python: '/py' });
  });
});
