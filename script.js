// Auto-start camera & smarter photo saving (Web Share / iOS long-press / download)
const CONFIG = {
  x: parseFloat(new URLSearchParams(location.search).get('x')) || 0.55,
  y: parseFloat(new URLSearchParams(location.search).get('y')) || .1,
  w: parseFloat(new URLSearchParams(location.search).get('w')) || 0.25,
  h: parseFloat(new URLSearchParams(location.search).get('h')) || 0.2,
  feather: parseFloat(new URLSearchParams(location.search).get('feather')) || 0.08,
  autostart: (new URLSearchParams(location.search).get('autostart') ?? '1') !== '0'
};

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const dbg = document.getElementById('debug');
const video = document.getElementById('cam');
const startBtn = document.getElementById('start');
const snapBtn = document.getElementById('snap');
const dlLink = document.getElementById('download');

const bg = new Image();
bg.src = 'assets/horseman.png';
bg.onload = () => { canvas.width = bg.width; canvas.height = bg.height; drawBase(); };

let cameraHelper = null;
let lastBox = null;
let streamRef = null;

function log(s){ dbg.textContent = String(s); }

async function startCamera(withStatus=true){
  try {
    if (withStatus) statusEl.textContent = 'Requesting camera permission…';
    streamRef = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: {ideal: 640}, height:{ideal:480} },
      audio: false
    });
    video.srcObject = streamRef;
    await video.play(); // may require user gesture on some browsers
    statusEl.textContent = 'Starting tracker…';
    await initFaceMesh();
    startBtn.classList.add('hidden');
  } catch (e) {
    // If permission was blocked or requires gesture, reveal Start button
    console.warn(e);
    statusEl.textContent = 'Tap “Start Camera” to allow access.';
    startBtn.classList.remove('hidden');
    log(e && (e.message || e.name || e));
  }
}

startBtn.addEventListener('click', () => startCamera(false));

// Attempt autostart as soon as we can
document.addEventListener('DOMContentLoaded', () => {
  if (CONFIG.autostart) {
    // small delay helps some mobile browsers show their permission prompt reliably
    setTimeout(() => startCamera(true), 150);
  } else {
    statusEl.textContent = 'Tap “Start Camera” to begin.';
    startBtn.classList.remove('hidden');
  }
});

// Re-try when page becomes visible again (user returned from permission settings)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !streamRef && CONFIG.autostart){
    startCamera(true);
  }
});

snapBtn.addEventListener('click', async () => {
  try {
    // Create PNG blob from canvas
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png', 1));
    const file = new File([blob], 'horseman-selfie.png', { type: 'image/png' });

    // Try Web Share Level 2 (opens iOS/Android share sheet — can “Save Image” to Photos)
    if (navigator.canShare && navigator.canShare({ files:[file] })) {
      await navigator.share({
        files: [file],
        title: 'Horseman Selfie',
        text: 'Save to Photos or share.'
      });
      statusEl.textContent = 'Shared. Use your share options to Save Image.';
      return;
    }

    // iOS fallback: open the image in a new tab so user can long‑press “Add to Photos”
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS) {
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank'); // user can long-press to save
      if (!win) {
        // If popup blocked, fall back to download link
        dlLink.href = url; dlLink.classList.remove('hidden'); dlLink.textContent = 'Download Photo';
      }
      statusEl.textContent = 'Long‑press the image and choose “Add to Photos”.';
      return;
    }

    // Desktop/Android fallback: trigger a download
    const aurl = URL.createObjectURL(blob);
    dlLink.href = aurl;
    dlLink.classList.remove('hidden');
    dlLink.textContent = 'Download Photo';
    statusEl.textContent = 'Photo ready – use the link to save.';
  } catch (e) {
    console.error(e);
    statusEl.textContent = 'Could not prepare photo.';
    log(e.message || e);
  }
});

function drawBase() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
  const { bx, by, bw, bh } = pumpkinBox();
  ctx.save();
  const grad = ctx.createRadialGradient(bx + bw/2, by + bh/2, Math.min(bw,bh)*0.25, bx + bw/2, by + bh/2, Math.max(bw,bh)*0.65);
  grad.addColorStop(0, 'rgba(0,0,0,0.6)');
  grad.addColorStop(1, 'rgba(0,0,0,0.15)');
  ctx.fillStyle = grad;
  roundedEllipse(ctx, bx, by, bw, bh, Math.min(bw,bh)*0.18);
  ctx.fill();
  ctx.restore();
}

function pumpkinBox() {
  const bx = CONFIG.x * canvas.width;
  const by = CONFIG.y * canvas.height;
  const bw = CONFIG.w * canvas.width;
  const bh = CONFIG.h * canvas.height;
  return { bx, by, bw, bh };
}

function roundedEllipse(ctx, x, y, w, h, r) {
  const kappa = .5522848,
    ox = (w / 2) * kappa,
    oy = (h / 2) * kappa,
    xe = x + w,
    ye = y + h,
    xm = x + w / 2,
    ym = y + h / 2;
  ctx.beginPath();
  ctx.moveTo(x, ym);
  ctx.bezierCurveTo(x, ym - oy, xm - ox, y, xm, y);
  ctx.bezierCurveTo(xm + ox, y, xe, ym - oy, xe, ym);
  ctx.bezierCurveTo(xe, ym + oy, xm + ox, ye, xm, ye);
  ctx.bezierCurveTo(xm - ox, ye, x, ym + oy, x, ym);
  ctx.closePath();
}

function drawFaceIntoPumpkin(box) {
  const { bx, by, bw, bh } = pumpkinBox();
  const { x, y, width, height } = box;

  ctx.save();
  roundedEllipse(ctx, bx, by, bw, bh, Math.min(bw,bh)*0.18);
  ctx.clip();
  ctx.drawImage(video, x, y, width, height, bx, by, bw, bh);

  const edge = CONFIG.feather * Math.min(bw,bh);
  const grad = ctx.createRadialGradient(bx + bw/2, by + bh/2, Math.min(bw,bh)*0.4, bx + bw/2, by + bh/2, Math.min(bw,bh)*0.55 + edge);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = grad;
  roundedEllipse(ctx, bx, by, bw, bh, Math.min(bw,bh)*0.18);
  ctx.fill();
  ctx.restore();
}

async function initFaceMesh(){
  if (typeof FaceMesh === 'undefined' || typeof Camera === 'undefined'){
    statusEl.textContent = 'Failed to load tracker libs.';
    log('MediaPipe FaceMesh not loaded. Check network/CDN.');
    return;
  }
  const faceMesh = new FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
  });
  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  faceMesh.onResults(onResults);

  cameraHelper = new Camera(video, {
    onFrame: async () => { await faceMesh.send({ image: video }); },
    width: 640,
    height: 480
  });
  cameraHelper.start();
  statusEl.textContent = 'Place your face in front of the camera.';
  requestAnimationFrame(loop);
}

function onResults(results){
  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0){
    lastBox = null;
    return;
  }
  const lm = results.multiFaceLandmarks[0];
  let minX=1, minY=1, maxX=0, maxY=0;
  for (const p of lm){
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
const padX = 0.01;  // horizontal padding
const padYTop = 0.02;  // small padding above forehead
const padYBottom = 0.05;  // more cropping below chin (remove neck)

minX = Math.max(0, minX - padX);
maxX = Math.min(1, maxX + padX);
minY = Math.max(0, minY - padYTop);
maxY = Math.min(1, maxY - padYBottom);

  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  lastBox = { x: minX*vw, y: minY*vh, width: (maxX-minX)*vw, height: (maxY-minY)*vh };
  log(`face box: ${Math.round(lastBox.x)},${Math.round(lastBox.y)} ${Math.round(lastBox.width)}x${Math.round(lastBox.height)}`);
}

function loop(){
  drawBase();
  if (lastBox){
    statusEl.textContent = 'Face detected!';
    drawFaceIntoPumpkin(lastBox);
  } else {
    statusEl.textContent = 'Place your face in front of the camera.';
  }
  requestAnimationFrame(loop);
}

// Initial draw
drawBase();
