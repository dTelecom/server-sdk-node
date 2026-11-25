import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// Run inside a clean consumer with the public browser SDK, playwright-core and its Chromium.
export async function browserCall({ cloud, room, peer, speechWav, inputReady, replyComplete }) {
  const { token, wsUrl } = await cloud.createToken({ room, identity: 'browser', ttl: '3m' });
  const bundle = await readFile(new URL('./node_modules/@dtelecom/livekit-client/dist/livekit-client.esm.mjs', import.meta.url));
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_EXECUTABLE || undefined,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const page = await browser.newPage();
    // Only the participant token enters the page. The intercepted localhost origin never listens on a port.
    await page.route('http://localhost/', route => route.fulfill({ contentType: 'text/html', body: '<title>SDK media check</title>' }));
    await page.route('http://localhost/client.mjs', route => route.fulfill({ contentType: 'text/javascript', body: bundle }));
    if (speechWav) {
      await page.route('http://localhost/question.wav', route => route.fulfill({ contentType: 'audio/wav', body: speechWav }));
      await page.exposeFunction('inputReady', inputReady);
      await page.exposeFunction('replyComplete', replyComplete);
    }
    await page.goto('http://localhost/');
    const evidence = await page.evaluate(publishAndListen, { token, wsUrl, peer, speech: Boolean(speechWav) });
    assert.ok(evidence.packets > 0 && evidence.audible >= 15, 'Expected audible inbound RTP on the remote track');
    if (!speechWav) assert.ok(evidence.tone >= 15, 'Expected a 640 Hz echo');
    console.log('Browser received audio', evidence);
  } finally {
    await browser.close();
  }
}

async function publishAndListen({ token, wsUrl, peer, speech }) {
  const { Room, RoomEvent, Track } = await import('/client.mjs');
  const room = new Room();
  const audio = new AudioContext();
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(check, timeout, failure) {
    const deadline = Date.now() + timeout;
    while (!(await check())) {
      if (Date.now() >= deadline) throw new Error(failure);
      await delay(100);
    }
  }

  let receiver, sampler;
  let audible = 0, tone = 0;
  room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    if (track.kind !== Track.Kind.Audio || participant.identity !== peer || receiver) return;
    receiver = track.receiver;
    document.body.appendChild(track.attach());
    const source = audio.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
    const analyser = audio.createAnalyser();
    source.connect(analyser);
    const pcm = new Float32Array(analyser.fftSize);
    const frequencies = new Float32Array(analyser.frequencyBinCount);
    sampler = setInterval(() => {
      analyser.getFloatTimeDomainData(pcm);
      const rms = Math.sqrt(pcm.reduce((sum, sample) => sum + sample * sample, 0) / pcm.length);
      if (rms < 0.003) return;
      audible++;
      if (speech) return;
      analyser.getFloatFrequencyData(frequencies);
      const peakBin = frequencies.indexOf(Math.max(...frequencies));
      if (Math.abs(peakBin * audio.sampleRate / analyser.fftSize - 640) < 45) tone++;
    }, 30);
  });

  try {
    await audio.resume();
    await room.connect(wsUrl, token);
    const microphone = audio.createMediaStreamDestination();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    // Keep the microphone publishing while the agent opens its speech session.
    oscillator.frequency.value = speech ? 82 : 640;
    gain.gain.value = speech ? 0.0004 : 0.15;
    oscillator.connect(gain).connect(microphone);
    oscillator.start();
    await room.localParticipant.publishTrack(microphone.stream.getAudioTracks()[0], {
      source: Track.Source.Microphone, name: 'test-mic', dtx: false,
    });
    if (speech) {
      await until(() => window.inputReady(), 30000, 'Speech recognizer did not become ready');
      const speechSource = audio.createBufferSource();
      speechSource.buffer = await audio.decodeAudioData(await (await fetch('/question.wav')).arrayBuffer());
      speechSource.connect(microphone);
      speechSource.start();
    }
    await until(() => speech ? audible >= 15 : tone >= 15, 45000, 'No matching remote audio');
    if (speech) await until(() => window.replyComplete(), 30000, 'The model did not finish its response');
    const stats = await receiver.getStats();
    const inbound = [...stats.values()].find(stat => stat.type === 'inbound-rtp' && stat.kind === 'audio');
    return { packets: inbound?.packetsReceived, audible, tone };
  } finally {
    clearInterval(sampler);
    await room.disconnect();
    await audio.close();
  }
}
