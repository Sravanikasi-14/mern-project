/**
 * Capture a JPEG data-URL from the device camera (getUserMedia works in Capacitor WebView).
 */
export async function captureFaceImageBase64({ facingMode = "user", quality = 0.92 } = {}) {
  if (!navigator?.mediaDevices?.getUserMedia) {
    throw new Error("Camera is not available on this device.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.setAttribute("playsinline", "true");
    video.muted = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 500));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}
