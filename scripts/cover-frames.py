#!/usr/bin/env python3
"""
Cover-frame scoring and extraction for pick_cover_frames (OpenCV + YuNet).

Run with an OpenCV-capable Python (the PySceneDetect uv tool has one):
  ~/.local/share/uv/tools/scenedetect/bin/python scripts/cover-frames.py score <video> --model <yunet.onnx> [--step 0.5] [--skip-head 0.2] [--skip-tail 8.6]
  ~/.local/share/uv/tools/scenedetect/bin/python scripts/cover-frames.py write <video> --times 3.5,9,14 --out-dir <dir> --name <base> [--model <yunet.onnx>]

`score` prints JSON: one row per sampled frame with its face, sharpness, contrast and
brightness scores. Choosing the frames happens in the MCP tool (src/export/covers.ts).
`write` saves full-resolution JPGs for the chosen times plus a numbered contact sheet;
with --model it first moves each time to the frame within +-0.3s where the eyes are
most open, so a candidate never lands mid-blink.
Reads only the video; writes only into --out-dir.
"""

import argparse
import json
import math
import os
import sys

import cv2
import numpy as np

DETECT_WIDTH = 540


def frame_at(cap, t):
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
    ok, frame = cap.read()
    return frame if ok else None


def face_score(detector, small):
    h, w = small.shape[:2]
    detector.setInputSize((w, h))
    _, faces = detector.detect(small)
    if faces is None or len(faces) == 0:
        return 0.0, None
    best, box = 0.0, None
    for f in faces:
        x, y, fw, fh, conf = float(f[0]), float(f[1]), float(f[2]), float(f[3]), float(f[14])
        size = fh / h
        # A readable face fills ~12-45% of the frame height; smaller is a distant figure.
        size_s = min(1.0, size / 0.12) if size < 0.12 else (1.0 if size <= 0.45 else max(0.3, 1 - (size - 0.45) * 2))
        cx = (x + fw / 2) / w
        center_s = 1 - min(1.0, abs(cx - 0.5) * 1.4)
        s = conf * size_s * (0.6 + 0.4 * center_s)
        if s > best:
            best, box = s, [round(x / w, 3), round(y / h, 3), round(fw / w, 3), round(fh / h, 3)]
    return best, box


def eye_openness(detector, frame):
    """Spread of light-to-dark around each eye landmark; the lower eye wins. It is a
    relative measure: an open eye (dark iris, white sclera) scores well above the same
    person's blink a fraction of a second later, so it is only compared within a clip."""
    h, w = frame.shape[:2]
    small = cv2.resize(frame, (DETECT_WIDTH, int(h * DETECT_WIDTH / w)), interpolation=cv2.INTER_AREA)
    detector.setInputSize((small.shape[1], small.shape[0]))
    _, faces = detector.detect(small)
    if faces is None or len(faces) == 0:
        return None
    f = max(faces, key=lambda x: x[2] * x[3])
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    k = w / DETECT_WIDTH
    vals = []
    for ex, ey in ((f[4], f[5]), (f[6], f[7])):
        r = max(3, int(f[2] * 0.09 * k))
        cx, cy = int(ex * k), int(ey * k)
        patch = gray[max(0, cy - r // 2):cy + r // 2, max(0, cx - r):cx + r].astype(float)
        if patch.size == 0:
            return None
        vals.append(float(np.percentile(patch, 90) - np.percentile(patch, 10)))
    return min(vals)


def image_scores(small):
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    sharp = min(1.0, math.log10(cv2.Laplacian(gray, cv2.CV_64F).var() + 1) / 3)
    contrast = min(1.0, float(gray.std()) / 64)
    mean = float(gray.mean())
    bright = 1.0 if 60 <= mean <= 190 else max(0.0, 1 - (60 - mean) / 60 if mean < 60 else 1 - (mean - 190) / 65)
    return sharp, contrast, bright, mean


def cmd_score(a):
    detector = cv2.FaceDetectorYN.create(a.model, '', (DETECT_WIDTH, DETECT_WIDTH), 0.6, 0.3, 50)
    cap = cv2.VideoCapture(a.video)
    if not cap.isOpened():
        sys.exit(f'cannot open {a.video}')
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    duration = (cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0) / fps
    end = duration - (a.skip_tail if duration > 15 else 0) - 0.05
    rows = []
    t = a.skip_head
    while t < end:
        frame = frame_at(cap, t)
        if frame is None:
            break
        h, w = frame.shape[:2]
        small = cv2.resize(frame, (DETECT_WIDTH, int(h * DETECT_WIDTH / w)), interpolation=cv2.INTER_AREA)
        face, box = face_score(detector, small)
        sharp, contrast, bright, mean = image_scores(small)
        rows.append({'t': round(t, 3), 'face': round(face, 4), 'faceBox': box, 'sharp': round(sharp, 4),
                     'contrast': round(contrast, 4), 'bright': round(bright, 4), 'meanLuma': round(mean, 1)})
        t += a.step
    print(json.dumps({'duration': round(duration, 3), 'fps': fps, 'width': int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                      'height': int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)), 'samples': rows}))


def cmd_write(a):
    times = [float(x) for x in a.times.split(',') if x.strip()]
    cap = cv2.VideoCapture(a.video)
    detector = cv2.FaceDetectorYN.create(a.model, '', (DETECT_WIDTH, DETECT_WIDTH), 0.6, 0.3, 50) if a.model else None
    os.makedirs(a.out_dir, exist_ok=True)
    written, thumbs = [], []
    for i, t0 in enumerate(times, 1):
        # Blinks last ~0.15s and a 0.5s sample grid catches them: move to the frame
        # within +-0.3s where the eyes are most open.
        t, frame, eyes = t0, frame_at(cap, t0), None
        if detector is not None and frame is not None:
            best = (eye_openness(detector, frame), t0, frame)
            for d in np.arange(-0.3, 0.301, 0.05):
                tt = round(t0 + float(d), 3)
                if tt < 0 or abs(tt - t0) < 1e-6:
                    continue
                f = frame_at(cap, tt)
                if f is None:
                    continue
                e = eye_openness(detector, f)
                if e is not None and (best[0] is None or e > best[0]):
                    best = (e, tt, f)
            eyes, t, frame = best
        if frame is None:
            continue
        path = os.path.join(a.out_dir, f'{a.name} - cover {i}.jpg')
        n = 2
        while os.path.exists(path):  # never overwrite
            path = os.path.join(a.out_dir, f'{a.name} - cover {i} ({n}).jpg')
            n += 1
        cv2.imwrite(path, frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
        written.append({'n': i, 't': t, 'sampledAt': t0, 'eyes': None if eyes is None else round(eyes, 1), 'path': path})
        h, w = frame.shape[:2]
        th = cv2.resize(frame, (270, int(h * 270 / w)), interpolation=cv2.INTER_AREA)
        cv2.rectangle(th, (0, 0), (54, 44), (0, 0, 0), -1)
        cv2.putText(th, str(i), (12, 34), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (28, 184, 255), 3)
        thumbs.append(th)
    sheet = None
    if thumbs:
        hmax = max(t.shape[0] for t in thumbs)
        thumbs = [cv2.copyMakeBorder(t, 0, hmax - t.shape[0], 4, 4, cv2.BORDER_CONSTANT, value=(0, 0, 0)) for t in thumbs]
        sheet = os.path.join(a.out_dir, f'{a.name} - covers sheet.jpg')
        cv2.imwrite(sheet, np.hstack(thumbs), [cv2.IMWRITE_JPEG_QUALITY, 90])
    print(json.dumps({'written': written, 'sheet': sheet}))


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('score')
    s.add_argument('video')
    s.add_argument('--model', required=True)
    s.add_argument('--step', type=float, default=0.5)
    s.add_argument('--skip-head', type=float, default=0.2)
    s.add_argument('--skip-tail', type=float, default=8.6)
    w = sub.add_parser('write')
    w.add_argument('video')
    w.add_argument('--times', required=True)
    w.add_argument('--out-dir', required=True)
    w.add_argument('--name', required=True)
    w.add_argument('--model', help='YuNet model: nudge each frame to open eyes')
    a = p.parse_args()
    cmd_score(a) if a.cmd == 'score' else cmd_write(a)


if __name__ == '__main__':
    main()
