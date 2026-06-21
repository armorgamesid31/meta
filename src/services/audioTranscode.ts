// Sesli mesaj formatı dönüştürücü.
//
// WhatsApp Cloud API "voice note" (push-to-talk) olarak SADECE OGG/Opus
// kabul eder; normal "ses dosyası" olarak MP3/AAC/AMR/MP4'ü de kabul eder.
// İstemciler farklı format üretiyor (web → webm/opus, iOS → mp4/aac), bu
// modül girdiyi tek geçişte hedef formata çevirir. ffmpeg-static binary'sini
// child_process ile pipe üzerinden çalıştırır (stdin→stdout, diske yazmadan).

import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

// ffmpeg-static, çalıştırılabilir ffmpeg yolunu default export eder
// (string | null). null gelirse PATH'teki sistem ffmpeg'ine düş.
const FFMPEG_PATH: string = (ffmpegStatic as unknown as string | null) || 'ffmpeg';

// Boot-time probe: ffmpeg binary bu ortamda (Docker/Linux) gerçekten
// çalışıyor mu? ffmpeg-static'in arch/glibc/izin sorunlarını ses gönderimini
// beklemeden, başlangıç log'unda yakalamak için. Tek seferlik, hafif.
try {
  const probe = spawn(FFMPEG_PATH, ['-version']);
  let v = '';
  probe.stdout.on('data', (d: Buffer) => { v += d.toString(); });
  probe.on('error', (e) => console.error('[ffmpeg-probe] FAIL path=' + FFMPEG_PATH, (e as Error)?.message));
  probe.on('close', (c) => console.log('[ffmpeg-probe] exit=' + c + ' path=' + FFMPEG_PATH + ' ' + (v.split('\n')[0] || '')));
} catch (e) {
  console.error('[ffmpeg-probe] spawn threw:', (e as Error)?.message);
}

/**
 * Girdi ses buffer'ını ffmpeg ile verilen kodek argümanlarıyla çevirir.
 * Diske dokunmaz: girdi stdin'e yazılır, çıktı stdout'tan toplanır.
 */
function runFfmpegAudio(input: Buffer, audioArgs: string[]): Promise<Buffer> {
  if (!input || input.length === 0) {
    return Promise.reject(new Error('transcode_empty_input'));
  }
  return new Promise<Buffer>((resolve, reject) => {
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vn',
      ...audioArgs,
      'pipe:1',
    ];
    let proc;
    try {
      proc = spawn(FFMPEG_PATH, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }
    const out: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout.on('data', (d: Buffer) => out.push(d));
    proc.stderr.on('data', (d: Buffer) => errChunks.push(d));
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      const result = Buffer.concat(out);
      if (code === 0 && result.length > 0) {
        resolve(result);
      } else {
        const stderr = Buffer.concat(errChunks).toString('utf8').slice(0, 400);
        reject(new Error(`ffmpeg_transcode_failed code=${code} ${stderr}`.trim()));
      }
    });
    proc.stdin.on('error', () => { /* ignore EPIPE */ });
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

/**
 * WhatsApp voice note (PTT) için OGG/Opus: mono, 32 kbps Opus.
 */
export function transcodeToWhatsAppVoice(input: Buffer): Promise<Buffer> {
  return runFfmpegAudio(input, ['-ac', '1', '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg']);
}

/**
 * WhatsApp normal ses dosyası için MP3: mono, 64 kbps. Voice-note baloncuğu
 * olmaz ama yaygın bir format olduğu için BSP/Meta tarafında daha az sürtünme
 * bekleniyor.
 */
export function transcodeToMp3(input: Buffer): Promise<Buffer> {
  return runFfmpegAudio(input, ['-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3']);
}
