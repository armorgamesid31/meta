// Sesli mesaj formatı dönüştürücü.
//
// WhatsApp Cloud API "voice note" (push-to-talk) olarak SADECE OGG/Opus
// kabul eder. Ama istemciler farklı format üretiyor:
//   - Web (MediaRecorder)        → audio/webm; codecs=opus
//   - iOS / Capacitor WebView    → audio/mp4 (AAC)
// İkisi de WhatsApp voice ile uyumsuz: Meta dosyayı R2 link'inden çekip
// sessizce reddediyordu → mesaj "gönderildi" görünüp müşteriye ulaşmıyordu.
//
// Bu modül girdiyi tek geçişte OGG/Opus'a çevirir. ffmpeg-static binary'sini
// child_process ile pipe üzerinden çalıştırır (stdin→stdout, diske yazmadan).
// ffmpeg-static binary'si npm install ile gelir; sunucuya elle kurulum yok.

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
 * Verilen ses buffer'ını (webm/opus, m4a/aac, vb.) WhatsApp voice note
 * uyumlu OGG/Opus'a çevirir: mono, 32 kbps Opus — WhatsApp'ın PTT
 * baloncuğunun beklediği profil.
 *
 * Diske dokunmaz: girdi stdin'e yazılır, çıktı stdout'tan toplanır.
 * Hata durumunda ffmpeg'in stderr'ini içeren bir Error fırlatır.
 */
export async function transcodeToWhatsAppVoice(input: Buffer): Promise<Buffer> {
  if (!input || input.length === 0) {
    throw new Error('transcode_empty_input');
  }
  return await new Promise<Buffer>((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',     // stdin'den oku (konteyner otomatik algılanır)
      '-vn',              // varsa video/kapak görselini at
      '-ac', '1',         // mono
      '-c:a', 'libopus',  // Opus codec
      '-b:a', '32k',      // voice için yeterli bitrate
      '-f', 'ogg',        // OGG konteyner
      'pipe:1',           // stdout'a yaz
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

    // ffmpeg erken ölürse stdin EPIPE atabilir — close handler asıl sebebi
    // raporladığı için burada yutuyoruz.
    proc.stdin.on('error', () => { /* ignore EPIPE */ });
    proc.stdin.write(input);
    proc.stdin.end();
  });
}
