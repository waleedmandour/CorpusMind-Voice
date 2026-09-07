import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

const SRC = '/home/z/my-project/design/original-logo.png';
const OUT = '/home/z/my-project/design/icon-master.png';

async function main() {
  const zai = await ZAI.create();
  const b64 = fs.readFileSync(SRC).toString('base64');
  const dataUrl = `data:image/png;base64,${b64}`;

  const prompt = `Adapt this app icon for a voice version of the same product. Keep the exact same style: rounded square tile with dark navy gradient background, glowing dual-hemisphere neural brain made of circuit board traces, left hemisphere glowing cyan with letter E, right hemisphere glowing warm gold with Arabic letter ein. ADD a bright glowing cyan audio sound-wave running horizontally through the center of the brain connecting both hemispheres, with small waveform bars. At the bottom replace the old text: white bold title text CORPUS MIND on first line, and below it a smaller tagline VOICE TOOL in cyan letters. Crisp readable text, clean vector style, premium software product logo, high detail`;

  const resp = await zai.images.generations.edit({
    prompt,
    images: [{ url: dataUrl }],
    size: '1024x1024',
  });

  const out = resp?.data?.[0]?.base64;
  if (!out) throw new Error('No image returned');
  fs.writeFileSync(OUT, Buffer.from(out, 'base64'));
  console.log('saved', OUT, fs.statSync(OUT).size, 'bytes');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
