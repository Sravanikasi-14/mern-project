import cv2
from pathlib import Path

videos = [
    (
        r"C:\Users\SRAVANI\Videos\Screen Recordings\Screen Recording 2026-11-09 142706.mp4",
        "v1",
    ),
    (
        r"C:\Users\SRAVANI\Videos\Screen Recordings\Screen Recording 2026-11-09 142925.mp4",
        "v2",
    ),
]
out = Path(r"D:\HRMS\mern-project\docs\landing-refs")
out.mkdir(parents=True, exist_ok=True)

for path, tag in videos:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        print(f"FAIL open {tag}: {path}")
        continue
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    dur = frames / fps if fps else 0
    print(f"{tag}: {w}x{h} fps={fps:.2f} frames={frames} duration={dur:.2f}s")
    targets = {0, int(fps * 0.5), int(fps * 1), int(fps * 2)}
    if frames > 0:
        for i in range(12):
            targets.add(int(i * (frames - 1) / 11))
    for idx in sorted(t for t in targets if 0 <= t < max(frames, 1)):
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            continue
        t = idx / fps if fps else 0
        fname = out / f"{tag}_t{t:05.1f}s_f{idx:05d}.jpg"
        max_w = 1600
        if frame.shape[1] > max_w:
            scale = max_w / frame.shape[1]
            frame = cv2.resize(
                frame, (int(frame.shape[1] * scale), int(frame.shape[0] * scale))
            )
        cv2.imwrite(str(fname), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        print(f" wrote {fname.name}")
    cap.release()
print("DONE")
