import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm, stat, statfs, rename, chmod, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';

export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const VIDEO_MAX_DURATION = 60;
const OUTPUT_MAX_BYTES = 24 * 1024 * 1024;
const PROCESS_TIMEOUT_MS = 120_000;
const PROCESSING_BUDGET_MS = 45_000;
const UPLOAD_TIMEOUT_MS = 120_000;
let activeUpload = false;
const activeDirectories = new Set();
const MiB = 1024 * 1024;
const STORAGE_MESSAGE = 'Video storage is full for this beta. Please contact support@joincrewroom.com.';

function storageLimit(override) {
  const backup = Number(process.env.BACKUP_MAX_BYTES || 1024 * MiB);
  const requested = Number(override ?? process.env.CREWROOM_VIDEO_STORAGE_MAX_BYTES ?? 768 * MiB);
  if (!Number.isSafeInteger(backup) || backup <= 0 || !Number.isSafeInteger(requested) || requested <= 0)
    return 0; // A malformed capacity setting fails closed for new videos.
  return Math.min(requested, 768 * MiB, Math.floor(backup * 0.75));
}

async function regularBytes(directory, signal) {
  signal?.throwIfAborted();
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    signal?.throwIfAborted();
    const file = path.join(directory, entry.name);
    let info;
    try { info = await lstat(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) total += await regularBytes(file, signal);
    else if (info.isFile()) total += info.size;
  }
  return total;
}

async function cleanupInterruptedUploads(mediaDir) {
  for (const name of await readdir(mediaDir)) {
    if (!/^\.video-upload-[A-Za-z0-9]{6}$/.test(name)) continue;
    const directory = path.join(mediaDir, name);
    if (activeDirectories.has(directory)) continue;
    let info;
    try { info = await lstat(directory); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (info.isDirectory() && !info.isSymbolicLink()) await rm(directory, { recursive: true, force: true });
  }
}

function videoError(status, message) {
  return Object.assign(new Error(message), { status });
}

// All process arguments are fixed by us, except private local file paths. Input
// demuxing is restricted to MP4/MOV and file protocol; uploaded playlists cannot
// trigger network requests. Output and wall time are bounded independently.
function command(executable, args, timeout = PROCESS_TIMEOUT_MS, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], signal, killSignal: 'SIGKILL' });
    let output = '', bytes = 0, settled = false, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 512 * 1024) { child.kill('SIGKILL'); return; }
      output += chunk;
    });
    // Drain diagnostics without retaining potentially sensitive embedded metadata.
    child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > 512 * 1024) child.kill('SIGKILL'); });
    child.on('error', error => finish(error));
    child.on('close', code => finish(code === 0 && !timedOut && bytes <= 512 * 1024 ? null :
      videoError(400, timedOut ? 'This video took too long to process. Try a shorter clip.' : 'This video could not be processed. Choose an MP4 or MOV clip.'), output));
  });
}

// Dolby Vision can omit the usual PQ/HLG transfer tag and signal HDR through
// an MP4 codec tag or DOVI side data instead. Those clips also need tone mapping.
export function isHDRVideoStream(stream) {
  return ['smpte2084', 'arib-std-b67'].includes(stream.color_transfer) ||
    /^(?:dvh1|dvhe|dva1|dvav)$/i.test(stream.codec_tag_string || '') ||
    (stream.side_data_list || []).some(item => /dovi|dolby vision|mastering display|content light level|hdr dynamic/i.test(item.side_data_type || ''));
}

export function createVideoProcessor({ mediaDir: configuredMediaDir, dbPath, storageBudgetBytes, processingTimeoutMs = PROCESSING_BUDGET_MS } = {}) {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
  const processingBudget = Number.isSafeInteger(processingTimeoutMs) && processingTimeoutMs > 0
    ? Math.min(processingTimeoutMs, PROCESSING_BUDGET_MS) : PROCESSING_BUDGET_MS;
  let ready, cleanupReady;
  const initialize = () => cleanupReady ??= configuredMediaDir ? cleanupInterruptedUploads(configuredMediaDir) : Promise.resolve();
  // Initialization happens on API startup, before an upload can be admitted.
  // Keep errors handled; availability/upload callers surface failure explicitly.
  if (configuredMediaDir) initialize().catch(() => {});
  async function available() {
    try { await initialize(); } catch { return false; }
    ready ??= Promise.all([command(ffmpeg, ['-version'], 5000), command(ffprobe, ['-version'], 5000)])
      .then(() => true, () => false);
    return ready;
  }
  const probe = async (file, signal) => {
    let value;
    try {
      value = JSON.parse(await command(ffprobe, ['-v', 'error', '-max_alloc', '134217728', '-protocol_whitelist', 'file',
        '-f', 'mov', '-probesize', '10000000', '-analyzeduration', '10000000', '-show_streams', '-show_format', '-of', 'json', file], 15_000, signal));
    } catch (error) {
      if (error.status) throw error;
      throw videoError(400, 'Choose a valid MP4 or MOV video.');
    }
    const streams = value.streams?.filter(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic) || [];
    const stream = streams[0];
    const duration = Number(value.format?.duration || stream?.duration);
    if (streams.length !== 1 || !Number.isFinite(duration) || duration <= 0 || duration > VIDEO_MAX_DURATION + 0.1)
      throw videoError(400, 'Videos must contain one video track and be 60 seconds or shorter.');
    if (!Number.isInteger(stream.width) || !Number.isInteger(stream.height) || stream.width < 2 || stream.height < 2 ||
      Math.max(stream.width, stream.height) > 4096 || stream.width * stream.height > 8_850_000)
      throw videoError(400, 'Choose a video up to 4K resolution.');
    const [numerator, denominator] = String(stream.avg_frame_rate || '0/1').split('/').map(Number);
    if (denominator > 0 && numerator / denominator > 120.1)
      throw videoError(400, 'Choose a video with a frame rate of 120 fps or lower.');
    if (isHDRVideoStream(stream))
      throw videoError(400, 'HDR video is not supported in this beta. Choose an SDR clip or turn off HDR Video in your camera settings.');
    return { duration, width: stream.width, height: stream.height, codec: stream.codec_name };
  };

  async function checkCapacity(mediaDir, reserve = 26 * MiB, signal) {
    let bytes = await regularBytes(mediaDir, signal);
    if (dbPath && dbPath !== ':memory:') for (const suffix of ['', '-wal', '-shm', '-journal']) {
      signal?.throwIfAborted();
      const file = path.resolve(dbPath) + suffix;
      if (file.startsWith(path.resolve(mediaDir) + path.sep)) continue;
      try { const info = await lstat(file); if (info.isFile() && !info.isSymbolicLink()) bytes += info.size; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (bytes + reserve > storageLimit(storageBudgetBytes)) throw videoError(503, STORAGE_MESSAGE);
  }
  async function upload(req, mediaDir, mediaId, signal) {
    if (!(await available())) throw videoError(503, 'Video uploads are not available yet. Please try again later.');
    if (activeUpload) throw videoError(429, 'Another video is being processed. Please try again in a moment.');
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!['video/mp4', 'video/quicktime'].includes(type)) throw videoError(415, 'Upload an MP4 or MOV video.');
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > VIDEO_MAX_BYTES) throw videoError(413, 'Videos must be at most 50 MB.');
    activeUpload = true;
    let directory, output, poster, processingTimer, processingTimedOut = false, moved = false, posterMoved = false;
    try {
      await checkCapacity(mediaDir);
      const disk = await statfs(mediaDir);
      if (disk.bavail * disk.bsize < 256 * 1024 * 1024) throw videoError(503, 'Video storage is temporarily full. Please try again later.');
      directory = await mkdtemp(path.join(mediaDir, '.video-upload-'));
      activeDirectories.add(directory);
      const source = path.join(directory, 'source.mov');
      const handle = await open(source, 'wx', 0o600);
      let total = 0;
      const timeout = setTimeout(() => req.destroy(videoError(408, 'Video upload timed out. Try a smaller clip or a faster connection.')), UPLOAD_TIMEOUT_MS);
      try {
        for await (const chunk of req) {
          if (signal?.aborted) throw videoError(400, 'Video upload was canceled.');
          total += chunk.length;
          if (total > VIDEO_MAX_BYTES) throw videoError(413, 'Videos must be at most 50 MB.');
          await handle.write(chunk);
        }
      } finally { clearTimeout(timeout); await handle.close(); }
      if (!total) throw videoError(400, 'Choose a video to upload.');
      if (signal?.aborted) throw videoError(400, 'Video upload was canceled.');
      // URLSession can time out after 60 seconds without response bytes. Bound
      // all processing together, starting only after the request body arrives.
      const deadline = new AbortController();
      const processingSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
      processingTimer = setTimeout(() => { processingTimedOut = true; deadline.abort(); }, processingBudget);
      const input = await probe(source, processingSignal);
      const encoded = path.join(directory, 'encoded.mp4');
      const encodedPoster = path.join(directory, 'poster.jpg');
      const filter = "scale=w='if(gte(iw,ih),min(1280,iw),min(720,iw))':h='if(gte(iw,ih),min(720,ih),min(1280,ih))':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1";
      await command(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-max_alloc', '134217728', '-threads', '2',
        '-protocol_whitelist', 'file', '-f', 'mov', '-i', source, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
        '-map_metadata', '-1', '-map_chapters', '-1', '-vf', filter, '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast',
        '-crf', '25', '-maxrate', '2200k', '-bufsize', '4400k', '-pix_fmt', 'yuv420p', '-threads', '2',
        '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-ar', '44100', '-t', String(VIDEO_MAX_DURATION),
        '-movflags', '+faststart', '-fs', String(OUTPUT_MAX_BYTES), '-y', encoded], PROCESS_TIMEOUT_MS, processingSignal);
      const result = await probe(encoded, processingSignal);
      const outputBytes = (await stat(encoded)).size;
      if (result.codec !== 'h264' || result.duration < input.duration - 0.5 || !outputBytes || outputBytes >= OUTPUT_MAX_BYTES)
        throw videoError(400, 'This clip could not be fully processed. Try a shorter video.');
      await command(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1', '-protocol_whitelist', 'file',
        '-f', 'mov', '-i', encoded, '-frames:v', '1', '-map_metadata', '-1', '-q:v', '3', '-threads', '1', '-y', encodedPoster], 15_000, processingSignal);
      if ((await stat(encodedPoster)).size > 2 * 1024 * 1024) throw videoError(400, 'The video preview could not be processed.');
      if (signal?.aborted) throw videoError(400, 'Video upload was canceled.');
      await rm(source);
      await checkCapacity(mediaDir, 0, processingSignal);
      processingSignal.throwIfAborted();
      const filename = `${mediaId}.mp4`, posterFilename = `${mediaId}-poster.jpg`;
      output = path.join(mediaDir, filename); poster = path.join(mediaDir, posterFilename);
      await chmod(encoded, 0o600); await chmod(encodedPoster, 0o600);
      await rename(encoded, output); moved = true;
      await rename(encodedPoster, poster); posterMoved = true;
      processingSignal.throwIfAborted();
      return { filename, posterFilename, duration: result.duration, width: result.width, height: result.height };
    } catch (error) {
      if (moved) await rm(output, { force: true });
      if (posterMoved) await rm(poster, { force: true });
      if (processingTimedOut) throw videoError(400, 'This video took too long to process. Try a shorter clip or a lower-resolution export.');
      if (error.status) throw error;
      throw videoError(400, 'The video could not be uploaded. Please try again.');
    } finally {
      clearTimeout(processingTimer);
      try { if (directory) await rm(directory, { recursive: true, force: true }); }
      finally { if (directory) activeDirectories.delete(directory); activeUpload = false; }
    }
  }
  return { available, upload };
}

// Called only after media authorization. Single-range playback supports iOS
// seeking without allowing a stale public cache to bypass moderation changes.
export async function streamVideo(req, res, file) {
  const size = (await stat(file)).size;
  const headers = { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, no-store',
    'Content-Disposition': 'inline', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' };
  let start = 0, end = size - 1, status = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (match && (match[1] || match[2])) {
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(size - 1, Number(match[2])); }
    }
    if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` }); res.end(); return;
    }
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  res.writeHead(status, { ...headers, 'Content-Length': end - start + 1 });
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}
